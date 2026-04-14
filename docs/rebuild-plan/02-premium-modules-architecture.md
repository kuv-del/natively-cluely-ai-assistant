# Natively Premium Knowledge Engine — Explore Agent Report

**Generated:** 2026-04-13
**Scope:** 25 compiled `.js` files in `/tmp/patch-staging/dist-electron/premium/electron/` extracted from the installed DMG's `app.asar`
**Source of truth for:** module interfaces, dependency graph, LLM prompts, data shapes, and interview-vs-sales framing

---

## 1. Top-level Shape

Multi-stage LLM-powered coaching system in three architectural layers:

1. **Ingestion & embedding** — `DocumentReader`, `StructuredExtractor`, `DocumentChunker`, `PostProcessor`, `StarStoryGenerator` — converts raw docs (PDF/DOCX/TXT) into queryable knowledge nodes with embeddings
2. **Search & context assembly** — `HybridSearchEngine`, `ContextAssembler`, `IntentClassifier` — finds relevant resume/JD snippets and assembles system prompts
3. **Specialized engines** — `CompanyResearchEngine`, `GapAnalysisEngine`, `MockInterviewGenerator`, `NegotiationEngine`, `SalaryIntelligenceEngine`, `TechnicalDepthScorer`, `LiveNegotiationAdvisor`, `CultureValuesMapper` — pre-compute or generate coaching artifacts

**Main entry:** `KnowledgeOrchestrator` — stateful class that coordinates ingestion, caches active resume/JD, runs the AOT pipeline when a JD uploads, and assembles context for real-time queries.

**Persistence:** SQLite via `KnowledgeDatabaseManager` with 4 tables: knowledge_documents, context_nodes, company_dossiers, aot_results.

**Search providers:** pluggable — `NativelySearchProvider` or `TavilySearchProvider`.

**LLM integration:** via injected callbacks `generateContentFn` and `embedFn` — keeps the premium layer LLM-agnostic.

---

## 2. Module Inventory

### `types.js` — Type definitions
- **Exports:** `DocType` enum (RESUME, JD, COMPANY_WIKI, GENERIC), `IntentType` enum (TECHNICAL, INTRO, COMPANY_RESEARCH, NEGOTIATION, PROFILE_DETAIL, GENERAL)
- **Requires:** none
- Pure data, zero logic

### `DocumentReader.js` — PDF/DOCX/TXT extraction
- **Exports:** `extractDocumentText(filePath): Promise<string>`
- **Requires:** `fs`, `path`, `pdf-parse`, `mammoth`
- Validates text length (>50 chars); guards against scanned/empty PDFs

### `StructuredExtractor.js` — Raw text → JSON via LLM
- **Exports:** `extractStructuredData(rawText, type, generateContentFn)`
- **Requires:** `./types`, `./llmUtils`
- Defines JSON schemas for RESUME (identity, skills, experience, projects, education, achievements, certifications, leadership) and JD (title, company, location, level, requirements, technologies, keywords)
- Schema-driven LLM extraction with version-mismatch re-prompting

### `DocumentChunker.js` — Structured docs → embeddable nodes
- **Exports:** `chunkAndEmbedDocument`, `createDocumentNodes`, `calculateDurationMonths`, `extractTags`
- **Requires:** `./types`
- Per-experience-bullet, per-project, per-education, per-achievement, etc. chunking
- Calculates duration in months, extracts keyword+bigram tags for BM25-style filtering
- Embeds each node via injected `embedFn`

### `PostProcessor.js` — Resume normalization
- **Exports:** `processResume`, `computeTotalExperience`, `buildSkillExperienceMap`, `deduplicateSkills`, `normalizeTimeline`
- **Requires:** `./DocumentChunker`
- Sort experience/education by date desc, dedupe skills, compute total years, skill-to-months map
- Pure functional, no LLM calls

