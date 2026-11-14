import OpenAI from 'openai';
import crypto from 'crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { MemoryRetriever } from './memoryRetriever.js';
import { WebSearchTool } from './tools/webSearch.js';
import { ResearchPlanner, normalizeQuery } from './researchPlanner.js';
import { ChangeDetector } from './changeDetector.js';
import { ResponseGenerator } from './responseGenerator.js';
import { persistEntitiesAndLinks, extractEntitiesDeterministically } from './entityExtractor.js';
import {
  conversations,
  messages,
  researchRuns,
  evidence as evidenceTable,
} from '../db/schema.js';
import { eq } from 'drizzle-orm';

const searchArgSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty'),
});

export class AgentOrchestrator {
  constructor(db, sqlite, options = {}) {
    this.db = db;
    this.sqlite = sqlite;
    this.timeZone = options.timeZone || config.APP_TIMEZONE;
    this.memoryRetriever = new MemoryRetriever(db, sqlite, this.timeZone);
    this.webSearchTool = new WebSearchTool(options.tavilyApiKey || config.TAVILY_API_KEY);
    this.researchPlanner = new ResearchPlanner({
      maxCalls: options.maxCalls || config.MAX_SEARCH_CALLS_PER_REQUEST,
      maxRounds: options.maxRounds || config.MAX_TOOL_ROUNDS,
    });
    this.changeDetector = new ChangeDetector(db);

    this.openaiApiKey = options.openaiApiKey || config.OPENAI_API_KEY || '';
    this.openai = new OpenAI({
      apiKey: this.openaiApiKey || 'dummy-key',
    });
    this.model = options.openaiModel || config.OPENAI_MODEL;
  }

  isLiveOpenAi() {
    return Boolean(this.openaiApiKey && this.openaiApiKey !== 'dummy-key');
  }

  /**
   * Process a user message through the bounded execution pipeline with streaming callbacks
   */
  async process({ conversationId, message, onEvent = () => {} }) {
    const nowIso = new Date().toISOString();
    let convId = conversationId;

    // 0. Ensure conversation exists
    if (!convId) {
      convId = crypto.randomUUID();
      const initialTitle = message.slice(0, 45).trim() + (message.length > 45 ? '...' : '');
      this.db.insert(conversations).values({
        id: convId,
        title: initialTitle,
        createdAt: nowIso,
        updatedAt: nowIso,
      }).run();
    }

    // Save user message
    const userMsgId = crypto.randomUUID();
    this.db.insert(messages).values({
      id: userMsgId,
      conversationId: convId,
      role: 'user',
      content: message,
      createdAt: nowIso,
    }).run();

    // Extract & link entities for user message
    const initialEntities = extractEntitiesDeterministically(message);
    await persistEntitiesAndLinks(this.db, userMsgId, initialEntities);

    // 1 & 2. Temporal resolution & Memory retrieval
    onEvent('status', { step: 'retrieving_memory', message: 'Retrieving historical context and temporal references...' });

    const memoryContext = await this.memoryRetriever.retrieve(message, {
      currentConversationId: convId,
      referenceDate: new Date(),
      excludeMessageId: userMsgId,
    });

    if (memoryContext.temporal?.isAmbiguous) {
      const clarifyText = memoryContext.temporal.clarificationPrompt;
      const assistantMsgId = crypto.randomUUID();
      this.db.insert(messages).values({
        id: assistantMsgId,
        conversationId: convId,
        role: 'assistant',
        content: clarifyText,
        createdAt: new Date().toISOString(),
      }).run();

      onEvent('delta', { text: clarifyText });
      onEvent('done', { conversationId: convId, messageId: assistantMsgId, citations: [] });
      return { conversationId: convId, response: clarifyText, citations: [] };
    }

    // Check for honest uncertainty when past conversation is requested but missing
    const userExplicitlyAskedPast = memoryContext.temporal && !memoryContext.hasHistoricalContext;
    if (userExplicitlyAskedPast && /^(what\s+did\s+i|did\s+we|show\s+me|is\s+your\s+answer|has\s+any)/i.test(message)) {
      const missingResp = ResponseGenerator.generateMissingHistoryResponse(memoryContext.temporal, message);
      const assistantMsgId = crypto.randomUUID();
      this.db.insert(messages).values({
        id: assistantMsgId,
        conversationId: convId,
        role: 'assistant',
        content: missingResp,
        createdAt: new Date().toISOString(),
      }).run();

      onEvent('delta', { text: missingResp });
      onEvent('done', { conversationId: convId, messageId: assistantMsgId, citations: [] });
      return { conversationId: convId, response: missingResp, citations: [] };
    }

    onEvent('memory', {
      temporal: memoryContext.temporal,
      matchedEntities: memoryContext.entities.map((e) => e.name),
      episodicCount: memoryContext.episodic.length,
      historicalObservationsCount: memoryContext.research.observations.length,
    });

    const retrievedEvidence = [];
    const seenQueries = new Set();
    let toolCallsCount = 0;
    let finalResponseText = '';

    const systemPrompt = ResponseGenerator.buildSystemPrompt({
      currentTime: new Date().toISOString(),
      timeZone: this.timeZone,
      memory: memoryContext,
      searchEvidence: [],
      changeReports: [],
    });

    const contextPrompt = ResponseGenerator.buildContextPrompt({
      userMessage: message,
      memory: memoryContext,
      searchEvidence: [],
      changeReports: [],
      temporal: memoryContext.temporal,
    });

    // 3. Execution: OpenAI Native Function/Tool Calling OR Bounded Deterministic Pipeline
    if (this.isLiveOpenAi()) {
      onEvent('status', { step: 'llm_tool_evaluation', message: 'Consulting OpenAI model with web_search tool capability...' });

      const toolDef = this.webSearchTool.getToolDefinition();
      const llmMessages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: contextPrompt },
      ];

