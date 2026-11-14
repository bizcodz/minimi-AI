# Minimi AI — Conversational Research & Memory Agent

A production-grade, conversational AI research agent equipped with persistent multi-tier memory, deterministic temporal reasoning, and bounded real-time web search. Built with JavaScript ES Modules, Node.js, Next.js (App Router), React, Express.js, SQLite (`better-sqlite3`), Drizzle ORM, SQLite FTS5, and the Tavily Search API.

---

## 🌟 Key Features

1. **Persistent Three-Tier Memory System**:
   - **Episodic Memory**: Stores original conversation messages with high-precision UTC timestamps.
   - **Entity Memory**: Identifies, links, and tracks companies, products, technologies, and topics across conversations.
   - **Research Memory**: Persists factual observations, pricing tiers, and search evidence across application restarts without overwriting historical records.
2. **Deterministic Temporal Resolver**:
   - Resolves natural language time references ("yesterday", "last Monday", "last Tuesday", "3 November", "2 days ago") into exact UTC search windows based on the configured timezone (`Asia/Kolkata` default).
   - Detects ambiguous dates and asks clarifying questions.
3. **Bounded Web Research (Single Tool)**:
   - Exactly one external agent tool: `web_search` backed by the Tavily Search API.
   - Enforces strict execution limits: **maximum 4 search calls per request**, **maximum 2 tool-calling rounds**, search timeouts, retry with exponential backoff, and URL deduplication.
   - Treats all retrieved web content as untrusted data, sanitizing prompt injection markers, system tags, and HTML.
4. **Change Detection Matrix**:
   - Compares previous observations with current web evidence.
   - Explicitly classifies findings into: `[Confirmed Change]` (increase, decrease, new plan, removed plan, feature addition/removal, model change), `[No Change Detected]`, `[Insufficient Evidence]`, or `[Historical Value Unavailable]`.
5. **Evidence-Grounded Answers with Citations**:
   - Numeric bracketed citations (`[1]`, `[2]`) rigorously mapped to retrieved sources.
   - Hallucinated or non-existent citation indices are automatically stripped.
6. **Honest Uncertainty**:
   - Never invents historical prices or past conversations. If records do not exist for a requested date or entity, the agent clearly states that it has no record.
7. **Production-Ready Full-Stack Experience**:
   - Clean Next.js chat interface with Dark/Light theme, conversation sidebar, streaming SSE responses, research step pills, and citation cards.
   - Express backend with rate limiting, request timeout, and graceful shutdown.

---

## 🏗️ System Architecture

```
                    ┌─────────────────────────┐
                    │    Next.js Frontend     │
                    │   (React + App Router)  │
                    └───────────┬─────────────┘
                                │ SSE / HTTP
                    ┌───────────▼─────────────┐
                    │     Express Backend     │
                    │   (/api/chat, etc.)     │
                    └───────────┬─────────────┘
                                │
          ┌─────────────────────┴─────────────────────┐
          │                                           │
┌─────────▼──────────────┐                ┌───────────▼─────────────┐
│   Agent Orchestrator   │                │   SQLite (better-sqlite3)
│                        │                │   + Drizzle ORM         │
│  - Temporal Resolver   │                ├─────────────────────────┤
│  - Memory Retriever    │◄──────────────►│ - conversations         │
│  - Research Planner    │                │ - messages (FTS5 BM25)  │
│  - Web Search (Tavily) │                │ - entities              │
│  - Change Detector     │                │ - message_entities      │
│  - Citation Validator  │                │ - research_runs         │
└────────────────────────┘                │ - evidence              │
                                          │ - fact_observations     │
                                          └─────────────────────────┘
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm** or **pnpm**

### 2. Environment Setup
Copy the example environment file and set your API keys:

```bash
cp .env.example .env
```

Edit `.env`:
```env
PORT=4000
FRONTEND_PORT=3000
APP_TIMEZONE=Asia/Kolkata

OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o
TAVILY_API_KEY=your_tavily_api_key_here

