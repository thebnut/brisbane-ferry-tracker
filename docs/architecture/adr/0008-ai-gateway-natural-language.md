# ADR-0008: Optional natural-language layer behind Cloudflare AI Gateway

Status: Proposed, 18 October 2026. Revised after the Codex review (finding 13).

## Context
- Brett may add natural-language features:
  - "next train from Bowen Hills to the airport"
  - "is my 199 late"
  - alert summaries
  - Siri
- The app is free to the public, so cost and abuse must be bounded by construction.

## Decision
- **Order of resolution:**
  1. Native Siri and Shortcuts App Intents call structured endpoints directly. No LLM.
  2. The deterministic parser in `packages/core` uses a grammar and the fuzzy stop matcher. It targets 70% or more of questions.
  3. An **intent cache** keyed by normalised text (30 days). Only the parse is cached. The answer is always recomputed from live data.
  4. **LLM fallback:** Claude Haiku 5.5 ($0.10 / $0.50 per M tokens) through **Cloudflare AI Gateway**, using our own key (BYOK).
     - The model gets tools: `search_stops`, `get_departures`, `get_trip`, `get_alerts`.
     - Answers must be grounded in tool results and come back with the structured rows they used.
     - Limits: at most 2 tool rounds and `max_tokens` 400, with a cached system prompt.
     - There is no second paid provider by default, because it would escape the provider spend limit. On error, the answer degrades to a deterministic hint.
- **Alert summaries:** generated once per alert change in RtHub and cached for everyone.
- **Trip planning:** out of scope until a planner exists. The model must say so rather than invent an itinerary.
- **MCP:** the same tools, exposed as a read-only remote MCP server at `/mcp`, using `@modelcontextprotocol/sdk` 1.32 or `agents` 0.28. Caller-paid reasoning, so no token cost to us.
- **Cost controls (all required):**
  - `AI_ENABLED` kill switch.
  - Turnstile.
  - **Burst limits only** from the Workers Rate Limiting binding (10 s or 60 s windows, local and eventually consistent) and AI Gateway.
  - A strongly consistent **Budget Durable Object ledger** holds:
    - a per-IP daily quota of 10 questions, keyed by a hashed IP prefix
    - a global dollar budget
  - Before **every** provider attempt (retries and alert summaries included), the Worker atomically **reserves** a worst-case cost, then reconciles against actual usage. Alerts at 80%. Deterministic-only at 100%.
  - An Anthropic workspace spend limit, set just above the ledger budget, is the provider backstop.

## Alternatives
- **Vercel AI Gateway:** zero markup and $5/month of credit, but we are leaving Vercel.
- **OpenRouter:** markup and another account.
- **Direct provider calls:** no free logs, caching or fallback.
- **Workers AI open models:** cheaper per call, but weaker tool use. Kept as a possible fallback, but only inside the same ledger.
- **An LLM-first design:** cost grows with traffic, and it risks hallucinated times.

## Consequences
- Expected cost is about $0.36, $3.60 and $36 a month at 1k, 10k and 100k DAU, capped by budget.
- The layer can be off entirely without affecting anything else.
