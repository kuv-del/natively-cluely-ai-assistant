# Sales Context Patches — Source of Truth

This document captures all prompt rewrites applied to the 13 LLM-heavy premium modules
via `scripts/patch-premium-prompts.ts`. The patch script runs at rebuild time on the
staging directory (see `natively-rebuild` skill, step 6a).

**Context:** Kate Schnetzer, Account Executive at The Scalable Company, selling the
Scale and Exit program ($30,000 fee) to founders running $2–10M revenue businesses.

---

## Terminology Map

| Original (interview) | Sales replacement |
|---|---|
| candidate / the candidate | Kate / the rep |
| interview / interviewing | sales call / discovery call / demo call |
| interviewer | prospect / buyer |
| resume | Kate's offer profile (Scale and Exit program details, track record, case studies) |
| job description / JD | prospect profile (company, pain points, decision maker info) |
| hiring manager / recruiter | prospect / decision maker / founder |
| salary / compensation | price / deal value / $30k program fee |
| salary negotiation | price negotiation |
| job offer | signed proposal / closed deal |
| technical interview question | capability objection / implementation concern |
| behavioral question / STAR | value story / case study (same STAR format, different content) |
| culture fit | buyer fit / priority alignment |
| employee reviews | customer testimonials / case studies / Scale and Exit alumni wins |
| benefits | program deliverables / guarantees / support hours |

---

## Module-by-Module Patches

### 1. ContextAssembler.js (32 patches)

**Key rewrites:**
- Inner voice identity: "You are the candidate's INNER VOICE during an interview" → "You are Kate's INNER VOICE during a live sales call with a prospect"
- Speakable timing: "~20-30 seconds unless coding" → "~20-30 seconds. Sales calls move fast"
- Context sections: `<candidate_experience>` / `<candidate_projects>` → `<offer_profile>` / `<case_studies>` / `<program_deliverables>` / `<track_record>`
- Salary rules: `<salary_intelligence>` → `<roi_intelligence>`; anchoring explanation → "$30k program fee confidently, no discounting"
- Live negotiation system prompt: "expert salary negotiation coach" → "expert sales negotiation coach for Kate Schnetzer selling Scale and Exit"
- JIT intro generation: "interview self-introduction" → "sales opening"; bad/good examples rewritten for sales context

### 2. IntentClassifier.js (11 patches)

**Key rewrites:**
- `COMPANY_RESEARCH_PATTERNS`: "hiring strategy" → "scaling strategy"; "hiring style" → "growth trajectory"; "interview process" → "buying process"
- `NEGOTIATION_PATTERNS`: "salary" → "price"; "compensation" → "cost"; "expected salary" → "program fee"
- `TECHNICAL_PATTERNS`: "system design" → "implementation approach"
- `PROFILE_DETAIL_PATTERNS`: "what have you built" → "what results have you delivered"; "what did you build" → "what have clients achieved"; "your background" → "track record"; "work history" → "client history"

### 3. CompanyResearchEngine.js (22 patches)

**Key rewrites:**
- Search queries: "hiring strategy careers" → "scaling strategy growth challenges"; "interview process" → "buying process decision makers"; "glassdoor reviews employee rating" → "customer reviews testimonials case studies"; "employee complaints criticism" → "operational challenges founder bottleneck"; "employee benefits perks" → "business model revenue streams market position"
- Dossier schema: `hiring_strategy` → `scaling_strategy`; `interview_focus` → `deal_priorities`; `interview_difficulty` → `deal_complexity`; `salary_estimates` → `roi_estimates` (with `annual_cost_of_inaction`, `three_year_compounded`, `roi_vs_30k`); `culture_ratings` → `buyer_signals` (urgency, budget_authority, growth_intent, exit_timeline); `employee_reviews` → `customer_testimonials`
- Summarize prompt: "web research assistant" → "sales intelligence analyst"; "candidate applying" → "Kate Schnetzer targeting this prospect"; all instruction rewrites aligned to sales context
- LLM-only prompt: All candidate/hiring references → prospect/scaling context

### 4. NegotiationEngine.js (14 patches)