### `HybridSearchEngine.js` — Relevant-node retrieval
- **Exports:** `getRelevantNodes`, `detectCategoryHints`, `formatContextBlock`, `formatDossierBlock`
- **Requires:** `./types`
- Multi-factor scoring: cosine similarity (60%) + keyword match (20%) + recent work (10%) + duration >12mo (10%) + JD-matched skills (15%) + category hints (25%)
- Threshold 0.55, returns top-K (default 8)
- Category detection from question keywords (project, education, experience, leadership)

### `ContextAssembler.js` — System prompt builder ("inner voice")
- **Exports:** `assemblePromptContext`, `buildLiveNegotiationSystemPrompt`
- **Requires:** `./HybridSearchEngine`, `./NegotiationConversationTracker`
- **Interview-framed:** HEAVY. Must rewrite for sales.
- Detects intro questions ("tell me about yourself"), bare greetings
- Identity header tuned by job level (startup/research/staff) with tone modifiers
- Base knowledge engine rules: first person, no assistant phrases, use context as memory, no fabrication, speakable (~20-30s), distinguish experience from projects from education
- Just-in-time intro generation if asked

### `IntentClassifier.js` — Question categorization
- **Exports:** `classifyIntent`, `needsCompanyResearch`
- **Requires:** `./types`
- **Interview-framed:** HEAVY. Must rewrite for sales.
- Keyword-based rules (no LLM calls)
- Categories: INTRO, TECHNICAL, COMPANY_RESEARCH, NEGOTIATION, PROFILE_DETAIL, GENERAL

### `CompanyResearchEngine.js` — Web research + dossier synthesis
- **Exports:** `CompanyResearchEngine` class, `jdContextFromStructured(jd)`
- **Requires:** built-in `fetch`, `KnowledgeDatabaseManager`, optional search provider
- **Interview-framed:** HEAVY. Must rewrite for sales.
- Multi-query search (company info, reviews, engineering, hiring, salary)
- Fetches HTML, strips scripts, summarizes with LLM
- Dossier cached in DB with 24h TTL
- 2s rate limit, falls back to LLM-only if no search provider

### `NegotiationEngine.js` — Negotiation script generation
- **Exports:** `generateNegotiationScript(resume, jd, dossier, generateContentFn)`
- **Requires:** none (pure function)
- **Interview-framed:** HEAVY. Must rewrite for sales (pricing/terms/scope negotiation).
- Summarizes top 3 roles + 8 skills, pulls salary estimates + culture signals
- Prompts LLM for: opening_line (2 sent), justification (1 para), counter_offer_fallback (2 sent)
- Rules: anchor to upper range, reference achievements, adjust for culture score, suggest non-salary alternatives if benefits limited

### `GapAnalysisEngine.js` — Resume-to-JD gap analysis
- **Exports:** `analyzeGaps(resume, jd, skillExperienceMap, generateContentFn)`
- **Requires:** `./llmUtils`
- **Interview-framed:** HEAVY. Must rewrite for sales (objection/capability handling).
- Classifies JD skills as matched (>6mo exp), weak (<6mo), missing
- LLM generates 2-3 sentence "pivot scripts" for gaps
- Returns matched_skills, gaps, match_percentage

### `MockInterviewGenerator.js` — 10 expected interview questions
- **Exports:** `generateMockQuestions(resume, jd, dossier, gapAnalysis, generateContentFn)`
- **Requires:** `./llmUtils`
- **Interview-framed:** HEAVY. Must rewrite for sales (expected prospect objections/discovery).
- Generates mix: 3-4 technical, 2-3 behavioral STAR, 1-2 system design, 1-2 culture fit
- Each question: category, difficulty, rationale, suggested_answer_key

### `StarStoryGenerator.js` — Resume bullets → STAR narratives
- **Exports:** `generateStarStories`, `generateStarStoryNodes`, `starStoriesToNodes`
- **Requires:** `./types`, `./DocumentChunker`, `./llmUtils`
- **Interview-framed:** HEAVY. Rename "STAR" to "deal story" for sales.
- Batches 5 bullets at a time, LLM expands to STAR + full_narrative (80-120 words, first person, speakable)
- Preserves parent role/company/timeline metadata
- Converts to embeddable context nodes (category: "star_story")