      try {
        for (let round = 1; round <= this.researchPlanner.maxRounds; round++) {
          const completion = await this.openai.chat.completions.create({
            model: this.model,
            messages: llmMessages,
            tools: [toolDef],
            tool_choice: 'auto',
            temperature: 0.2,
          });

          const choice = completion.choices[0];
          const choiceMsg = choice.message;
          llmMessages.push(choiceMsg);

          // If model calls web_search tool
          if (choiceMsg.tool_calls && choiceMsg.tool_calls.length > 0) {
            for (const tc of choiceMsg.tool_calls) {
              if (tc.function.name === 'web_search') {
                let validatedQuery = '';
                try {
                  const rawArgs = JSON.parse(tc.function.arguments);
                  const parsed = searchArgSchema.safeParse(rawArgs);
                  if (parsed.success) {
                    validatedQuery = parsed.data.query.trim();
                  }
                } catch (_) {}

                const normalized = normalizeQuery(validatedQuery || '');

                if (validatedQuery && toolCallsCount < this.researchPlanner.maxCalls && !seenQueries.has(normalized)) {
                  seenQueries.add(normalized);
                  toolCallsCount++;

                  onEvent('search_start', {
                    query: validatedQuery,
                    callIndex: toolCallsCount,
                    maxCalls: this.researchPlanner.maxCalls,
                  });

                  const searchResults = await this.webSearchTool.search(validatedQuery);
                  onEvent('search_results', { query: validatedQuery, count: searchResults.length });

                  // Record in DB
                  const runId = crypto.randomUUID();
                  try {
                    this.db.insert(researchRuns).values({
                      id: runId,
                      conversationId: convId,
                      messageId: userMsgId,
                      query: validatedQuery,
                      status: 'completed',
                      createdAt: new Date().toISOString(),
                    }).run();

                    for (const res of searchResults) {
                      const evId = crypto.randomUUID();
                      this.db.insert(evidenceTable).values({
                        id: evId,
                        researchRunId: runId,
                        title: res.title,
                        url: res.url,
                        snippet: res.snippet,
                        publishedDate: res.publishedDate,
                        retrievedAt: res.retrievalTimestamp || res.retrievedAt || new Date().toISOString(),
                        score: res.score,
                      }).run();
                      retrievedEvidence.push({ ...res, id: evId });
                    }
                  } catch (dbErr) {
                    retrievedEvidence.push(...searchResults);
                  }

                  llmMessages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: JSON.stringify(
                      searchResults.map((r) => ({
                        title: r.title,
                        url: r.url,
                        snippet: r.snippet,
                        publishedDate: r.publishedDate,
                      }))
                    ),
                  });
                } else {
                  llmMessages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: JSON.stringify({
                      note: 'Execution bound reached or query already searched. Use retrieved sources.',
                    }),
                  });
                }
              }
            }
          } else {
            // Model did not request more tool calls; finished with content
            finalResponseText = choiceMsg.content || '';
            onEvent('delta', { text: finalResponseText });
            break;
          }

          // If reached max rounds and no text yet, request streaming synthesis
          if (round === this.researchPlanner.maxRounds && !finalResponseText) {
            const finalStream = await this.openai.chat.completions.create({
              model: this.model,
              messages: llmMessages,
              stream: true,
              temperature: 0.2,
            });

            for await (const chunk of finalStream) {
              const delta = chunk.choices[0]?.delta?.content || '';
              if (delta) {
                finalResponseText += delta;
                onEvent('delta', { text: delta });
              }
            }
          }
        }
      } catch (err) {
        console.warn('Live OpenAI tool-calling error, falling back to deterministic synthesis:', err.message);
      }
    }

    // Fallback if offline / test mode / no OpenAI API key provided
    if (!finalResponseText && (!this.isLiveOpenAi() || retrievedEvidence.length === 0)) {
      onEvent('status', { step: 'planning_research', message: 'Analyzing research needs and bounding search queries...' });
      const plan = this.researchPlanner.evaluateSearchNeed(message, memoryContext);

      if (plan.needsSearch && !this.webSearchTool.apiKey) {
        onEvent('status', {
          step: 'search_unavailable',
          message: 'TAVILY_API_KEY is not configured in environment. Real-time web search cannot be performed.',
        });
      }

      if (plan.needsSearch && plan.suggestedQueries.length > 0) {
        for (const query of plan.suggestedQueries) {
          if (toolCallsCount >= this.researchPlanner.maxCalls) break;

          onEvent('search_start', { query, callIndex: toolCallsCount + 1, maxCalls: this.researchPlanner.maxCalls });
          toolCallsCount++;

          const searchResults = await this.webSearchTool.search(query);
          onEvent('search_results', { query, count: searchResults.length });

          const runId = crypto.randomUUID();
          try {
            this.db.insert(researchRuns).values({
              id: runId,
              conversationId: convId,
              messageId: userMsgId,
              query,
              status: 'completed',
              createdAt: new Date().toISOString(),
            }).run();

            for (const res of searchResults) {
              const evId = crypto.randomUUID();
              this.db.insert(evidenceTable).values({
                id: evId,
                researchRunId: runId,
                title: res.title,
                url: res.url,
                snippet: res.snippet,
                publishedDate: res.publishedDate,
                retrievedAt: res.retrievalTimestamp || res.retrievedAt || new Date().toISOString(),
                score: res.score,
              }).run();

              retrievedEvidence.push({ ...res, id: evId });
            }
          } catch (dbErr) {
            retrievedEvidence.push(...searchResults);
          }
        }
      }
    }

    // 4. Emit retrieved sources
    onEvent('sources', retrievedEvidence.map((e) => ({
      title: e.title,
      url: e.url,
      snippet: e.snippet,
      publishedDate: e.publishedDate,
    })));

    // 5. Change Detection Matrix
    onEvent('status', { step: 'change_detection', message: 'Comparing historical observations with fresh evidence...' });
    const parsedFindings = extractFindingsFromEvidence(retrievedEvidence, memoryContext.entities);
    const changeReports = await this.changeDetector.detectAndRecordChanges(
      parsedFindings,
      memoryContext.research.observations,
      null
    );

    if (changeReports.length > 0) {
      onEvent('change_detection', changeReports);
    }

    // 6. Complete final response text if not already generated
    if (!finalResponseText) {
      finalResponseText = generateDeterministicSynthesis({
        userMessage: message,
        temporal: memoryContext.temporal,
        memoryContext,
        retrievedEvidence,
        changeReports,
      });
      onEvent('delta', { text: finalResponseText });
    }

    // 7. Validate citations against retrieved sources
    const validated = ResponseGenerator.validateCitations(finalResponseText, retrievedEvidence);

    // 8. Persist assistant message
    const assistantMsgId = crypto.randomUUID();
    const assistantTime = new Date().toISOString();
    this.db.insert(messages).values({
      id: assistantMsgId,
      conversationId: convId,
      role: 'assistant',
      content: validated.text,
      createdAt: assistantTime,
    }).run();

    // Link extracted entities to assistant message
    const assistantEntities = extractEntitiesDeterministically(validated.text);
    await persistEntitiesAndLinks(this.db, assistantMsgId, assistantEntities);

    // Update conversation timestamp
    this.db.update(conversations)
      .set({ updatedAt: assistantTime })
      .where(eq(conversations.id, convId))
      .run();

    onEvent('done', {
      conversationId: convId,
      messageId: assistantMsgId,
      citations: validated.citations,
      changeReports,
    });

    return {
      conversationId: convId,
      response: validated.text,
      citations: validated.citations,
      changeReports,
    };
  }
}

