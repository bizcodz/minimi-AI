# Minimi AI — Independent Engineering Audit Report

**Date**: November 14, 2026  
**Auditor**: Senior AI Systems Engineer & Testing Architect  
**Scope**: Verification of architectural integrity, OpenAI function/tool calling, memory retrieval, temporal date resolution, change detection accuracy, citation safety, security controls, and benchmark validity.

---

## Executive Summary

Minimi AI demonstrates strong core engineering foundations: pure ES Module implementation, deterministic temporal date algebra matching UTC offsets for `Asia/Kolkata`, dual-engine synchronous SQLite support (`better-sqlite3` and Node 26 `node:sqlite`), FTS5 full-text search with triggers, and automated change detection.

However, this independent audit has uncovered **two critical correctness problems** and **three moderate limitations**:
1. **[CRITICAL] Bypassed OpenAI Tool Calling**: The orchestrator currently decides search queries via an external heuristic planner (`ResearchPlanner`) and executes search *before* calling OpenAI, rather than providing the `web_search` tool definition to the OpenAI API for the model to invoke via native `tool_calls`.
2. **[CRITICAL] Missing `insufficient_evidence` State in Change Reports**: If web search retrieves pages for an entity but no pricing numbers can be parsed, the change detector drops the entity completely instead of emitting `status: 'insufficient_evidence'`.
3. **[MODERATE] Historical Observation Loss in UI on Reload**: When selecting an existing conversation from the sidebar, the backend returns past evidence and observations, but the frontend state does not populate the evidence cards.
4. **[MODERATE] Raw URL Hallucination Leak in Response Generator**: `ResponseGenerator.validateCitations` strictly bounds bracketed indices `[1]`, `[2]`, but does not inspect bare Markdown hyperlinks `[text](https://...)`.
5. **[INFORMATIONAL] Benchmark Mocking Transparency**: The 100% benchmark score in `scripts/eval.js` evaluates real database, memory, and comparison logic, but relies on mocked search responses to remain deterministic without live API billing.

---

## Detailed Audit Findings