### `CultureValuesMapper.js` — Stories ↔ company core values
- **Exports:** `mapStoriesToValues`, `resolveCompanyValues`, `findRelevantValueAlignments`
- **Requires:** `./llmUtils`
- **Interview-framed:** HEAVY. Reframe as "prospect priorities / buyer values alignment" for sales.
- Hardcoded frameworks: Amazon 16 LPs, Google 7, Netflix 9, Meta 6, Microsoft 5
- Batches 5 stories per LLM call, maps each to 1-2 core values with alignment quote + evidence + strength_score
- Dynamic retrieval during chat

### `TechnicalDepthScorer.js` — Interviewer tone tracking
- **Exports:** `TechnicalDepthScorer` class (`addUtterance`, `getToneXML`, `getToneDirective`)
- **Requires:** none
- **Interview-framed:** HEAVY. Reframe as "prospect role detection (exec vs engineer)" for sales.
- Hardcoded 100+ technical term dictionary
- Maps depth: novice → simple analogies, intermediate → CS fundamentals, expert → jargon, architect → tradeoffs

### `SalaryIntelligenceEngine.js` — Salary range estimator
- **Exports:** `SalaryIntelligenceEngine` class (`estimateFromResume`, `getCachedEstimate`, static `buildSalaryContextBlock`)
- **Requires:** `./llmUtils`
- **Interview-framed:** MEDIUM. Possibly reframable to revenue/commission estimation.
- Country detection → local currency (INR/GBP/EUR/USD)
- LLM estimate: min, max, confidence, justification_factors
- Cache keyed on (name, role, company), in-flight promise guard

### `NegotiationConversationTracker.js` — Live negotiation state machine
- **Exports:** `NegotiationConversationTracker` class, `escapeXml(raw)`
- **Requires:** none
- **Interview-framed:** HEAVY. Reframe phases as deal progression for sales.
- Phase state machine: INACTIVE → PROBE → ANCHOR → COUNTER → HOLD → PIVOT_BENEFITS → CLOSE
- Regex-based amount extraction from utterances
- Signal detection: pushback/rejection/acceptance
- 2-pushback trigger → PIVOT_BENEFITS

### `LiveNegotiationAdvisor.js` — Real-time coaching during negotiations
- **Exports:** `generateLiveCoachingResponse(tracker, userQuestion, resume, jd, dossier, negotiationScript, generateContentFn)`
- **Requires:** `./NegotiationConversationTracker`, `./ContextAssembler`
- **Interview-framed:** HEAVY. Must rewrite for sales (objection/pricing/close coaching).
- Phase-specific instructions — PROBE: delay ask; ANCHOR: counter 10-15% above; COUNTER: hold; HOLD: don't drop; PIVOT_BENEFITS: signing bonus first; CLOSE: request written offer 24-48h
- Returns `{tacticalNote, exactScript, phase, theirOffer, yourTarget, showSilenceTimer}`
- 5s timeout with fallback to negotiation script opening line

### `AOTPipeline.js` — Pre-compute artifacts on JD upload
- **Exports:** `AOTPipeline` class with `runForJD(jd, resume)`
- **Requires:** types + CompanyResearchEngine + NegotiationEngine + GapAnalysisEngine + PostProcessor + MockInterviewGenerator + CultureValuesMapper
- Fire-and-forget background pipeline
- Concurrently pre-computes: company research, negotiation script, gap analysis, mock questions, culture mappings
- `Promise.allSettled` so failures don't block siblings
- Persists results to DB