/**
 * Extract structured findings from raw evidence snippets to feed the ChangeDetector
 */
function extractFindingsFromEvidence(evidenceList, matchedEntities) {
  const findings = [];
  const entitiesToScan = matchedEntities.length > 0 ? matchedEntities : [{ id: 'general', name: 'General', normalizedName: 'general' }];

  for (const ent of entitiesToScan) {
    let matchedPrice = false;

    for (const item of evidenceList) {
      const text = `${item.title} ${item.snippet}`;
      if (ent.id === 'general' || text.toLowerCase().includes(ent.name.toLowerCase())) {
        const priceMatch = text.match(/(?:\$|£|€)\s*(\d+(?:\.\d+)?)\s*(?:\/|\s*per\s*)?(mo|month|year|yr|user|seat)?/i);
        if (priceMatch) {
          let tierLabel = 'standard pricing plan';
          if (/\bpro\b/i.test(text)) tierLabel = 'Pro Plan';
          else if (/\bstarter\b/i.test(text)) tierLabel = 'Starter Plan';
          else if (/\bteam\b/i.test(text)) tierLabel = 'Team Plan';
          else if (/\bfree\b/i.test(text)) tierLabel = 'Free Tier';
          else if (/\benterprise\b/i.test(text)) tierLabel = 'Enterprise Plan';

          findings.push({
            entityId: ent.id,
            entityName: ent.name,
            claim: `${ent.name} ${tierLabel}`,
            value: priceMatch[0],
            currency: 'USD',
            billingInterval: priceMatch[2] ? 'monthly' : 'monthly',
            factType: 'pricing',
            sourceEvidence: item,
          });
          matchedPrice = true;
          break;
        }
      }
    }

    // If evidence was retrieved mentioning this entity, but no pricing could be parsed:
    if (!matchedPrice && evidenceList.length > 0 && ent.id !== 'general') {
      const matchingEvidence = evidenceList.find((item) =>
        `${item.title} ${item.snippet}`.toLowerCase().includes(ent.name.toLowerCase())
      );
      if (matchingEvidence) {
        findings.push({
          entityId: ent.id,
          entityName: ent.name,
          claim: `${ent.name} pricing`,
          value: 'unverified',
          currency: 'USD',
          billingInterval: 'monthly',
          factType: 'pricing',
          sourceEvidence: matchingEvidence,
          explicitStatus: 'insufficient_evidence',
        });
      }
    }
  }

  return findings;
}