**Key rewrites:**
- Prompt identity: "career negotiation coach" → "sales negotiation coach for Kate Schnetzer at The Scalable Company"
- "Resume Highlights" → "Kate's Offer Profile Highlights"
- `opening_line` description: "when the recruiter asks about expected salary" → "when the prospect asks about price or pushes back on the $30k fee"
- `justification` description: "3 specific resume achievements" → "3 specific client outcomes or program deliverables"
- `counter_offer_fallback` description: "if employer counters with a lower offer" → "if the prospect pushes for a discount or lower engagement scope"
- Rules: "anchor to upper range" → "The program fee is $30,000. Anchor firmly at $30k. Do not pre-discount"; culture signals → ROI framing; benefits fallback → "payment plans, phased engagement scope, never drop below $30k"
- "Company Culture & Compensation Signals" → "Prospect Company & Deal Signals"

### 5. GapAnalysisEngine.js (9 patches)

**Key rewrites:**
- "career coach helping a candidate handle skill gap questions in interviews" → "sales coach helping Kate handle prospect capability objections and fit concerns"
- "Candidate's Skills" → "Kate's Offer Profile"
- Pivot script prompt: "acknowledges the gap honestly" → "acknowledges the concern honestly"; "pivots to transferable skills" → "pivots to Scale and Exit program strengths"; "willingness to learn" → "demonstrates proven track record"
- Fallback pivot script: "While I haven't worked extensively with X, I have strong experience..." → "That's a fair concern about X. The Scale and Exit program addresses this directly..."

### 6. MockInterviewGenerator.js (13 patches)

**Key rewrites:**
- "experienced hiring manager" → "experienced sales strategist helping Kate prepare"
- "10 most likely interview questions" → "10 most likely objections, discovery questions, or deal-killers"
- Question types: technical → capability objections; behavioral STAR → value story prompts; system design → implementation concern questions; culture fit → pricing/commitment objections
- Category whitelist: `["technical", "behavioral", "system_design", "culture_fit"]` → `["capability_objection", "value_story_prompt", "implementation_concern", "pricing_objection"]`
- "suggested_answer_key": "from the resume" → "from Kate's offer profile, program deliverables, or client wins"

### 7. StarStoryGenerator.js (7 patches)

**Key rewrites:**
- "career coach expanding resume bullets into STAR stories" → "sales coach expanding Kate's client success examples into value stories (STAR format)"
- "the bullet states. Do not fabricate technologies, companies" → "the client success example states. Do not fabricate client details"
- `category: "star_story"` → `category: "value_story"`
- Title prefix: `STAR: {role} at {company}` → `Value Story: {role} at {company}`
- Tags: `"star behavioral"` → `"value story sales"`

### 8. CultureValuesMapper.js (14 patches)

**Key rewrites:**
- "expert career coach specializing in behavioral interviews and company culture fit" → "expert sales coach specializing in aligning Kate's program strengths to prospect priorities"
- "CANDIDATE'S STAR STORIES" → "KATE'S VALUE STORIES"
- "CORE VALUES / LEADERSHIP PRINCIPLES" → "PROSPECT PRIORITIES / SCALING CHALLENGES"
- "identify which core value(s) it best demonstrates" → "identify which prospect priority or scaling challenge it best addresses"
- XML tags: `<culture_alignment>` → `<prospect_priority_alignment>`
- "naturally weave in alignment with these {company} values" → "naturally connect your value stories to these {company} priorities"
- "Do NOT explicitly name the values" → "Do NOT explicitly name the priorities — address them through specific outcomes and client results"

### 9. TechnicalDepthScorer.js (7 patches)

**Key rewrites:**
- Score comment: "0 = pure HR, 1 = deep technical" → "0 = owner-level (strategic, wants outcomes), 1 = operator-level (detail-oriented, wants specifics)"
- `high_level_business` tone: executive language, team leadership → owner-level outcome framing, ROI, exit value, legacy
- `deep_technical` tone: code-level detail, jargon → operator-level specifics, implementation details, deliverables, methodology vetting
- `balanced` tone: "Adapt depth to match the question specificity" → "Adapt depth based on the questions they ask"

### 10. SalaryIntelligenceEngine.js (19 patches) — ROI Intelligence Calculator