### `KnowledgeOrchestrator.js` — **MAIN ENTRY POINT**
- **Exports:** `KnowledgeOrchestrator` class
- **Requires:** ALL sibling modules (14 direct deps)
- **Stateful fields:** activeResume, activeJD, cachedNodes, depthScorer, aotPipeline, salaryEngine, negotiationTracker
- **Key methods:**
  - `ingestDocument(filePath, type)` — reads → extracts → structures → chunks → embeds → saves → generates STAR stories (resume) → triggers AOT pipeline (JD)
  - `processQuestion(question)` — classifies intent → detects category hints → retrieves nodes → assembles dossier context → detects gaps + pivot scripts → detects culture alignments → assembles final prompt
  - `setGenerateContentFn(fn)`, `setEmbedFn(fn)` — dependency injection
  - `getCompanyResearchEngine()`, `getAOTPipeline()` — exposed for external access
  - `getStatus()`, `getProfileData()` — UI queries
  - `feedInterviewerUtterance(text)` — updates depth scorer + negotiation tracker
  - `resetNegotiationSession()` — clear state
  - `getVocabularyHints()` — STT hint words (company, title, skills, keywords)

### `KnowledgeDatabaseManager.js` — SQLite persistence
- **Exports:** `KnowledgeDatabaseManager` class
- **Requires:** sqlite3 injected
- **Schema:**
  - `knowledge_documents` (id, type, source_uri, structured_data JSON, created_at)
  - `context_nodes` (id, document_id, source_type, category, title, org, start_date, end_date, duration_months, text_content, tags JSON, embedding BLOB)
  - `company_dossiers` (id, company_name UNIQUE, last_checked, dossier_json, source_trace, ttl_hours)
  - `aot_results` (id, document_id, result_type, result_json, UNIQUE(document_id, result_type))
- Standard relational schema, embedding stored as BLOB (float32)

### `llmUtils.js` — LLM call utilities
- **Exports:** `callWithTimeout`, `callWithRetry`, `extractJSONArray`, `extractJSONObject`
- **Requires:** none
- `callWithTimeout`: Promise race with timer, default 30s
- `callWithRetry`: retry once after 1s on error
- JSON extraction: regex `[...]` or `{...}`

### `NativelySearchProvider.js` — Natively.software search API
- **Exports:** class with `search(query, numResults)`
- **Requires:** `crypto`
- POSTs `api.natively.software/v1/search` with session_id
- 429 → sets quotaExhausted flag
- Returns `[{title, link, snippet}]`, 12s timeout

### `TavilySearchProvider.js` — Tavily search API
- **Exports:** class with `search(query, numResults)`
- **Requires:** `@tavily/core`
- Tavily SDK with searchDepth=advanced, maxResults, includeRawContent=markdown
- Tracks creditsUsed per session
- Handles 401/429/432/433/500

### `LicenseManager.js` (services/) — License validation
- **Exports:** singleton with `getInstance`, `activateLicense`, `activateWithApiKey`, `isPremium`, `isPremiumAsync`, `getLicenseDetails`, `getHardwareId`, `deactivate`
- **Requires:** `electron`, `fs`, `path`, native module loader
- Dodo Payments first, Gumroad fallback
- Encrypts key + HWID → stores `userData/license.enc`
- Activation race guard (`activationInFlight`)
- Hardware binding via native module crypto

---

## 3. Dependency Graph

**Ingestion pipeline:**
```
KnowledgeOrchestrator
  → DocumentReader → (fs, pdf-parse, mammoth)
  → StructuredExtractor → types, llmUtils → [LLM]
  → DocumentChunker → types
    → StarStoryGenerator → llmUtils → [LLM]
  → PostProcessor → DocumentChunker
  → KnowledgeDatabaseManager → (sqlite3)
```

**Real-time query pipeline:**
```
KnowledgeOrchestrator
  → IntentClassifier → types
  → HybridSearchEngine → types (vectors + keywords + heuristics)
  → CompanyResearchEngine
    → NativelySearchProvider or TavilySearchProvider
    → llmUtils → [LLM]
    → KnowledgeDatabaseManager
  → ContextAssembler
    → NegotiationConversationTracker
    → llmUtils → [LLM]
  → GapAnalysisEngine → llmUtils → [LLM]
  → MockInterviewGenerator → llmUtils → [LLM]
  → CultureValuesMapper → llmUtils → [LLM]
  → SalaryIntelligenceEngine → llmUtils → [LLM]
  → LiveNegotiationAdvisor
    → NegotiationConversationTracker
    → ContextAssembler
    → llmUtils → [LLM]
  → TechnicalDepthScorer
```