### 1. OpenAI Integration & Tool Calling
- **Finding**: OpenAI API is called, but native function/tool calling (`tool_calls`) is bypassed.
- **Severity**: **CRITICAL**
- **File Reference**: [src/agent/agentOrchestrator.js](file:///c:/Users/keert/minimi-AI/src/agent/agentOrchestrator.js#L133-L230)
- **Code Inspection**:
  In `agentOrchestrator.js` lines 134–176, search queries are planned and executed using `this.researchPlanner.evaluateSearchNeed()` prior to invoking the LLM. In lines 220–228, `this.openai.chat.completions.create` is invoked *without* the `tools` parameter.
- **Impact**: The LLM itself does not decide whether to call `web_search`, nor does it emit structured tool call arguments. Tool rounds (`MAX_TOOL_ROUNDS = 2`) are not governed by the model's iterative decisions.
- **Recommended Fix**: Pass `tools: [this.webSearchTool.getToolDefinition()]` and `tool_choice: 'auto'` to OpenAI. Handle the model's `tool_calls`, validate query arguments with Zod, execute `web_search`, enforce max 4 calls and 2 rounds, and pass tool messages back for synthesis.

---

### 2. Web Search (Tavily Search API)
- **Finding**: Real requests are made to `https://api.tavily.com/search` when `TAVILY_API_KEY` is present. Result URLs and metadata are stored in `evidence`.
- **Severity**: **PASS**
- **File Reference**: [src/agent/tools/webSearch.js](file:///c:/Users/keert/minimi-AI/src/agent/tools/webSearch.js#L54-L105)
- **Verification**:
  - `fetch('https://api.tavily.com/search')` uses `AbortController` for timeout.
  - Retries on HTTP 500 with exponential backoff (verified by `tests/integration/webSearchAdapter.test.js`).
  - URLs are normalized and deduplicated; tracking parameters (`utm_*`, `ref`) are stripped.
  - Untrusted text is sanitized by defusing `<script>`, `<|im_start|>`, and `[SYSTEM_INSTRUCTION]` tokens.

---

### 3. Memory & FTS5 Retrieval
- **Finding**: Memory persistence across server restarts verified. Three-tier retrieval (episodic, entity, research) operates cleanly.
- **Severity**: **PASS**
- **File Reference**: [src/agent/memoryRetriever.js](file:///c:/Users/keert/minimi-AI/src/agent/memoryRetriever.js#L85-L135)
- **Verification**:
  - Conversations and messages written to disk (`data/minimi.sqlite`) persist across Node process restarts (tested via separate subprocess).
  - Messages from a specific date are retrieved via UTC ISO string window queries (`created_at >= ? AND created_at <= ?`).
  - SQLite FTS5 table `messages_fts` is kept synchronized via `AFTER INSERT`, `AFTER UPDATE`, and `AFTER DELETE` triggers.
  - Keyword search ranks results using BM25 (`bm25(messages_fts)`).

---

### 4. Temporal Reasoning
- **Finding**: Deterministic date algebra is mathematically sound for `Asia/Kolkata` (UTC+5:30).
- **Severity**: **PASS**
- **File Reference**: [src/agent/temporalResolver.js](file:///c:/Users/keert/minimi-AI/src/agent/temporalResolver.js#L68-L150)
- **Verification**:
  - Tested "yesterday", "last Tuesday", "3 November", "2 days ago", and ambiguous periods.
  - "3 November" in Asia/Kolkata correctly maps to UTC window:
    - Start: `2026-11-02T18:30:00.000Z` (00:00:00 IST)
    - End: `2026-11-03T18:29:59.999Z` (23:59:59.999 IST)
  - Ambiguous queries like "a few days ago" return `isAmbiguous: true` and prompt the user for clarification.

---

### 5. Change Detection Matrix
- **Finding**: Numerical and feature comparison works, but entities lacking extracted pricing data do not generate an explicit `insufficient_evidence` report.
- **Severity**: **CRITICAL**
- **File Reference**: [src/agent/changeDetector.js](file:///c:/Users/keert/minimi-AI/src/agent/changeDetector.js#L35-L80) & [src/agent/agentOrchestrator.js](file:///c:/Users/keert/minimi-AI/src/agent/agentOrchestrator.js#L305-L330)
- **Code Inspection**:
  If search evidence is retrieved for an entity (e.g. Neon) but snippets describe architecture without a price dollar figure, `extractFindingsFromEvidence()` yields no finding for that entity. As a result, no report is generated, and the system fails to explicitly distinguish `insufficient_evidence` from un-researched entities.
- **Recommended Fix**: In `extractFindingsFromEvidence()`, when an entity has search evidence but no pricing patterns could be extracted, generate an observation record with `status: 'insufficient_evidence'`.

---

### 6. Citations & Grounding
- **Finding**: Bracketed citations `[n]` are verified and bound. However, raw Markdown hyperlinks `[text](url)` are not scanned.
- **Severity**: **MODERATE**
- **File Reference**: [src/agent/responseGenerator.js](file:///c:/Users/keert/minimi-AI/src/agent/responseGenerator.js#L110-L140)
- **Reproduction**:
  If the model outputs: `Supabase pricing [docs](https://fake-url.com/pricing)`, `validateCitations()` only looks for `\[(\d+)\]`. The raw markdown link is not stripped.
- **Recommended Fix**: Add URL extraction regex to `validateCitations()` to ensure all explicit hyperlinks point only to domains present in `availableSources`.

---

### 7. Frontend & API
- **Finding**: Real SSE streaming works. When selecting an existing conversation, past citations and change cards are not populated in the UI.
- **Severity**: **MODERATE**
- **File Reference**: [src/app/page.js](file:///c:/Users/keert/minimi-AI/src/app/page.js#L68-L90)
- **Code Inspection**:
  `selectConversation()` calls `GET /api/conversations/:id`, which returns `{ conversation, messages, evidence, observations }`. The handler populates `setMessages(...)`, but resets `setCurrentSources([])` and `setCurrentChanges([])` without filling them from the server response.
- **Recommended Fix**: Map `data.evidence` to `setCurrentSources` and `data.observations` to `setCurrentChanges` upon conversation selection.

---

### 8. Security Controls
- **Finding**: All security requirements met.
- **Severity**: **PASS**
- **Verification**:
  - Prompt injection: Sanitizer strips `<|im_start|>`, `<|im_end|>`, `[SYSTEM_INSTRUCTION]`, `<script>`, and HTML tags.
  - SQL safety: 100% parameterized SQL; no raw string concatenation into queries.
  - Secrets: API keys read strictly from environment; no keys in frontend bundles or SQLite tables.
  - Rate limiting: 60 requests/min per IP with `X-RateLimit-*` headers.
  - Request limits: 1MB JSON body limit and 4000-character prompt ceiling.
  - Timeouts: 60-second gateway timeout on Express routes.

---

### 9. Benchmark & Test Transparency
- **Finding**: The 100% benchmark score is legitimate for local integration testing, but tests use mocked Tavily search results.
- **Severity**: **INFORMATIONAL**
- **File Reference**: [scripts/eval.js](file:///c:/Users/keert/minimi-AI/scripts/eval.js#L40-L210)
- **Details**:
  - Tests 1, 2, 4, 5, 6, 8 test real memory, FTS5 triggers, deterministic date resolver, and change comparison logic.
  - Tests 3 and 7 mock Tavily search responses to avoid flakiness and billing costs during automated CI.
  - No benchmark results are hardcoded; all responses flow through the live orchestrator and database.

---

## Audit Verdict & Verification After Fixes

| Issue | Severity | Status | Verification Evidence |
| :--- | :---: | :---: | :--- |
| 1. OpenAI Function/Tool Calling (`tool_calls` loop) | **CRITICAL** | **RESOLVED & VERIFIED** | Implemented interactive tool-calling loop in `agentOrchestrator.js` using Zod argument validation and max 2 tool rounds. Verified in `tests/integration/agentToolExecution.test.js` (`handles native OpenAI tool_calls response`). |
| 2. Explicit `insufficient_evidence` Observation Generation | **CRITICAL** | **RESOLVED & VERIFIED** | Updated `extractFindingsFromEvidence` and `changeDetector.js` to emit `status: 'insufficient_evidence'` when sources exist without price figures. Verified in `tests/integration/agentToolExecution.test.js`. |
| 3. Frontend Past Evidence & Observations Population | **MODERATE** | **RESOLVED & VERIFIED** | Updated `selectConversation()` in `src/app/page.js` to restore `currentSources` and `currentChanges` from `data.evidence` and `data.observations`. |
| 4. Raw Hyperlink Citation Validation | **MODERATE** | **RESOLVED & VERIFIED** | Added markdown URL domain inspection in `ResponseGenerator.validateCitations()`. Verified in `tests/integration/citationValidation.test.js` (`defuses unverified or hallucinated markdown URLs`). |
| 5. Benchmark Mocking Transparency Documentation | **INFORMATIONAL** | **DOCUMENTED** | Fully documented in `README.md` and `AUDIT.md`. |

---

## Final Verification Run Summary

- **Automated Vitest Test Suite**: 12/12 test files passed (44/44 tests passed in 2.74s)
- **Benchmark Evaluation Suite (`scripts/eval.js`)**: 8/8 scenarios passed (100% accuracy, 100% bounded tool execution compliance, 100% verified citations)
- **Production Build (`next build`)**: Succeeded with code 0 in 7.3s (prerendered all routes cleanly)