**Key rewrites:**
- "compensation analyst estimating salary range" → "ROI analyst calculating prospect's annual cost of inaction and 3-year ROI vs $30k fee"
- JSON schema: `role/min/max` → `scenario/annual_cost_of_inaction/three_year_compounded/roi_vs_30k`
- ROI formula: `three_year_compounded = annual_cost * 3 * 1.2 (20% YoY); roi_vs_30k = (three_year_compounded - 30000) / 30000`
- Context block labels: "Market Salary Estimate" → "ROI Intelligence for Scale and Exit Program"; "Range" → "Annual Cost of Inaction / 3-Year Compounded"; "Pre-computed Negotiation Script" → "Pre-computed Pricing Script"; "Opening" → "Price Anchor"; "Counter-offer fallback" → "Discount Response"
- XML tag: `<salary_intelligence>` → `<roi_intelligence>`

### 11. NegotiationConversationTracker.js (8 patches)

**Phase names KEPT AS-IS:** INACTIVE → PROBE → ANCHOR → COUNTER → HOLD → PIVOT_BENEFITS → CLOSE

**Key rewrites:**
- `PUSHBACK_SIGNALS`: Added "too expensive", "out of our budget", "more than we planned", "can't justify"
- `ACCEPTANCE_SIGNALS`: Added "let's move forward", "let's do it", "send me the contract", "how do we get started"
- `BENEFITS_SIGNALS`: Changed from salary perks to deal structure alternatives: "payment plan", "installments", "phased", "scope", "deliverables", "guarantee", "pilot", "milestone"
- `SALARY_CONTEXT_WORDS`: Added "investment", "fee", "cost", "price", "budget", "afford", "spend", "pay"
- State XML: "Recruiter" → "Prospect"; "You" → "Kate"; "Their latest offer" → "Prospect's latest figure"

### 12. LiveNegotiationAdvisor.js (17 patches)

**Key rewrites:**
- PROBE: "delay their ask by asking 'What's the budgeted range?'" → "let the prospect talk more. Ask 'What's prompting you to look at this now?'"
- ANCHOR: "counter 10-15% above their target" → "anchor at $30,000 confidently. Never pre-discount"
- COUNTER: "Hold position and reinforce with specific wins" → "Hold the number. Reinforce with client win or ROI example"
- HOLD: "hold with silence + re-justify; ask 'What is the budget band?'; ask about signing bonus" → "hold with silence + re-justify ROI; ask 'What number would feel comfortable?'; explore payment plan"
- PIVOT_BENEFITS: "signing bonus first, equity, PTO, remote" → "emphasize guarantee, implementation support, milestone-based payment. Never drop below $30k"
- CLOSE: "request written offer within 24-48h" → "send proposal today, set 2-week close window"
- Phase labels: "Getting started" → "Discovery phase"; "Recruiter made an offer" → "Price raised — anchor at $30k"; "You countered" → "Kate named $30k"
- Fallback script: "targeting the upper end of the range" → "The Scale and Exit program is $30,000. ROI is typically 10x within 18 months"

### 13. AOTPipeline.js (2 patches)

**Key rewrites:**
- Log message: "Starting AOT pipeline" → "Starting sales prep pipeline"
- Log message: "Negotiation script pre-computed" → "Pricing script pre-computed"
- No prompt changes needed — delegates to the 5 engines above

---

## Version Notes

- **Patch script version:** 1.0 (hardcoded PATCH_MAP)
- **Target JS version:** Natively premium modules as extracted from app.asar, April 2026
- **Patch count by module:** ContextAssembler 32, IntentClassifier 11, CompanyResearchEngine 22, NegotiationEngine 14, GapAnalysisEngine 9, MockInterviewGenerator 13, StarStoryGenerator 7, CultureValuesMapper 14, TechnicalDepthScorer 7, SalaryIntelligenceEngine 19, NegotiationConversationTracker 8, LiveNegotiationAdvisor 17, AOTPipeline 2. **Total: 165 patches applied.**

---

## Future Improvements (Backlog)

1. **Notion-editable prompts** — load prompt overrides from a Notion database at startup so Kate can tune them without a rebuild
2. **Per-call-type variants** — different system prompts for discovery vs. demo vs. follow-up calls
3. **Prospect-size-aware framing** — adjust ROI examples based on the company's revenue band ($2M, $5M, $10M+)
4. **Prompt versioning** — each patch has a version hash so stale-patch detection is automatic
5. **SALES_PATCHES.md → PATCH_MAP sync** — script to read this file and auto-generate the PATCH_MAP, making this doc the single source of truth
6. **A/B testing hooks** — randomly select between two phrasings for key prompts and track close rate correlation