/**
 * Deterministic evidence synthesis engine used when OpenAI key is absent or in test environments
 */
export function generateDeterministicSynthesis({ userMessage, temporal, memoryContext, retrievedEvidence, changeReports }) {
  const parts = [];

  if (memoryContext?.episodic && memoryContext.episodic.length > 0) {
    const dateLabel = temporal ? ` (${temporal.label})` : '';
    parts.push(`Based on our conversation history${dateLabel}:`);
    memoryContext.episodic.slice(0, 3).forEach((msg) => {
      parts.push(`- You noted: "${msg.content}"`);
    });
    parts.push('');
  }

  if (changeReports && changeReports.length > 0) {
    parts.push('### Change Detection Analysis:');
    changeReports.forEach((rep) => {
      if (rep.status === 'confirmed_change') {
        parts.push(`- **[Confirmed Change] ${rep.entityName}**: ${rep.summary}`);
      } else if (rep.status === 'no_change') {
        parts.push(`- **[No Change Detected] ${rep.entityName}**: ${rep.summary}`);
      } else if (rep.status === 'historical_unavailable') {
        parts.push(`- **[Historical Value Unavailable] ${rep.entityName}**: ${rep.summary}`);
      } else {
        parts.push(`- **[Insufficient Evidence] ${rep.entityName}**: ${rep.summary}`);
      }
    });
    parts.push('');
  }

  if (retrievedEvidence && retrievedEvidence.length > 0) {
    parts.push('### Current Web Research:');
    retrievedEvidence.slice(0, 3).forEach((src, idx) => {
      parts.push(`[${idx + 1}] ${src.title}: ${src.snippet.slice(0, 160)}...`);
    });
  } else if (!memoryContext?.hasHistoricalContext) {
    if (!config.TAVILY_API_KEY) {
      parts.push('I do not have sufficient historical records for this request, and TAVILY_API_KEY is not configured to execute live web search.');
    } else {
      parts.push('I do not have sufficient historical or fresh web evidence to confirm changes for this request.');
    }
  }

  return parts.join('\n');
}
