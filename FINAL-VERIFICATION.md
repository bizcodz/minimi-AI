# Minimi AI — Final Real-World Smoke Test & Verification Report

**Execution Timestamp**: November 14, 2026  
**Operating Environment**: Windows x64, Node.js v26.3.0, npm 10.9.4, pnpm v12.14.0  
**Verification Scope**: Verification of hiring challenge commands, server startup, health endpoint, temporal reasoning, memory persistence across restart, change detection, citation defusing, API key transparency, security scanning, and architectural design alignment.

---

## 1. Hiring Challenge Commands Verification

### A. Clean Dependency Installation (`npm install` / `pnpm install`)
- **Command**: `pnpm install` (executed cleanly without `--ignore-scripts`)
- **Output**:
  ```text
  ✓ Lockfile passes supply-chain policies
  Lockfile is up to date, resolution step is skipped
  Already up to date
  Done in 388ms using pnpm v12.14.0
  ```
- **Exit Code**: `0`
- **Result**: **PASS**

### B. Automated Testing (`npm run test`)
- **Command**: `npm run test`
- **Output**:
  ```text
  > minimi-ai@1.0.0 test
  > vitest run

   RUN  v2.1.9 C:/Users/keert/minimi-AI

   ✓ tests/integration/citationValidation.test.js (3 tests)
   ✓ tests/unit/temporalResolver.test.js (8 tests)
   ✓ tests/unit/queryDeduplication.test.js (3 tests)
   ✓ tests/unit/evidenceValidation.test.js (4 tests)
   ✓ tests/integration/webSearchAdapter.test.js (4 tests)
   ✓ tests/unit/changeDetector.test.js (8 tests)
   ✓ tests/unit/entityExtractor.test.js (4 tests)
   ✓ tests/integration/conversationPersistence.test.js (1 test)
   ✓ tests/unit/memoryRetriever.test.js (2 tests)
   ✓ tests/integration/historicalVsCurrent.test.js (1 test)
   ✓ tests/integration/agentToolExecution.test.js (4 tests)
   ✓ tests/integration/serverRoutes.test.js (2 tests)

   Test Files  12 passed (12)
        Tests  44 passed (44)
     Duration  2.47s
  ```
- **Exit Code**: `0`
- **Result**: **PASS** (100% pass rate across 12 suites, 44 tests)

### C. Production Build (`npm run build`)
- **Command**: `npm run build`
- **Output**:
  ```text
  > minimi-ai@1.0.0 build
  > next build

    ▲ Next.js 14.2.35

     Creating an optimized production build ...
   ✓ Compiled successfully
     Linting and checking validity of types ...
     Collecting page data ...
   ✓ Generating static pages (4/4)
     Finalizing page optimization ...
     Collecting build traces ...

  Route (app)                              Size     First Load JS
  ┌ ○ /                                    5.23 kB        92.4 kB
  └ ○ /_not-found                          873 B          88.1 kB
  + First Load JS shared by all            87.2 kB

  ○  (Static)  prerendered as static content
  ```
- **Exit Code**: `0`
- **Result**: **PASS** (Zero compilation errors, static pages prerendered)

### D. Benchmark Evaluation Suite (`npm run eval`)
- **Command**: `pnpm run eval`
- **Output**:
  ```text
  ======================================================================
    MINIMI AI — BENCHMARK EVALUATION SUITE
  ======================================================================
  ✓ PASS   | 1. Retrieve conversation from specific date
  ✓ PASS   | 2. Retrieve 5 previously discussed CRM providers
  ✓ PASS   | 3. Compare historical and current pricing
  ✓ PASS   | 4. Handle missing historical evidence (Honest uncertainty)
  ✓ PASS   | 5. Answer without unnecessary web search
  ✓ PASS   | 6. Resolve "last Tuesday"
  ✓ PASS   | 7. Handle conflicting search sources
  ✓ PASS   | 8. Handle unavailable or discontinued products
  ----------------------------------------------------------------------
  BENCHMARK METRICS:
    Accuracy Rate:               100.0% (8/8)
    Bounded Tool Execution:      100.0% compliant (max 4 calls, 2 rounds)
    Citation Precision:          100.0% verified against evidence
  ======================================================================
  ✓ All 8 evaluation scenarios completed successfully!
  ```
- **Exit Code**: `0`
- **Result**: **PASS**

### E. Development Server Startup (`npm run dev`)
- **Backend Component**: `node src/server.js` (Express on port 4000)
- **Frontend Component**: `next dev -p 3000` (Next.js on port 3000)
- **Combined Runner**: `concurrently -k -n backend,frontend -c green,cyan "node src/server.js" "next dev -p 3000"`
- **Startup Verification**:
  ```text
  [Minimi AI Backend] Server running on http://127.0.0.1:4000
  [Minimi AI Backend] Configured timezone: Asia/Kolkata
  ▲ Next.js 14.2.35
  - Local:        http://localhost:3000
  ```
- **Result**: **PASS**

---

## 2. Server Startup & Health Endpoint Verification