**AOT pipeline (background on JD upload):**
```
AOTPipeline
  → CompanyResearchEngine → (search, fetch, LLM)
  → NegotiationEngine → [LLM]
  → GapAnalysisEngine → [LLM]
  → MockInterviewGenerator → [LLM]
  → CultureValuesMapper → [LLM]
  → KnowledgeDatabaseManager
```

**No circular dependencies.**

**External dependencies:**
- npm: `fs`, `path`, `crypto`, `electron`, `pdf-parse`, `mammoth`, `@tavily/core`, `fetch` (Node 18+)
- Native: `nativeModuleLoader` (C++ bindings for license crypto)

---

## 4. Integration Surface (External to Premium)

**Outbound requires (premium → parent):**
- `../../../electron/audio/nativeModuleLoader` — LicenseManager loads native C++ crypto module

**Inbound IPC from main process:**
- KnowledgeOrchestrator methods: `ingestDocument`, `processQuestion`, `setGenerateContentFn`, `setEmbedFn`, `setKnowledgeMode`, `getStatus`, `getProfileData`, `deleteDocumentsByType`, `feedInterviewerUtterance`, `getNegotiationTracker`, `resetNegotiationSession`
- AOTPipeline: `getStatus()` via orchestrator
- LicenseManager singleton: `activateLicense`, `isPremiumActive`

**Search providers:** consumed via API key injection from main config

---

## 5. LLM Prompts & Interview Framing

| Module | LLM? | Interview-framed | Sales rewrite needed |
|---|---|---|---|
| StructuredExtractor | Yes | No (schema-neutral) | No |
| DocumentChunker | No | — | No |
| PostProcessor | No | — | No |
| HybridSearchEngine | No | — | No |
| **ContextAssembler** | Yes | **HEAVY** | **YES** |
| **IntentClassifier** | No (rules) | **HEAVY** | **YES** |
| **CompanyResearchEngine** | Yes | **HEAVY** | **YES** |
| **NegotiationEngine** | Yes | **HEAVY** | **YES** |
| **GapAnalysisEngine** | Yes | **HEAVY** | **YES** |
| **MockInterviewGenerator** | Yes | **HEAVY** | **YES** |
| **StarStoryGenerator** | Yes | HEAVY | **YES** |
| **CultureValuesMapper** | Yes | HEAVY | **YES** |
| **TechnicalDepthScorer** | No | HEAVY | **YES** |
| SalaryIntelligenceEngine | Yes | Medium | Maybe |
| **NegotiationConversationTracker** | No | HEAVY | **YES** |
| **LiveNegotiationAdvisor** | Yes | **HEAVY** | **YES** |
| AOTPipeline | Delegates | — | **YES** (cascades) |
| KnowledgeOrchestrator | Delegates | Heavy | **YES** |
| KnowledgeDatabaseManager | No | — | No |
| llmUtils | No | — | No |
| NativelySearchProvider | No | — | No |
| TavilySearchProvider | No | — | No |
| LicenseManager | No | — | No |

**13 modules need sales reframing.**

### Key prompts to rewrite

**ContextAssembler — `knowledge_engine_rules` block:**
- "You are the candidate's INNER VOICE during an interview" → "You are Kate's inner voice during a live sales prospect call"
- "speakable (~20-30 seconds)" → whatever pacing Kate prefers
- Distinguish-experience rules → distinguish deal stages / call phases
- "interviewing for {level} at {company}" → "selling into {industry/ICP} at {company}"

