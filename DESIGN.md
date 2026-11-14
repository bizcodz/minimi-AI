# Minimi AI — System Design & Architecture

## 1. How the System Works

Minimi AI is a bounded, evidence-grounded research agent designed around a strict 12-step execution pipeline:
1. **Receive & Validate**: The Express HTTP layer validates user input via Zod and opens a Server-Sent Events (SSE) stream.
2. **Temporal Resolution**: Natural language temporal references ("yesterday", "last Tuesday", "3 November") are resolved deterministically to exact UTC time boundaries based on the configured timezone (`Asia/Kolkata`).
3. **Three-Tier Memory Retrieval**: The agent retrieves episodic messages within the temporal window, queries SQLite FTS5 for keyword relevance with BM25 ranking, and extracts matched entities.
4. **Historical Fact Retrieval**: Retrieves prior `fact_observations` and past evidence linked to the matched entities.
5. **Research Planning**: The Research Planner assesses whether the user's intent is pure episodic recall (which skips web search entirely) or requests current freshness/verification.
6. **OpenAI Tool Calling & Bounded Web Research**: When OpenAI credentials are provided, the model is provided the single `web_search` tool definition (`tool_choice: 'auto'`). If the model decides search is needed, it emits structured `tool_calls`. The orchestrator validates queries using Zod, enforces hard bounds (max 4 calls, max 2 rounds, query deduplication), executes Tavily, and returns tool messages to the model. When credentials are absent or in offline test mode, the bounded heuristic planner and deterministic synthesis execute seamlessly.
7. **Evidence Sanitization & Persistence**: Web snippets are sanitized against prompt injection and saved to `research_runs` and `evidence`.
8. **Automated Change Detection**: The `ChangeDetector` compares new evidence against historical observations, identifying price increases/decreases, plan shifts, and feature updates.
9. **Grounded Response Generation**: The system builds a structured context prompt with honest uncertainty instructions. The LLM streams tokens back over SSE.
10. **Citation Validation**: Bracketed citations `[1]`, `[2]` are validated against retrieved URLs. Hallucinated indices are stripped.
11. **Persistence**: The conversation, messages, and newly verified observations are saved to SQLite.
12. **Completion**: SSE emits the `done` event with verified citations and change summaries.

---

## 2. Why This Architecture Was Selected

- **JavaScript ES Modules (No TypeScript)**: Minimizes transpilation overhead, avoids runtime compilation friction, and adheres strictly to the hiring challenge mandate while maintaining strict schemas with Zod and Drizzle.
- **SQLite (`better-sqlite3` & `node:sqlite` dual engine) + Drizzle ORM**: Zero external database infrastructure dependencies. Runs natively and synchronously in Node.js with WAL mode, sub-millisecond query latencies, and persistent storage across server restarts. Smoothly supports standard LTS `better-sqlite3` native binaries and falls back automatically to Node's built-in `node:sqlite` (`DatabaseSync` with full FTS5 support).
- **SQLite FTS5 + Deterministic Triggers**: Eliminates complex vector database sidecars (e.g., Pinecone/Milvus). Provides deterministic BM25 full-text keyword retrieval and fast time-window indexing.
- **Decoupled Agent Layer**: The agent core (`src/agent/`) is completely decoupled from Express and Next.js, allowing independent automated unit testing, CLI evaluation, and API consumption.

---

## 3. Memory & Retrieval Strategy

Instead of relying on fragile LLM-generated summaries or lossy rolling buffers, Minimi AI uses three distinct memory tiers:
1. **Episodic Memory**: Stores raw user and assistant messages with exact UTC ISO timestamps. Temporal queries filter directly on SQLite indexed date boundaries.
2. **Entity Memory**: Normalizes and indexes companies, products, and technologies (e.g., HubSpot, Neon, Supabase) linked to messages through a junction table.
3. **Research Memory**: Stores structured `fact_observations` (claim, numerical value, currency, billing interval, observed timestamp).

Retrieval combines deterministic date-window slicing, entity graph joins, and FTS5 BM25 keyword matching.

---

## 4. Web Search Strategy

The system enforces bounded execution to prevent infinite tool loops, high latency, and runaway costs:
- **Single Tool**: Only `web_search` is exposed.
- **Hard Execution Limits**: Configurable via environment variables (`MAX_SEARCH_CALLS_PER_REQUEST = 4`, `MAX_TOOL_ROUNDS = 2`, `SEARCH_TIMEOUT_MS = 10000`).
- **Query Deduplication**: Normalizes search queries by removing stop words and token-sorting to prevent duplicate Tavily requests.
- **Untrusted Data Boundary**: Search snippets are sanitized by stripping HTML, script tags, and prompt injection delimiters before insertion into LLM context.

---

## 5. Evidence & Change Detection

- **Immutable History**: Historical observations are **never overwritten**. New observations are inserted alongside older ones with timestamps.
- **Classification Taxonomy**:
  - `[Confirmed Change]`: Numerical price increase/decrease, plan addition/removal, or feature modification.
  - `[No Change Detected]`: Explicitly verified that current pricing matches past records.
  - `[Insufficient Evidence]`: Web sources are inconclusive.
  - `[Historical Value Unavailable]`: First recorded observation for an entity (no prior baseline).
- **Equivalent Comparison**: Compares normalized currency and billing intervals before assessing numerical delta.

---

## 6. Alternatives Considered & Rejected

1. **Vector DB (Chroma/Pinecone) for Memory**: Rejected. Vector embeddings struggle with precise temporal boundaries (e.g. distinguishing "last Tuesday" from "two Tuesdays ago"). SQLite FTS5 + deterministic date windowing guarantees exact temporal recall.
2. **LLM Chain-of-Thought Scratchpad in User Output**: Rejected. Prompt instructions enforce clean, direct user-facing answers with zero leaked internal reasoning.
3. **Unbounded Agent Loops**: Rejected. Multi-agent loops frequently run into runaway latency and cost. Explicit 2-round / 4-call bounding ensures predictable execution time.

---

## 7. Trade-offs

- **Deterministic Date Parser vs LLM Date Parser**: Deterministic regex covers 95% of standard temporal patterns with 0 latency and 0 cost, but cannot resolve ambiguous poetic phrasing (e.g. "when leaves were falling"). In those cases, the agent explicitly prompts for clarification.
- **Snippet-Based Change Detection**: Relies on Tavily's extracted snippets. Highly dynamic JavaScript SPAs without server-rendered pricing tables may return incomplete snippets, triggering `[Insufficient Evidence]`.

---

## 8. What Another Week of Development Would Improve

1. **Headless Browser Sidecar**: Add a sandboxed Puppeteer/Playwright headless fetcher for full-page DOM diffing on pricing tables.
2. **Automated Entity Alias Resolution**: Use an offline embedding index to automatically map custom product variants to parent entities.
3. **Multi-Region Currency Normalization**: Real-time FX conversion for comparing international pricing (e.g., EUR vs USD).
4. **WebSocket Fallback**: Provide duplex WebSockets alongside SSE for environments where HTTP proxy buffering interferes with SSE chunk streaming.