- **Command**: `node scripts/smokeTest.js`
- **Health Endpoint Output**:
  ```json
  {
    "status": "healthy",
    "timestamp": "2026-11-14T09:32:42.434Z",
    "timezone": "Asia/Kolkata",
    "limits": {
      "maxSearchCalls": 4,
      "maxToolRounds": 2
    },
    "apiKeysConfigured": {
      "openai": false,
      "tavily": false
    }
  }
  ```
- **Result**: **PASS**

---

## 3. Real-World Smoke Test Execution Matrix

| Test Item | Scenario / Input | Actual Output | Status |
| :--- | :--- | :--- | :---: |
| **Memory Persistence** | Saved conversation to disk DB, closed process, reopened connection | `Retrieved Title: "Smoke Test Conversation", Message: "Remember that we shortlisted Supabase for Pos..."` | **PASS** |
| **Temporal Date Algebra** | "What did I ask you yesterday?"<br>"What did we discuss on 3 November?"<br>"What did I ask you last Tuesday?" | `Yesterday: 2026-11-13`<br>`3 Nov: 2026-11-03`<br>`Last Tue: 2026-11-10` | **PASS** |
| **Change Detection** | Baseline $25/mo vs live evidence $29/mo | `Status: confirmed_change`<br>`Summary: "Price increased from USD 25 to USD 29"` | **PASS** |
| **Citation Grounding & Link Defusing** | Verified sources vs hallucinated `[88]` and unverified URL (`https://phishing.com`) | `Validated Citations: 1`<br>`Defused text: "Supabase Pro is $25 [1]. Fake cite . External doc: [Supabase Guide](https://supabase.com/docs) and Fake."` | **PASS** |
| **Missing API Key Transparency** | Query requiring web research when `TAVILY_API_KEY` is omitted | `Warning emitted: true`<br>`Response: "I do not have sufficient historical records for this request, and TAVILY_API_KEY is not configured to execute live web search."` | **PASS** |
| **Live External API Integration** | End-to-end OpenAI tool-calling and Tavily web search with live billing credentials | `NOT RUN: Live OPENAI_API_KEY and/or TAVILY_API_KEY not configured in environment.` (Tested via hermetic mock adapters). | **NOT RUN** |

---

## 4. GitHub & Repository Hygiene Audit

- **`.gitignore` Audit**:
  - Excludes `node_modules/`, `.pnpm-store/`
  - Excludes build artifacts: `.next/`, `out/`, `build/`, `dist/`
  - Excludes SQLite database files: `*.sqlite`, `*.sqlite-journal`, `*.sqlite-wal`, `data/`
  - Excludes local environment files: `.env`, `.env.local`, `.env.*.local`
  - Excludes all logs: `*.log`, `npm-debug.log*`, `pnpm-debug.log*`
- **`.env.example` Audit**:
  - Exists and is tracked.
  - Contains all required environment variable keys with clear placeholder tokens (`your_openai_api_key_here`, `your_tavily_api_key_here`).
  - Zero private credentials or live secrets exposed.
- **Repository Secret Scan**:
  - Scanned all source files (`src/`, `scripts/`, `tests/`, root config files) using regex `sk-[a-zA-Z0-9]{20,}|tvly-[a-zA-Z0-9]{20,}`.
  - Result: `SCAN COMPLETED: ZERO SECRETS FOUND`.

---

## 5. Architectural Alignment ([DESIGN.md](file:///c:/Users/keert/minimi-AI/DESIGN.md))

The architectural design was reviewed and verified against the source code:
1. **OpenAI Native Tool Calling**: Section 1 & Section 4 document the two-stage execution pipeline (Zod-validated tool calls, bounded execution with max 4 calls and 2 rounds, and streaming grounded synthesis).
2. **Dual SQLite Engine**: Documented synchronous fallback from `better-sqlite3` native binaries to Node 26 standard library `node:sqlite` (`DatabaseSync` + FTS5).
3. **Automated vs Live Testing**: `README.md` and `DESIGN.md` clearly state the boundary between hermetic mock-backed automated tests and live interactive execution.

---

## 6. Remaining Limitations

1. **Live External API Keys**: Running live web search and OpenAI generation requires valid `OPENAI_API_KEY` and `TAVILY_API_KEY` in `.env`. When credentials are not configured, the agent safely falls back to local memory and deterministic synthesis mode while emitting an honest status notification.
2. **Dynamic Client-Side Single-Page Applications**: Web search extracts structured content from Tavily's cleaned snippets and metadata. Full-page JavaScript DOM execution requiring headless browser engines (Puppeteer/Playwright) is not included in this lightweight runtime.

---

## 7. Final Submission-Readiness Recommendation

**Verdict: READY FOR SUBMISSION**

The application satisfies all core functional and non-functional requirements:
- Clean pure ES Module architecture with zero TypeScript.
- Persistent SQLite database with automated FTS5 full-text search triggers.
- Mathematically verified temporal date algebra using `Asia/Kolkata` with UTC ISO boundaries.
- Native OpenAI function/tool calling architecture with strict Zod validation and hard execution limits (max 4 calls, max 2 rounds).
- Change detection matrix handling price shifts, feature changes, and explicit insufficient evidence states.
- 100% pass rate across 44 automated tests and 8 hiring challenge evaluation scenarios.
- Zero secrets committed; clean build and dev execution.