**IntentClassifier — intent buckets:**
- Replace: TECHNICAL, INTRO, COMPANY_RESEARCH, NEGOTIATION, PROFILE_DETAIL, GENERAL
- With: DISCOVERY, OBJECTION, PRICING, DEMO_REQUEST, CLOSE, FOLLOW_UP

**NegotiationEngine — negotiation script:**
- Salary range → deal value range
- "opening_line" → price anchor / package framing
- "counter_offer_fallback" → discount ceiling / scope trade-offs

**GapAnalysisEngine — pivot scripts:**
- Skill gaps → capability gaps in prospect's current solution
- Transferable skills → alternative value props

**MockInterviewGenerator — expected questions:**
- "10 interview questions" → "10 expected prospect objections / discovery questions"
- Technical/behavioral/system-design/culture-fit → pricing/capability/integration/procurement/risk

**LiveNegotiationAdvisor — phase coaching:**
- Phase names: PROBE/ANCHOR/COUNTER/HOLD/PIVOT_BENEFITS/CLOSE
- → Deal phases: DISCOVERY/QUALIFY/PROPOSE/OBJECT/NEGOTIATE/CLOSE
- Phase instructions rewritten for sales conversation dynamics

**CompanyResearchEngine — dossier schema:**
- `hiring_strategy` → `sales_process / buyer_journey`
- `interview_focus` → `deal_priorities`
- `employee_reviews` → `customer_testimonials / case_studies`
- `culture_ratings` → `buyer_satisfaction / implementation_success`

---

## 6. Data Shapes

See full report for complete TypeScript interfaces. Key shapes:

- **Resume** — identity, skills[], experience[], projects[], education[], achievements[], certifications[], leadership[]
- **JobDescription** — title, company, location, level, employment_type, requirements[], technologies[], keywords[]
- **ContextNode** — source_type (DocType), category, title, organization, start_date, end_date, duration_months, text_content, tags[], embedding[]
- **CompanyDossier** — company, hiring_strategy, interview_focus, interview_difficulty, salary_estimates[], culture_ratings{}, employee_reviews[], critics[], benefits[], competitors[], recent_news, core_values[], sources[]
- **NegotiationScript** — opening_line, justification, counter_offer_fallback, salary_range{min, max, currency, confidence}, sources[]
- **GapAnalysis** — matched_skills[], gaps[{skill, gap_type, pivot_script, transferable_skills[]}], match_percentage
- **MockQuestion** — question, category, difficulty, rationale, suggested_answer_key
- **StarStory** — original_bullet, situation, task, action, result, full_narrative, parent_role, parent_company, timeline
- **NegotiationState** — phase, offers{latestRecruiterAmount, trajectory, allEvents[]}, userTarget, pushbackCount, benefitsMentioned[], vagueOfferDetected

---

## 7. Architectural Patterns

- **Dependency injection** — LLM + embed functions injected at runtime → LLM-agnostic
- **Hybrid search** — dense vectors + sparse keywords + heuristic boosts
- **State machine** — NegotiationConversationTracker deterministic phase transitions
- **Fire-and-forget AOT** — JD upload triggers concurrent pre-compute with `Promise.allSettled`
- **Cache hierarchies** — document cache (active resume/JD), node cache, 24h dossier TTL, embedding BLOB, salary estimate memoization
- **Batch LLM processing** — StarStoryGenerator + CultureValuesMapper batch 5 items/call
- **Timeout + retry** — llmUtils standard 30s timeout, 1-retry with 1s delay
- **Graceful degradation** — CompanyResearchEngine falls back to LLM-only if search fails
- **Context assembly layering** — identity header → base rules → tone directive → company dossier → salary block → gap pivots → mock hints → culture alignments

---

## Summary

**25 modules total. 13 need sales reframing. No circular dependencies. Entry points: KnowledgeOrchestrator + LicenseManager.**

Cleanly layered and decoupled enough that a sales rebuild can reuse most of the scaffolding (document ingestion, chunking, search, AOT pipeline, state machine architecture, cache hierarchies) and only rewrite the prompt-heavy modules + the intent classifier's category map.
