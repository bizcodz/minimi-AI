import { searchMessagesFts } from '../db/fts.js';
import { resolveTemporalReference } from './temporalResolver.js';
import { extractEntitiesDeterministically } from './entityExtractor.js';
import { eq, inArray, and, gte, lte, desc } from 'drizzle-orm';
import {
  conversations,
  messages,
  entities,
  messageEntities,
  factObservations,
  evidence,
} from '../db/schema.js';

/**
 * Three-tier Memory Retriever:
 * 1. Episodic Memory (raw messages & temporal windows)
 * 2. Entity Memory (linked products/companies/topics)
 * 3. Research Memory (historical fact observations and past evidence)
 */
export class MemoryRetriever {
  constructor(db, sqlite, timeZone = 'Asia/Kolkata') {
    this.db = db;
    this.sqlite = sqlite;
    this.timeZone = timeZone;
  }

  /**
   * Retrieve structured memory based on user message and context
   *
   * @param {string} userMessage
   * @param {Object} options - { currentConversationId, referenceDate }
   */
  async retrieve(userMessage, options = {}) {
    const referenceDate = options.referenceDate || new Date();
    const currentConvId = options.currentConversationId;
    const excludeMessageId = options.excludeMessageId;

    // 1. Resolve temporal constraints if any
    const temporal = resolveTemporalReference(userMessage, {
      referenceDate,
      timeZone: this.timeZone,
    });

    // 2. Extract entities from current user message
    const extractedEntities = extractEntitiesDeterministically(userMessage);

    // 3. Retrieve episodic messages
    const episodic = await this.retrieveEpisodicMessages(userMessage, temporal, currentConvId, excludeMessageId);

    // 4. Retrieve matching entity IDs from database
    const matchedEntityRecords = await this.matchEntities(extractedEntities, episodic);

    // 5. Retrieve research memory (fact observations and past evidence)
    const research = await this.retrieveResearchMemory(matchedEntityRecords, episodic);

    return {
      temporal,
      entities: matchedEntityRecords,
      episodic,
      research,
      hasHistoricalContext: episodic.length > 0 || research.observations.length > 0,
    };
  }

  /**
   * Retrieve episodic messages combining:
   * - Temporal date filters (if date specified)
   * - FTS5 full-text keyword search
   * - Recent messages in current conversation
   */
  async retrieveEpisodicMessages(query, temporal, currentConvId, excludeMessageId = null) {
    const results = [];
    const seenIds = new Set();
    if (excludeMessageId) seenIds.add(excludeMessageId);

    // A. If a temporal window is detected (e.g. "last Tuesday", "3 November")
    if (temporal && temporal.startUtc && temporal.endUtc) {
      try {
        const stmt = this.sqlite.prepare(`
          SELECT 
            m.id,
            m.conversation_id,
            m.role,
            m.content,
            m.created_at,
            c.title AS conversation_title
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          WHERE m.created_at >= ? AND m.created_at <= ?
          ORDER BY m.created_at ASC
        `);

        const timeMatches = stmt.all(temporal.startUtc, temporal.endUtc);
        for (const row of timeMatches) {
          if (!seenIds.has(row.id)) {
            seenIds.add(row.id);
            results.push({ ...row, matchType: 'temporal' });
          }
        }
      } catch (err) {
        console.warn('Temporal message query error:', err.message);
      }
    }

    // B. FTS5 full-text keyword matching across historical conversations
    try {
      const ftsMatches = searchMessagesFts(this.sqlite, query, 8);
      for (const row of ftsMatches) {
        if (!seenIds.has(row.id)) {
          seenIds.add(row.id);
          results.push({ ...row, matchType: 'keyword_fts' });
        }
      }
    } catch (err) {
      console.warn('FTS retrieval error:', err.message);
    }

    // C. Recent context from the current conversation if active
    if (currentConvId) {
      try {
        const currentMsgs = this.sqlite.prepare(`
          SELECT 
            m.id,
            m.conversation_id,
            m.role,
            m.content,
            m.created_at,
            c.title AS conversation_title
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          WHERE m.conversation_id = ?
          ORDER BY m.created_at DESC
          LIMIT 6
        `).all(currentConvId).reverse();

        for (const row of currentMsgs) {
          if (!seenIds.has(row.id)) {
            seenIds.add(row.id);
            results.push({ ...row, matchType: 'current_session' });
          }
        }
      } catch (err) {
        console.warn('Current session message retrieval error:', err.message);
      }
    }

    return results;
  }

  /**
   * Match entities present in DB based on current query and retrieved episodic messages
   */
  async matchEntities(extractedEntities, episodicMessages) {
    const normalizedNames = new Set(extractedEntities.map((e) => e.normalizedName));

    // Also extract potential entities from historical messages if user asks a generic question like:
    // "On Monday we shortlisted 5 CRM tools... has any of them changed?"
    for (const msg of episodicMessages) {
      const fromMsg = extractEntitiesDeterministically(msg.content);
      for (const e of fromMsg) {
        normalizedNames.add(e.normalizedName);
      }
    }

    if (normalizedNames.size === 0) return [];

    try {
      const namesList = Array.from(normalizedNames);
      const matched = this.db
        .select()
        .from(entities)
        .where(inArray(entities.normalizedName, namesList))
        .all();

      return matched;
    } catch (err) {
      console.warn('Entity match query error:', err.message);
      return [];
    }
  }

  /**
   * Retrieve past fact observations and evidence for the matched entities
   */
  async retrieveResearchMemory(matchedEntities, episodicMessages) {
    if (!matchedEntities || matchedEntities.length === 0) {
      return { observations: [], previousEvidence: [] };
    }

    const entityIds = matchedEntities.map((e) => e.id);

    try {
      // 1. Fact observations
      const observations = this.db
        .select({
          id: factObservations.id,
          entityId: factObservations.entityId,
          claim: factObservations.claim,
          value: factObservations.value,
          currency: factObservations.currency,
          billingInterval: factObservations.billingInterval,
          factType: factObservations.factType,
          changeType: factObservations.changeType,
          observedAt: factObservations.observedAt,
          confidence: factObservations.confidence,
          status: factObservations.status,
          evidenceId: factObservations.evidenceId,
        })
        .from(factObservations)
        .where(inArray(factObservations.entityId, entityIds))
        .orderBy(desc(factObservations.observedAt))
        .all();

      // 2. Associated historical evidence
      const evidenceIds = observations
        .map((o) => o.evidenceId)
        .filter(Boolean);

      let historicalEvidence = [];
      if (evidenceIds.length > 0) {
        historicalEvidence = this.db
          .select()
          .from(evidence)
          .where(inArray(evidence.id, evidenceIds))
          .all();
      }

      return {
        observations,
        previousEvidence: historicalEvidence,
      };
    } catch (err) {
      console.warn('Research memory retrieval error:', err.message);
      return { observations: [], previousEvidence: [] };
    }
  }
}