MAX_SEARCH_CALLS_PER_REQUEST=4
MAX_TOOL_ROUNDS=2
DATABASE_PATH=data/minimi.sqlite
```

> **Note**: If `OPENAI_API_KEY` or `TAVILY_API_KEY` are not provided, the agent gracefully falls back to deterministic synthesis and mocked search in tests.

### 3. Install Dependencies
```bash
npm install
```

### 4. Run Development Mode
The single root command starts both the Express backend (port 4000) and the Next.js frontend (port 3000):

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Testing & Evaluation

### Distinction Between Automated Tests and Live External API Calls
- **Automated Tests (`npm run test` & `npm run eval`)**: Hermetic and deterministic. They use real SQLite databases, real FTS5 tables and triggers, real date algebra, and real change detection algorithms. External web search and OpenAI network calls are mocked with realistic fixtures so tests can execute without requiring paid third-party API credits.
- **Live Interactive Mode (`npm run dev`)**: Connects directly to the live OpenAI Chat Completions API with native tool calling (`tool_calls`) and the live Tavily Search API (`https://api.tavily.com/search`) whenever valid API keys are configured in `.env`.

### Run Automated Unit & Integration Tests (Vitest)
```bash
npm run test
```

Tests run completely without live API dependencies using mocked adapters:
- **Unit Tests**:
  - `tests/unit/temporalResolver.test.js`: Date resolving for "yesterday", "last Tuesday", "3 November", ambiguity detection.
  - `tests/unit/entityExtractor.test.js`: CRM, Postgres hosting, and general entity extraction.
  - `tests/unit/changeDetector.test.js`: Pricing increases, decreases, model changes, and feature additions/removals.
  - `tests/unit/evidenceValidation.test.js`: URL normalization, HTML/injection sanitization, and citation pruning.
  - `tests/unit/queryDeduplication.test.js`: Deduplication and query normalization.
  - `tests/unit/memoryRetriever.test.js`: FTS5 full-text search, temporal filtering, and research memory.
- **Integration Tests**:
  - `tests/integration/conversationPersistence.test.js`: DB persistence, cascade deletion.
  - `tests/integration/webSearchAdapter.test.js`: Tavily search, timeout aborts, and 500 error retries.
  - `tests/integration/agentToolExecution.test.js`: Bounded search limits (max 4 calls, max 2 rounds).
  - `tests/integration/citationValidation.test.js`: End-to-end citation mapping.
  - `tests/integration/historicalVsCurrent.test.js`: Change detection between historical baseline and live search.

### Run Benchmark Evaluation Suite
```bash
npm run eval
```

Executes all 8 hiring challenge evaluation scenarios and reports quantitative metrics:
1. Retrieve conversation from specific date.
2. Retrieve 5 previously discussed CRM providers.
3. Compare historical and current pricing.
4. Handle missing historical evidence (Honest uncertainty).
5. Answer without unnecessary web search.
6. Resolve "last Tuesday".
7. Handle conflicting search sources.
8. Handle unavailable or discontinued products.

---

## 🔌 API Documentation

### `POST /api/chat`
Streams research agent responses over Server-Sent Events (SSE).

**Request Body**:
```json
{
  "conversationId": "optional-uuid",
  "message": "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since?"
}
```

**SSE Events**:
- `event: status`: Real-time status update (`{ "step": "...", "message": "..." }`)
- `event: memory`: Memory retrieval stats (`{ "temporal": ..., "matchedEntities": [...] }`)
- `event: search_start`: Web search triggered (`{ "query": "...", "callIndex": 1, "maxCalls": 4 }`)
- `event: search_results`: Web search finished (`{ "query": "...", "count": 3 }`)
- `event: sources`: Retrieved evidence citations (`[{ "title": "...", "url": "..." }]`)
- `event: change_detection`: Analyzed fact changes (`[{ "entityName": "...", "status": "confirmed_change" }]`)
- `event: delta`: Incremental token stream (`{ "text": "..." }`)
- `event: done`: Execution complete (`{ "conversationId": "...", "messageId": "...", "citations": [...] }`)
- `event: error`: Error message if pipeline fails

### `GET /api/conversations`
List all persistent conversations.

### `GET /api/conversations/:id`
Retrieve conversation details with full message history, citations, and observations.

### `DELETE /api/conversations/:id`
Cascade-delete conversation and associated message records.

---

## ⚠️ Known Limitations & Future Work

1. **Complex Relative Clauses**: Resolves common temporal phrases deterministically; highly nested expressions (e.g., "the Tuesday before last Thanksgiving") fall back to ambiguity clarification.
2. **JavaScript ES Modules Native Build**: Native C++ compilation of `better-sqlite3` on Windows requires build tools or prebuilt binaries for specific Node versions.
3. **Headless JS Sites**: Web search extracts structured snippets and metadata via Tavily; deep client-side SPAs requiring browser automation (Puppeteer) are not executed in this lightweight setup.
