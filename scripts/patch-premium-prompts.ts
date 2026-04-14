#!/usr/bin/env bun
/**
 * patch-premium-prompts.ts
 *
 * Rewrites interview-framed prompt text in the 13 LLM-heavy premium modules
 * to sales-coaching context for Kate Schnetzer / The Scalable Company.
 *
 * Usage:
 *   bun run scripts/patch-premium-prompts.ts /tmp/rebuild-staging
 *
 * The script is IDEMPOTENT \u2014 running it twice on the same staging dir produces
 * identical results (literal string matches, no regex that can match its own output).
 *
 * Exit codes:
 *   0 = all required patches applied successfully
 *   1 = one or more required patches failed to find their target string
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Patch {
  /** The exact string (or regex) to find. Literal strings are preferred for idempotency. */
  find: string | RegExp;
  /** Replacement string. */
  replace: string;
  /** If true, script exits with code 1 if this patch finds 0 matches. */
  required: boolean;
  /** Human-readable description for reporting. */
  description: string;
}

type PatchMap = Record<string, Patch[]>;

// ---------------------------------------------------------------------------
// PATCH MAP
// Each entry key is the module filename.
// Patches are applied in order \u2014 earlier patches may change the file, so later
// patches must target text that has NOT already been changed.
// ---------------------------------------------------------------------------

const PATCH_MAP: PatchMap = {

  // =========================================================================
  // 1. ContextAssembler.js \u2014 "inner voice" system prompt
  // =========================================================================
  "ContextAssembler.js": [
    {
      description: "Inner voice identity line",
      find: "- You are the candidate's INNER VOICE \\u2014 think of yourself as their consciousness during an interview.",
      replace: "- You are Kate's INNER VOICE \\u2014 think of yourself as her real-time sales coach during a live call with a prospect.",
      required: true,
    },
    {
      // The candidateName is XML-escaped and injected \u2014 just skip patching that specific line.
      // The key rules below (inner voice, speakable, etc.) cover the substantive content.
      description: "No assistant phrases \u2014 sales version (no-op, already neutral)",
      find: "- Never mention being an AI, a system, or having a resume. You ARE the person.",
      replace: "- Never mention being an AI, a system, or having a knowledge base. Speak as Kate naturally.",
      required: true,
    },
    {
      description: "Intro trigger \u2014 replace interview self-intro with sales opener",
      find: `- Never introduce yourself unprompted. Only give an introduction when explicitly asked ("tell me about yourself").`,
      replace: `- Never introduce yourself unprompted. Only give an opening pitch when explicitly asked.`,
      required: true,
    },
    {
      description: "Speakable timing",
      find: "- Keep answers concise and speakable (~20-30 seconds unless coding).",
      replace: "- Keep answers concise and speakable (~20-30 seconds). Sales calls move fast \u2014 don't over-explain.",
      required: true,
    },
    {
      description: "Context section distinctions \u2014 sales version",
      find: "- IMPORTANT: Carefully distinguish between different context sections. Work experience (<candidate_experience>) is different from side projects (<candidate_projects>), education (<candidate_education>), achievements (<candidate_achievements>), certifications (<candidate_certifications>), and leadership (<candidate_leadership>).",
      replace: "- IMPORTANT: Carefully distinguish between different context sections. Kate's offer profile (<offer_profile>) is different from client case studies (<case_studies>), program deliverables (<program_deliverables>), and Kate's track record (<track_record>).",
      required: true,
    },
    {
      description: "Projects vs experience distinction \u2014 sales version",
      find: `- When asked about "projects", ONLY reference items from <candidate_projects>, NOT from <candidate_experience> (those are jobs/roles, not projects).`,
      replace: `- When asked about "case studies" or "client wins", ONLY reference items from <case_studies>, NOT from <offer_profile> (those are program details, not client stories).`,
      required: true,
    },
    {
      description: "Experience / work history reference \u2014 sales version",
      find: `- When asked about "experience" or "work history", reference <candidate_experience> entries.`,
      replace: `- When asked about "experience" or "track record", reference <track_record> entries.`,
      required: true,
    },
    {
      description: "Education reference \u2014 sales version",
      find: `- When asked about "education", reference <candidate_education> entries.`,
      replace: `- When asked about "credentials" or "background", reference <track_record> entries.`,
      required: true,
    },
    {
      description: "buildIdentityHeader \u2014 interview framing in targetContext",
      find: "The candidate is interviewing for the",
      replace: "Kate is pitching the Scale and Exit program to",
      required: true,
    },
    {
      description: "buildIdentityHeader \u2014 level/position framing (template literal, optional)",
      find: "position of ${jd.title} at ${jd.company}.",
      replace: "at ${jd.company} (prospect company).",
      required: false,
    },
    {
      description: "buildIdentityHeader \u2014 interview-ready speech identity",
      find: "You generate interview-ready speech for",
      replace: "You generate sales-call-ready speech for",
      required: true,
    },
    {
      description: "JD rules \u2014 salary/company facts sourcing",
      find: "- When giving company or compensation facts, cite sources in a \"Sources\" section at the end.",
      replace: "- When giving prospect company or pricing facts, cite sources in a \"Sources\" section at the end.",
      required: true,
    },
    {
      description: "JD rules \u2014 salary ranges",
      find: "- If you present salary ranges or market data, include a confidence level (low/medium/high) and the source.",
      replace: "- If you present ROI estimates or deal value ranges, include a confidence level (low/medium/high) and the source.",
      required: true,
    },
    {
      description: "Salary rules \u2014 answering salary questions",
      find: "- When answering salary or compensation questions, use data from <salary_intelligence> if available.",
      replace: "- When answering pricing or ROI questions, use data from <roi_intelligence> if available.",
      required: true,
    },
    {
      description: "Salary rules \u2014 confidence level citation",
      find: `- Always state the confidence level when citing salary ranges (e.g., "Based on market data for this region, I'd expect..." for medium confidence).`,
      replace: `- Always state the confidence level when citing ROI projections (e.g., "Based on what I know about businesses at your stage..." for medium confidence).`,
      required: true,
    },
    {
      description: "Salary rules \u2014 anchor to upper end",
      find: "- Frame salary expectations confidently, anchoring to the upper end of the range.",
      replace: "- Frame the $30k program fee confidently. Don't discount or apologize for the price point.",
      required: true,
    },
    {
      description: "Salary rules \u2014 pre-computed script reference",
      find: "- If a pre-computed negotiation script is available in <salary_intelligence>, use it as a guide for your response \\u2014 adapt the opening line and justification naturally.",
      replace: "- If a pre-computed pricing script is available in <roi_intelligence>, use it as a guide for your response \\u2014 adapt the opening line and justification naturally.",
      required: true,
    },
    {
      description: "Salary rules \u2014 no salary data deflect",
      find: `- If no salary data is available, deflect gracefully by focusing on your value and experience (e.g., "I'm open to discussing compensation that reflects my experience in [domain]...").`,
      replace: `- If no ROI data is available, deflect gracefully by focusing on outcomes (e.g., "Let's talk about what solving this bottleneck is actually worth to your business...").`,
      required: true,
    },
    {
      description: "Salary rules \u2014 no pre-computed data reveal",
      find: "- Never reveal that you have pre-computed data or scripts. Speak as if you know your own worth naturally.",
      replace: "- Never reveal that you have pre-computed data or scripts. Speak as if you know the prospect's situation naturally.",
      required: true,
    },
    {
      description: "buildLiveNegotiationSystemPrompt \u2014 expert salary coach",
      find: "You are an expert salary negotiation coach providing real-time guidance.",
      replace: "You are an expert sales negotiation coach providing real-time guidance for Kate Schnetzer selling the Scale and Exit program.",
      required: true,
    },
    {
      description: "buildLiveNegotiationSystemPrompt \u2014 recruiter",
      find: "- The user is on a live call with a recruiter RIGHT NOW.",
      replace: "- Kate is on a live call with a prospect RIGHT NOW.",
      required: true,
    },
    {
      description: "buildLiveNegotiationSystemPrompt \u2014 offer history / target",
      find: "- You have full context about the current negotiation: offer history, phase, and the user's target.",
      replace: "- You have full context about the current negotiation: prospect offer history, phase, and Kate's price target ($30k).",
      required: true,
    },
    {
      description: "buildLiveNegotiationSystemPrompt \u2014 real numbers",
      find: "- Use REAL numbers. If offer is $95,000 and target is $130,000, say those exact numbers.",
      replace: "- Use REAL numbers. The program fee is $30,000. If prospect offers a lower figure, use the exact amounts.",
      required: true,
    },
    {
      description: "JIT intro \u2014 interview self-introduction",
      find: "Generate a natural, spoken interview self-introduction for a candidate named",
      replace: "Generate a natural, spoken sales opening for Kate Schnetzer, Account Executive at The Scalable Company. She is starting a call with a prospect named",
      required: true,
    },
    {
      description: "JIT intro \u2014 REAL PERSON speaking in interview",
      find: "This should sound like a REAL PERSON speaking in an interview \\u2014 relaxed, confident, conversational.",
      replace: "This should sound like a REAL SALES PROFESSIONAL \\u2014 warm, direct, founder-appropriate.",
      required: true,
    },
    {
      description: "JIT intro \u2014 current/latest role",
      find: "- Current/Latest role:",
      replace: "- Kate's role: Account Executive & Portfolio Advisor, The Scalable Company",
      required: false,
      description: "May not match due to interpolation context",
    },
    {
      description: "JIT intro \u2014 Interviewing for target role",
      find: "- Interviewing for: ${jd.title} at ${jd.company}",
      replace: "- Prospect company: ${jd.company} (${jd.title || 'decision maker'})",
      required: false,
      description: "Template literal \u2014 may not match compiled output",
    },
    {
      description: "JIT intro \u2014 subtly connect to target role",
      find: "\nSubtly connect their background to the target role without being obvious about it.",
      replace: "\nSubtly connect Kate's track record to the prospect's likely pain points without being salesy.",
      required: true,
    },
    {
      description: "JIT intro \u2014 focus on what they do now",
      find: "- Focus on: what they do now \\u2192 1-2 highlights from their career \\u2192 what excites them about this opportunity",
      replace: "- Focus on: what Kate does at Scalable \\u2192 1-2 client wins or program outcomes \\u2192 why she wanted to connect with this prospect specifically",
      required: true,
    },
    {
      description: "JIT intro \u2014 confident professional talking not reading a bio",
      find: "- Sound like a confident professional talking, NOT reading a bio",
      replace: "- Sound like a confident sales professional, NOT reading a script",
      required: true,
    },
    {
      description: "JIT intro \u2014 BAD example",
      find: `"Hello, it's nice to meet you. I'm [Name] and I'm excited to be here today to discuss the [Role] position. How can I assist you today?"`,
      replace: `"Hello, great to connect. I'm Kate from The Scalable Company. How can I assist you today?"`,
      required: true,
    },
    {
      description: "JIT intro \u2014 GOOD example pattern",
      find: `"Sure \\u2014 so I'm currently working as a [role] at [company], where I've been focused on [key thing]. Before that, I spent [time] at [company] doing [key achievement]. I've been mostly working in [domain] and [domain], and the [target role] here really caught my eye because [natural reason]."`,
      replace: `"Hey \\u2014 so I work with founders running $2-10M businesses who are stuck in the weeds. We help them build the operational systems to scale and eventually exit. I reached out because [prospect signal] caught my attention \\u2014 sounds like you might be at that inflection point."`,
      required: true,
    },
  ],

  // =========================================================================
  // 2. IntentClassifier.js \u2014 question categorization
  // =========================================================================
  "IntentClassifier.js": [
    {
      description: "COMPANY_RESEARCH_PATTERNS \u2014 hiring strategy",
      find: `  "hiring strategy",`,
      replace: `  "scaling strategy",`,
      required: true,
    },
    {
      description: "COMPANY_RESEARCH_PATTERNS \u2014 hiring style",
      find: `  "hiring style",`,
      replace: `  "growth trajectory",`,
      required: true,
    },
    {
      description: "COMPANY_RESEARCH_PATTERNS \u2014 interview process",
      find: `  "interview process",`,
      replace: `  "buying process",`,
      required: true,
    },
    {
      description: "NEGOTIATION_PATTERNS \u2014 salary",
      find: `  "salary",`,
      replace: `  "price",`,
      required: true,
    },
    {
      description: "NEGOTIATION_PATTERNS \u2014 compensation",
      find: `  "compensation",`,
      replace: `  "cost",`,
      required: true,
    },
    {
      description: "NEGOTIATION_PATTERNS \u2014 expected salary",
      find: `  "expected salary",`,
      replace: `  "program fee",`,
      required: true,
    },
    {
      description: "TECHNICAL_PATTERNS \u2014 system design",
      find: `  "system design",`,
      replace: `  "implementation approach",`,
      required: true,
    },
    {
      description: "PROFILE_DETAIL_PATTERNS \u2014 what have you built",
      find: `  "what have you built",`,
      replace: `  "what results have you delivered",`,
      required: true,
    },
    {
      description: "PROFILE_DETAIL_PATTERNS \u2014 what did you build",
      find: `  "what did you build",`,
      replace: `  "what have clients achieved",`,
      required: true,
    },
    {
      description: "PROFILE_DETAIL_PATTERNS \u2014 your background",
      find: `  "your background",`,
      replace: `  "track record",`,
      required: true,
    },
    {
      description: "PROFILE_DETAIL_PATTERNS \u2014 work history",
      find: `  "work history",`,
      replace: `  "client history",`,
      required: true,
    },
  ],

  // =========================================================================
  // 3. CompanyResearchEngine.js \u2014 prospect company dossier
  // =========================================================================
  "CompanyResearchEngine.js": [
    {
      description: "Search queries \u2014 hiring strategy",
      find: `\`${String.fromCharCode(36)}{companyName} hiring strategy careers\``,
      replace: `\`${String.fromCharCode(36)}{companyName} scaling strategy growth challenges\``,
      required: false,
      description: "Template literal may not match; use simpler string",
    },
    {
      description: "Search query \u2014 hiring strategy careers (compiled string)",
      find: "`${companyName} hiring strategy careers`",
      replace: "`${companyName} scaling strategy growth challenges`",
      required: false,
    },
    {
      description: "Search queries \u2014 interview process (string match in buildSearchQueries)",
      find: `\`${String.fromCharCode(36)}{companyName} interview process ${String.fromCharCode(36)}{title || ""}\`.trim()`,
      replace: `\`${String.fromCharCode(36)}{companyName} buying process decision makers ${String.fromCharCode(36)}{title || ""}\`.trim()`,
      required: false,
    },
    {
      description: "Search query \u2014 interview process compiled (fallback, optional fires first)",
      find: '`${companyName} interview process ${title || ""}`.trim()',
      replace: '`${companyName} buying process decision makers ${title || ""}`.trim()',
      required: false,
    },
    {
      description: "Search query \u2014 recent funding news layoffs",
      find: '`${companyName} recent funding news layoffs`',
      replace: '`${companyName} funding revenue growth news 2025 2026`',
      required: true,
    },
    {
      description: "Search query \u2014 glassdoor reviews",
      find: '`${companyName} glassdoor reviews employee rating work life balance culture`',
      replace: '`${companyName} customer reviews testimonials case studies results`',
      required: true,
    },
    {
      description: "Search query \u2014 employee complaints",
      find: '`${companyName} employee complaints criticism problems work culture`',
      replace: '`${companyName} operational challenges founder bottleneck scaling problems`',
      required: true,
    },
    {
      description: "Search query \u2014 employee benefits",
      find: '`${companyName} employee benefits perks remote work`',
      replace: '`${companyName} business model revenue streams market position`',
      required: true,
    },
    {
      description: "Dossier schema \u2014 hiring_strategy field comment",
      find: `  "hiring_strategy": "",`,
      replace: `  "scaling_strategy": "",`,
      required: true,
    },
    {
      description: "Dossier schema \u2014 interview_focus",
      find: `  "interview_focus": "",`,
      replace: `  "deal_priorities": "",`,
      required: true,
    },
    {
      description: "Dossier schema \u2014 interview_difficulty",
      find: `  "interview_difficulty": "medium",`,
      replace: `  "deal_complexity": "medium",`,
      required: true,
    },
    {
      description: "Dossier schema \u2014 salary_estimates",
      find: `  "salary_estimates": [
    {"title": "", "location": "", "min": 0, "max": 0, "currency": "USD", "source": "", "confidence": "low"}
  ],`,
      replace: `  "roi_estimates": [
    {"scenario": "", "annual_cost_of_inaction": 0, "three_year_compounded": 0, "roi_vs_30k": 0, "currency": "USD", "source": "", "confidence": "low"}
  ],`,
      required: true,
    },
    {
      description: "Dossier schema \u2014 culture_ratings",
      find: `  "culture_ratings": {
    "overall": 0.0,
    "work_life_balance": 0.0,
    "career_growth": 0.0,
    "compensation": 0.0,
    "management": 0.0,
    "diversity": 0.0,
    "review_count": "",
    "data_sources": []
  },`,
      replace: `  "buyer_signals": {
    "urgency": 0.0,
    "budget_authority": 0.0,
    "growth_intent": 0.0,
    "exit_timeline": 0.0,
    "review_count": "",
    "data_sources": []
  },`,
      required: true,
    },
    {
      description: "Dossier schema \u2014 employee_reviews",
      find: `  "employee_reviews": [
    {"quote": "", "sentiment": "positive", "source": "", "role": ""}
  ],`,
      replace: `  "customer_testimonials": [
    {"quote": "", "sentiment": "positive", "source": "", "role": ""}
  ],`,
      required: true,
    },
    {
      description: "Summarize LLM prompt \u2014 web research assistant",
      find: "You are a web research assistant. Using the following web snippets, create a structured company dossier JSON for",
      replace: "You are a sales intelligence analyst. Using the following web snippets, create a structured prospect dossier JSON for",
      required: true,
    },
    {
      description: "Summarize LLM prompt \u2014 candidate applying",
      find: "The candidate is applying for the following position \u2014 tailor salary estimates, interview focus, and hiring strategy to this specific role:",
      replace: "Kate Schnetzer (Account Executive, The Scalable Company) is targeting this prospect \u2014 tailor ROI estimates, deal priorities, and scaling strategy to this specific company:",
      required: false,
    },
    {
      description: "Summarize LLM prompt \u2014 salary_estimates instruction",
      find: "- salary_estimates: Use snippet data first. If no salary figures appear in snippets, use your training knowledge (Glassdoor/LinkedIn/Levels.fyi patterns) to estimate and set confidence to \"low\". Do NOT return an empty array when the role and location are known \u2014 always provide at least one estimate.",
      replace: "- roi_estimates: Use snippet data to estimate the prospect's annual cost of their scaling problem. Calculate three_year_compounded (annual cost x 3 + 20% YoY growth). Calculate roi_vs_30k = (three_year_compounded - 30000) / 30000. Set confidence to \"low\" if data is sparse. Always provide at least one estimate.",
      required: false,
    },
    {
      description: "Summarize LLM prompt \u2014 culture_ratings instruction",
      find: "- culture_ratings: Extract numeric star ratings (1\u20135 scale) from Glassdoor/Indeed/Blind snippets. If not explicitly in snippets, estimate from overall reputation you know (set data_sources to []). Use 0.0 only if the company is genuinely unknown.",
      replace: "- buyer_signals: Estimate urgency (0-1), budget_authority (0-1), growth_intent (0-1), and exit_timeline (0-1) from snippets and known company trajectory. Use 0.0 if unknown.",
      required: false,
    },
    {
      description: "Summarize LLM prompt \u2014 employee_reviews instruction",
      find: "- employee_reviews: Extract 2\u20134 real representative quotes from employee review snippets. Assign sentiment (positive/mixed/negative), platform source, and role if mentioned.",
      replace: "- customer_testimonials: Extract 2\u20134 quotes from customer reviews, case study snippets, or press coverage. Assign sentiment (positive/mixed/negative), source, and role if mentioned.",
      required: false,
    },
    {
      description: "Summarize LLM prompt \u2014 critics instruction",
      find: "- critics: Identify the 3\u20135 most commonly cited complaints from employee review snippets or known reputation. Assign category (e.g. \"Work-Life Balance\", \"Management\", \"Compensation\", \"Culture\", \"Job Security\"), and frequency (occasionally/frequently/widespread).",
      replace: "- critics: Identify the 3\u20135 most likely scaling challenges or objections for this prospect (e.g. \"Founder Bottleneck\", \"Operational Chaos\", \"Revenue Plateau\", \"Exit Readiness\"). Assign category and frequency (occasionally/frequently/widespread).",
      required: false,
    },
    {
      description: "Summarize LLM prompt \u2014 interview_difficulty instruction",
      find: "- interview_difficulty: Set to \"easy\", \"medium\", \"hard\", or \"very_hard\" based on snippets or known reputation.",
      replace: "- deal_complexity: Set to \"easy\", \"medium\", \"hard\", or \"very_hard\" based on company size, deal structure complexity, and likely procurement friction.",
      required: true,
    },
    {
      description: "Summarize LLM prompt \u2014 hiring_strategy interview_focus",
      find: "- hiring_strategy, interview_focus, recent_news: Only use information present in the snippets.",
      replace: "- scaling_strategy, deal_priorities, recent_news: Only use information present in the snippets.",
      required: true,
    },
    {
      description: "Summarize LLM prompt \u2014 interview_focus JD context",
      find: "- For interview_focus, consider the specific technologies, requirements, and responsibilities listed in the JD context.",
      replace: "- For deal_priorities, consider the specific operational pain points and growth challenges evident in the prospect context.",
      required: true,
    },
    {
      description: "LLM-only dossier prompt \u2014 general knowledge",
      find: "Based on your general knowledge, provide a brief company dossier for",
      replace: "Based on your general knowledge, provide a brief prospect dossier for",
      required: true,
    },
    {
      description: "LLM-only dossier prompt \u2014 candidate applying",
      find: "The candidate is applying for the following position \u2014 tailor salary estimates, interview focus, and hiring strategy to this specific role:",
      replace: "Kate Schnetzer (Account Executive, The Scalable Company) is targeting this prospect \u2014 tailor ROI estimates, deal priorities, and scaling strategy to this specific company:",
      required: false,
      description: "Second instance \u2014 may already have been patched above",
    },
    {
      description: "LLM-only dossier prompt \u2014 salary confidence low",
      find: "- Mark ALL salary confidence levels as \"low\" since this is from general knowledge, not live data.",
      replace: "- Mark ALL ROI estimate confidence levels as \"low\" since this is from general knowledge, not live data.",
      required: true,
    },
    {
      description: "LLM-only dossier prompt \u2014 salary estimates from training",
      find: "- Provide salary estimates from your training knowledge tailored to the role, level, and location. Do NOT leave salary_estimates empty when the role is known.",
      replace: "- Provide ROI estimates from your training knowledge about businesses at this revenue stage. Do NOT leave roi_estimates empty when the company is known.",
      required: true,
    },
    {
      description: "LLM-only dossier prompt \u2014 culture_ratings general reputation",
      find: "- culture_ratings: Use general reputation knowledge. Set data_sources to [] if guessing.",
      replace: "- buyer_signals: Estimate from general knowledge of this company's growth stage. Set data_sources to [] if guessing.",
      required: true,
    },
    {
      description: "LLM-only dossier prompt \u2014 employee_reviews illustrative",
      find: "- employee_reviews: Provide 2\u20133 illustrative reviews that reflect the company's known reputation. Mark source as \"General Knowledge\".",
      replace: "- customer_testimonials: Provide 2\u20133 illustrative quotes that reflect the company's known reputation or typical scaling challenges at this stage. Mark source as \"General Knowledge\".",
      required: false,
    },
    {
      description: "LLM-only dossier prompt \u2014 critics known complaints",
      find: "- critics: List the 3\u20134 most well-known complaints about this company from your training data.",
      replace: "- critics: List the 3\u20134 most likely scaling bottlenecks or objections for a company at this stage from your training data.",
      required: false,
    },
    {
      description: "LLM-only dossier prompt \u2014 interview_difficulty estimate",
      find: "- interview_difficulty: Estimate based on known reputation.",
      replace: "- deal_complexity: Estimate based on company size, known procurement style, and growth trajectory.",
      required: true,
    },
    {
      description: "buildSearchQueries log \u2014 role context",
      find: `console.log(\`[CompanyResearch] Researching: ${String.fromCharCode(36)}{companyName} (role: ${String.fromCharCode(36)}{jdCtx.title}, location: ${String.fromCharCode(36)}{jdCtx.location}, level: ${String.fromCharCode(36)}{jdCtx.level})\`);`,
      replace: `console.log(\`[ProspectResearch] Researching: ${String.fromCharCode(36)}{companyName} (contact: ${String.fromCharCode(36)}{jdCtx.title}, location: ${String.fromCharCode(36)}{jdCtx.location})\`);`,
      required: false,
    },
  ],

  // =========================================================================
  // 4. NegotiationEngine.js \u2014 negotiation script for pricing
  // =========================================================================
  "NegotiationEngine.js": [
    {
      description: "NegotiationEngine prompt \u2014 career negotiation coach",
      find: "You are a career negotiation coach. Generate a negotiation script for",
      replace: "You are a sales negotiation coach for Kate Schnetzer at The Scalable Company. Generate a pricing conversation script for",
      required: true,
    },
    {
      description: "NegotiationEngine prompt \u2014 resume highlights header",
      find: "Resume Highlights:",
      replace: "Kate's Offer Profile Highlights:",
      required: true,
    },
    {
      description: "NegotiationEngine prompt \u2014 opening_line description",
      find: `  "opening_line": "2 sentences: what to say when the recruiter asks about expected salary",`,
      replace: `  "opening_line": "2 sentences: what Kate says when the prospect asks about price or pushes back on the $30k fee",`,
      required: true,
    },
    {
      description: "NegotiationEngine prompt \u2014 justification description",
      find: `  "justification": "1 paragraph linking 3 specific resume achievements to justify the ask",`,
      replace: `  "justification": "1 paragraph linking 3 specific client outcomes or program deliverables to justify the $30k investment",`,
      required: true,
    },
    {
      description: "NegotiationEngine prompt \u2014 counter_offer_fallback description",
      find: `  "counter_offer_fallback": "2 sentences: what to say if employer counters with a lower offer"`,
      replace: `  "counter_offer_fallback": "2 sentences: what Kate says if the prospect pushes for a discount or lower engagement scope"`,
      required: true,
    },
    {
      description: "NegotiationEngine rules \u2014 first person confident",
      find: "- Use first person, confident but professional tone.",
      replace: "- Use first person from Kate's perspective. Confident, direct, founder-appropriate tone.",
      required: true,
    },
    {
      description: "NegotiationEngine rules \u2014 REAL achievements from resume",
      find: "- Reference REAL achievements from the resume.",
      replace: "- Reference REAL client outcomes and program deliverables. No fabrication.",
      required: true,
    },
    {
      description: "NegotiationEngine rules \u2014 anchor to upper salary range",
      find: "- If salary data is available, anchor the opening to the upper range.",
      replace: "- The program fee is $30,000. Anchor firmly at $30k. Do not pre-discount.",
      required: true,
    },
    {
      description: "NegotiationEngine rules \u2014 work-life balance low score",
      find: "- If work-life balance or compensation satisfaction scores are low (<3.5), acknowledge the demanding environment and justify a higher salary ask accordingly.",
      replace: "- If buyer urgency or deal complexity signals suggest the prospect is resistant, acknowledge the investment size and immediately pivot to ROI framing.",
      required: true,
    },
    {
      description: "NegotiationEngine rules \u2014 widespread complaints about compensation",
      find: "- If there are widespread or frequent complaints about compensation/workload, reference the market data as a floor, not a ceiling.",
      replace: "- If there are widespread scaling challenges, reference the cost-of-inaction ROI as the floor, not the ceiling. The $30k fee is cheap vs. 3 years of stalled growth.",
      required: true,
    },
    {
      description: "NegotiationEngine rules \u2014 benefits limited counter_offer_fallback",
      find: "- If benefits appear limited, the counter_offer_fallback may suggest non-salary alternatives (equity, PTO, remote work).",
      replace: "- If price resistance is strong, the counter_offer_fallback may reference program guarantees, payment plans, or phased engagement scope \u2014 but never drop below $30k.",
      required: true,
    },
    {
      description: "NegotiationEngine salary context line",
      find: "salaryContext = `Market data indicates compensation of ~${currency} ${avgMin.toLocaleString()}-${avgMax.toLocaleString()} (confidence: ${avgConfidence})`",
      replace: "salaryContext = `ROI estimate: ~${currency} ${avgMin.toLocaleString()} annual cost of inaction (confidence: ${avgConfidence}). 3-year compounded: ~${currency} ${avgMax.toLocaleString()}. ROI vs $30k: ${((avgMax - 30000) / 30000 * 100).toFixed(0)}%`",
      required: false,
      description: "Template literal \u2014 may not match exactly in compiled output",
    },
    {
      description: "NegotiationEngine \u2014 company insights header",
      find: "Company Culture & Compensation Signals:",
      replace: "Prospect Company & Deal Signals:",
      required: true,
    },
    {
      description: "NegotiationEngine jdContext \u2014 Target Role",
      find: "jdContext = `Target Role: ${jd.title} at ${jd.company} (${jd.level || \"mid\"}-level, ${jd.location || \"unspecified location\"})`",
      replace: "jdContext = `Prospect: ${jd.title} at ${jd.company} (${jd.level || \"decision maker\"}, ${jd.location || \"location unspecified\"})`",
      required: false,
      description: "Template literal in compiled output",
    },
  ],

  // =========================================================================
  // 5. GapAnalysisEngine.js \u2014 prospect need vs Scale and Exit fit
  // =========================================================================
  "GapAnalysisEngine.js": [
    {
      description: "GapAnalysis prompt \u2014 career coach for skill gaps",
      find: "You are a career coach helping a candidate handle skill gap questions in interviews.",
      replace: "You are a sales coach helping Kate handle prospect capability objections and fit concerns on sales calls.",
      required: true,
    },
    {
      description: "GapAnalysis prompt \u2014 candidate skills header",
      find: "Candidate's Skills: ${candidateSkills}",
      replace: "Kate's Offer Profile: ${candidateSkills}",
      required: false,
      description: "Template literal",
    },
    {
      description: "GapAnalysis prompt \u2014 candidate skills static text",
      find: "Candidate's Skills: ",
      replace: "Kate's Offer Profile: ",
      required: false,
    },
    {
      description: "GapAnalysis prompt \u2014 top experience header",
      find: "Top Experience:\n${topExperience}",
      replace: "Program Deliverables & Track Record:\n${topExperience}",
      required: false,
    },
    {
      description: "GapAnalysis prompt \u2014 pivot script definition",
      find: `For each missing/weak skill below, generate a realistic "pivot script" \u2014 a confident 2-3 sentence response that:`,
      replace: `For each prospect objection or fit concern below, generate a realistic "response script" \u2014 a confident 2-3 sentence response that:`,
      required: false,
    },
    {
      description: "GapAnalysis prompt \u2014 acknowledges gap honestly",
      find: "- Acknowledges the gap honestly (if missing) or positions limited experience positively (if weak)",
      replace: "- Acknowledges the concern honestly (if valid) or reframes it as a non-issue (if weak)",
      required: true,
    },
    {
      description: "GapAnalysis prompt \u2014 pivots to transferable skills",
      find: "- Pivots to specific transferable skills from the candidate's actual background",
      replace: "- Pivots to Scale and Exit program strengths or Kate's track record that address the concern",
      required: true,
    },
    {
      description: "GapAnalysis prompt \u2014 willingness to learn",
      find: "- Shows willingness and ability to learn quickly",
      replace: "- Demonstrates the program's proven track record for similar challenges",
      required: true,
    },
    {
      description: "GapAnalysis prompt \u2014 gaps header",
      find: "Gaps:\n${gapList}",
      replace: "Objections / Fit Concerns:\n${gapList}",
      required: false,
    },
    {
      description: "GapAnalysis pivot_script key label",
      find: `    "pivot_script": "...",`,
      replace: `    "pivot_script": "...",`,
      required: false,
      description: "no-op \u2014 keeping pivot_script key name for data shape compatibility",
    },
    {
      description: "GapAnalysis fallback pivot script",
      find: `pivot_script: \`While I haven't worked extensively with ${String.fromCharCode(36)}{g.skill}, I have strong experience with related technologies and can ramp up quickly.\``,
      replace: `pivot_script: \`That's a fair question about ${String.fromCharCode(36)}{g.skill}. The Scale and Exit program is built for exactly this scenario \u2014 we\u2019ve helped founders work through this specific challenge before.\``,
      required: false,
    },
    {
      description: "GapAnalysis fallback pivot script (compiled template)",
      find: "While I haven't worked extensively with",
      replace: "That's a fair concern about",
      required: false,
    },
    {
      description: "GapAnalysis fallback pivot script \u2014 ramp up quickly",
      find: ", I have strong experience with related technologies and can ramp up quickly.",
      replace: ". The Scale and Exit program addresses this directly \u2014 we've solved it for founders at this stage before.",
      required: false,
    },
    {
      description: "GapAnalysis log \u2014 gap analysis starting",
      find: `console.log("[GapAnalysisEngine] Starting gap analysis...");`,
      replace: `console.log("[GapAnalysisEngine] Starting prospect fit analysis...");`,
      required: false,
    },
  ],

  // =========================================================================
  // 6. MockInterviewGenerator.js \u2192 Prospect Objection Generator
  // =========================================================================
  "MockInterviewGenerator.js": [
    {
      description: "MockInterview prompt \u2014 experienced hiring manager",
      find: "You are an experienced hiring manager for",
      replace: "You are an experienced sales strategist helping Kate Schnetzer prepare for a sales call with",
      required: true,
    },
    {
      description: "MockInterview prompt \u2014 10 most likely interview questions",
      find: ". Generate the 10 most likely interview questions this candidate will face.",
      replace: ". Generate the 10 most likely objections, discovery questions, or deal-killers Kate will face from this prospect.",
      required: true,
    },
    {
      description: "MockInterview prompt \u2014 candidate header",
      find: "Candidate:\n${candidateProfile}",
      replace: "Kate's Offer Profile:\n${candidateProfile}",
      required: false,
    },
    {
      description: "MockInterview candidateProfile \u2014 Name field",
      find: "Name: ${resume.identity.name}",
      replace: "Rep: ${resume.identity.name} (Account Executive, The Scalable Company)",
      required: false,
    },
    {
      description: "MockInterview prompt \u2014 generate a MIX of question types",
      find: "Generate a MIX of question types:",
      replace: "Generate a MIX of objection/question types:",
      required: true,
    },
    {
      description: "MockInterview prompt \u2014 3-4 technical questions",
      find: "- 3-4 technical questions (aligned with required technologies/skills)",
      replace: "- 3-4 capability objections (\"Can you actually do this for my industry?\", \"How is this different from hiring a consultant?\")",
      required: true,
    },
    {
      description: "MockInterview prompt \u2014 2-3 behavioral questions STAR",
      find: "- 2-3 behavioral questions (STAR format triggers like \"Tell me about a time...\")",
      replace: "- 2-3 value story prompts (\"Can you show me a client who was in my exact situation?\", \"What results have founders seen?\")",
      required: true,
    },
    {
      description: "MockInterview prompt \u2014 1-2 system design questions",
      find: "- 1-2 system design questions (if senior/staff level)",
      replace: "- 1-2 implementation concern questions (\"How long does this take?\", \"What does the actual work look like day-to-day?\")",
      required: true,
    },
    {
      description: "MockInterview prompt \u2014 1-2 culture fit questions",
      find: "- 1-2 culture fit questions (aligned with company values if known)",
      replace: "- 1-2 pricing / commitment objections (\"This is a big investment\", \"We don't have budget right now\")",
      required: true,
    },
    {
      description: "MockInterview prompt \u2014 focus on GAPS",
      find: "Focus on GAPS between the resume and JD \u2014 interviewers probe weaknesses.",
      replace: "Focus on the GAPS between the prospect's current state and the program's value prop \u2014 prospects probe where the program might not fit their situation.",
      required: false,
    },
    {
      description: "MockInterview JSON schema \u2014 category values",
      find: `    "category": "technical|behavioral|system_design|culture_fit",`,
      replace: `    "category": "capability_objection|value_story_prompt|implementation_concern|pricing_objection",`,
      required: true,
    },
    {
      description: "MockInterview validation \u2014 category whitelist",
      find: `["technical", "behavioral", "system_design", "culture_fit"].includes(q.category) ? q.category : "technical"`,
      replace: `["capability_objection", "value_story_prompt", "implementation_concern", "pricing_objection"].includes(q.category) ? q.category : "capability_objection"`,
      required: true,
    },
    {
      description: "MockInterview prompt \u2014 suggested_answer_key",
      find: `    "suggested_answer_key": "Key points to hit from the resume (1-2 sentences)"`,
      replace: `    "suggested_answer_key": "Key points to hit from Kate's offer profile, program deliverables, or client wins (1-2 sentences)"`,
      required: true,
    },
    {
      description: "MockInterview log \u2014 generating mock interview questions",
      find: `console.log("[MockInterviewGenerator] Generating mock interview questions...");`,
      replace: `console.log("[MockInterviewGenerator] Generating prospect objections and discovery questions...");`,
      required: false,
    },
  ],

  // =========================================================================
  // 7. StarStoryGenerator.js \u2192 Value Story Generator
  // =========================================================================
  "StarStoryGenerator.js": [
    {
      description: "StarStory prompt \u2014 career coach expanding resume bullets",
      find: "You are a career coach expanding resume bullets into STAR stories.",
      replace: "You are a sales coach expanding Kate's client success examples into value stories (STAR format).",
      required: true,
    },
    {
      description: "StarStory prompt \u2014 base the story ONLY on bullet",
      find: "- Base the story ONLY on what the bullet states. Do not fabricate technologies, companies, or outcomes not implied.",
      replace: "- Base the story ONLY on what the client success example states. Do not fabricate client details, metrics, or outcomes not implied.",
      required: true,
    },
    {
      description: "StarStory prompt \u2014 full_narrative spoken answer",
      find: "- The \"full_narrative\" should be a natural, first-person spoken answer (~80-120 words).",
      replace: "- The \"full_narrative\" should be a natural, first-person spoken answer Kate can use on a sales call (~80-120 words).",
      required: true,
    },
    {
      description: "StarStory \u2014 category label in nodes",
      find: `category: "star_story"`,
      replace: `category: "value_story"`,
      required: true,
    },
    {
      description: "StarStory \u2014 STAR prefix in title",
      find: `title: \`STAR: ${String.fromCharCode(36)}{story.parent_role} at ${String.fromCharCode(36)}{story.parent_company}\``,
      replace: `title: \`Value Story: ${String.fromCharCode(36)}{story.parent_role} at ${String.fromCharCode(36)}{story.parent_company}\``,
      required: false,
      description: "Template literal",
    },
    {
      description: "StarStory \u2014 STAR prefix in title (simpler match)",
      find: '`STAR: ${story.parent_role} at ${story.parent_company}`',
      replace: '`Value Story: ${story.parent_role} at ${story.parent_company}`',
      required: false,
    },
    {
      description: "StarStory \u2014 tags include 'star behavioral'",
      find: `"${String.fromCharCode(36)}{story.parent_role} ${String.fromCharCode(36)}{story.parent_company} ${String.fromCharCode(36)}{story.original_bullet} star behavioral"`,
      replace: `"${String.fromCharCode(36)}{story.parent_role} ${String.fromCharCode(36)}{story.parent_company} ${String.fromCharCode(36)}{story.original_bullet} value story sales"`,
      required: false,
    },
    {
      description: "StarStory \u2014 extractTags with star behavioral",
      find: "`${story.parent_role} ${story.parent_company} ${story.original_bullet} star behavioral`",
      replace: "`${story.parent_role} ${story.parent_company} ${story.original_bullet} value story sales`",
      required: true,
    },
    {
      description: "StarStory log \u2014 expanding bullets into STAR stories",
      find: `\`[StarStoryGenerator] Expanding ${String.fromCharCode(36)}{bulletContexts.length} bullets into STAR stories (batches of ${String.fromCharCode(36)}{BATCH_SIZE})...\``,
      replace: `\`[StarStoryGenerator] Expanding ${String.fromCharCode(36)}{bulletContexts.length} client examples into value stories (batches of ${String.fromCharCode(36)}{BATCH_SIZE})...\``,
      required: false,
    },
    {
      description: "StarStory log \u2014 expanded batch STAR stories",
      find: "`[StarStoryGenerator] Generated ${allStories.length} STAR stories total`",
      replace: "`[StarStoryGenerator] Generated ${allStories.length} value stories total`",
      required: false,
    },
  ],

  // =========================================================================
  // 8. CultureValuesMapper.js \u2192 Prospect Priority Mapper
  // =========================================================================
  "CultureValuesMapper.js": [
    {
      description: "CultureValuesMapper prompt \u2014 expert career coach behavioral interviews",
      find: "You are an expert career coach specializing in behavioral interviews and company culture fit.",
      replace: "You are an expert sales coach specializing in aligning Kate's program strengths to prospect priorities and scaling challenges.",
      required: true,
    },
    {
      description: "CultureValuesMapper prompt \u2014 STAR stories header",
      find: "CANDIDATE'S STAR STORIES:",
      replace: "KATE'S VALUE STORIES:",
      required: true,
    },
    {
      description: "CultureValuesMapper prompt \u2014 core values / leadership principles",
      find: "CORE VALUES / LEADERSHIP PRINCIPLES:",
      replace: "PROSPECT PRIORITIES / SCALING CHALLENGES:",
      required: true,
    },
    {
      description: "CultureValuesMapper prompt \u2014 identify which core value it best demonstrates",
      find: "For each STAR story, identify which core value(s) it best demonstrates. Return a JSON array of mappings:",
      replace: "For each value story, identify which prospect priority or scaling challenge it best addresses. Return a JSON array of mappings:",
      required: true,
    },
    {
      description: "CultureValuesMapper prompt \u2014 value_name exact core value",
      find: `    "value_name": "the exact core value name from the list above",`,
      replace: `    "value_name": "the exact prospect priority from the list above",`,
      required: true,
    },
    {
      description: "CultureValuesMapper prompt \u2014 alignment_rationale",
      find: `    "alignment_rationale": "Why this story demonstrates this value",`,
      replace: `    "alignment_rationale": "Why this value story addresses this prospect priority",`,
      required: true,
    },
    {
      description: "CultureValuesMapper prompt \u2014 speaking_tip frame answer",
      find: `    "speaking_tip": "When asked about this value, frame your answer by emphasizing..."`,
      replace: `    "speaking_tip": "When this prospect priority comes up, frame your answer by emphasizing..."`,
      required: true,
    },
    {
      description: "CultureValuesMapper prompt \u2014 strong alignments score",
      find: "- Each story can map to 1-3 values (pick only strong alignments, score > 0.6)",
      replace: "- Each value story can map to 1-3 prospect priorities (pick only strong alignments, score > 0.6)",
      required: true,
    },
    {
      description: "CultureValuesMapper prompt \u2014 speaking_tip concrete coaching tip",
      find: "- speaking_tip should be a concrete, 1-sentence coaching tip on HOW to frame the answer",
      replace: "- speaking_tip should be a concrete, 1-sentence coaching tip on HOW to connect this story to the prospect's specific challenge",
      required: true,
    },
    {
      description: "CultureValuesMapper \u2014 formatValueAlignmentBlock XML culture_alignment",
      find: `<culture_alignment company="${String.fromCharCode(36)}{companyName}">`,
      replace: `<prospect_priority_alignment company="${String.fromCharCode(36)}{companyName}">`,
      required: false,
    },
    {
      description: "CultureValuesMapper \u2014 formatValueAlignmentBlock XML culture_alignment (compiled)",
      find: '<culture_alignment company="',
      replace: '<prospect_priority_alignment company="',
      required: false,
    },
    {
      description: "CultureValuesMapper \u2014 formatValueAlignmentBlock close tag",
      find: "</culture_alignment>",
      replace: "</prospect_priority_alignment>",
      required: true,
    },
    {
      description: "CultureValuesMapper \u2014 naturally weave in alignment",
      find: `When answering, naturally weave in alignment with these ${String.fromCharCode(36)}{companyName} values:`,
      replace: `When answering, naturally connect your value stories to these ${String.fromCharCode(36)}{companyName} priorities:`,
      required: false,
    },
    {
      description: "CultureValuesMapper \u2014 naturally weave in alignment (compiled)",
      find: "When answering, naturally weave in alignment with these",
      replace: "When answering, naturally connect your value stories to these",
      required: false,
    },
    {
      description: "CultureValuesMapper \u2014 do not explicitly name the values",
      find: `Do NOT explicitly name the values \u2014 demonstrate them through your answer's framing and emphasis.`,
      replace: `Do NOT explicitly name the priorities \u2014 address them through specific outcomes and client results.`,
      required: false,
    },
    {
      description: "CultureValuesMapper \u2014 align your answer with this core value",
      find: `Align your answer with this ${String.fromCharCode(36)}{companyName} core value.`,
      replace: `Connect your value story to this ${String.fromCharCode(36)}{companyName} scaling challenge.`,
      required: false,
    },
    {
      description: "CultureValuesMapper \u2014 align your answer with this core value (compiled)",
      find: "Align your answer with this",
      replace: "Connect your value story to this",
      required: false,
    },
    {
      description: "CultureValuesMapper \u2014 core value.",
      find: "core value.",
      replace: "scaling challenge.",
      required: false,
    },
    {
      description: "CultureValuesMapper log \u2014 mapping STAR stories",
      find: "`[CultureValuesMapper] Mapping ${stories.length} STAR stories to ${coreValues.length} core values for ${companyName}...`",
      replace: "`[CultureValuesMapper] Mapping ${stories.length} value stories to ${coreValues.length} prospect priorities for ${companyName}...`",
      required: false,
    },
    {
      description: "CultureValuesMapper log \u2014 mappings unmapped values",
      find: '`[CultureValuesMapper] ✅ Created ${allMappings.length} mappings. ${unmappedValues.length} values unmapped.`',
      replace: '`[CultureValuesMapper] ✅ Created ${allMappings.length} mappings. ${unmappedValues.length} priorities unmapped.`',
      required: false,
    },
  ],

  // =========================================================================
  // 9. TechnicalDepthScorer.js \u2192 Prospect Role Detector
  // =========================================================================
  "TechnicalDepthScorer.js": [
    {
      description: "TechnicalDepthScorer \u2014 0 = pure HR comment",
      find: "// 0 = pure HR, 1 = deep technical",
      replace: "// 0 = owner-level (strategic, wants outcomes), 1 = operator-level (detail-oriented, wants specifics)",
      required: true,
    },
    {
      description: "TechnicalDepthScorer getToneXML \u2014 high_level_business",
      find: `case "high_level_business":
        return "<tone>High-level, business impact focused. Use executive-friendly language, emphasize team leadership, stakeholder management, and measurable outcomes. Avoid deep technical jargon.</tone>";`,
      replace: `case "high_level_business":
        return "<tone>Owner-level prospect. High-level, outcome-focused. Lead with ROI, exit value, and freedom from day-to-day chaos. Avoid operational detail. Speak to vision and legacy.</tone>";`,
      required: true,
    },
    {
      description: "TechnicalDepthScorer getToneXML \u2014 deep_technical",
      find: `case "deep_technical":
        return "<tone>Deep technical, code-level detail. Use precise technical terminology, discuss implementation details, time/space complexity, and architectural trade-offs. The interviewer is technically sophisticated.</tone>";`,
      replace: `case "deep_technical":
        return "<tone>Operator-level prospect. Detail-oriented, wants specifics. Explain implementation, process design, the exact deliverables, timelines, and what the day-to-day of the program looks like. They will vet the methodology.</tone>";`,
      required: true,
    },
    {
      description: "TechnicalDepthScorer getToneXML \u2014 balanced",
      find: `case "balanced":
      default:
        return "<tone>Balanced technical and business context. Mix implementation details with impact metrics. Adapt depth to match the question specificity.</tone>";`,
      replace: `case "balanced":
      default:
        return "<tone>Mixed audience or unclear role. Blend outcome framing with enough process detail to build credibility. Adapt depth based on the questions they ask.</tone>";`,
      required: true,
    },
    {
      description: "TechnicalDepthScorer reset log",
      find: `console.log("[TechnicalDepthScorer] Reset to neutral (0.5)");`,
      replace: `console.log("[TechnicalDepthScorer] Prospect role detector reset to neutral (0.5)");`,
      required: false,
    },
    {
      description: "TechnicalDepthScorer addUtterance log",
      find: "`[TechnicalDepthScorer] Utterance score: ${utteranceScore.toFixed(2)}, Running: ${this.currentScore.toFixed(2)} (tech: ${techHits}, biz: ${businessHits})`",
      replace: "`[ProspectRoleDetector] Signal score: ${utteranceScore.toFixed(2)}, Running: ${this.currentScore.toFixed(2)} (operator signals: ${techHits}, owner signals: ${businessHits})`",
      required: false,
    },
    {
      description: "TechnicalDepthScorer reset method comment",
      find: "* Reset for a new interview session.",
      replace: "* Reset for a new sales call session.",
      required: false,
    },
  ],

  // =========================================================================
  // 10. SalaryIntelligenceEngine.js \u2192 ROI Intelligence Calculator
  // =========================================================================
  "SalaryIntelligenceEngine.js": [
    {
      description: "SalaryIntelligence estimateFromResume JSDoc",
      find: "* Generate a salary estimate from resume data alone.\n   * Uses candidate's location, skills, experience, and latest role to estimate market rate.",
      replace: "* Generate an ROI estimate from Kate's offer profile.\n   * Calculates the prospect's annual cost of inaction and 3-year ROI vs the $30k Scale and Exit fee.",
      required: false,
    },
    {
      description: "SalaryIntelligence \u2014 compensation analyst prompt",
      find: "You are a compensation analyst. Based on the candidate profile below, estimate a fair market salary range for their current level and location.",
      replace: "You are an ROI analyst for sales at The Scalable Company. Based on Kate's offer profile below, estimate the prospect's annual cost of inaction from their scaling challenges, and the 3-year ROI of solving those challenges with the Scale and Exit program ($30,000 fee).",
      required: true,
    },
    {
      description: "SalaryIntelligence \u2014 candidate profile header",
      find: "Candidate Profile:",
      replace: "Kate's Offer Profile (for ROI framing context):",
      required: true,
    },
    {
      description: "SalaryIntelligence \u2014 Name field in prompt",
      find: "- Name: ${resume.identity.name}",
      replace: "- Rep: ${resume.identity.name} (Account Executive, The Scalable Company)",
      required: false,
    },
    {
      description: "SalaryIntelligence \u2014 IMPORTANT currency detection",
      find: "IMPORTANT:\n- Detect the country from the location and use the LOCAL CURRENCY (e.g., INR for India, GBP for UK, EUR for Europe, USD for USA).\n- Base the estimate on the local job market for that region, NOT global/US rates.\n- Consider the candidate's experience level, skills, and domain.\n- Be realistic and conservative.",
      replace: "IMPORTANT:\n- Use USD for all estimates unless the prospect's location clearly indicates otherwise.\n- Base ROI estimates on typical scaling challenges for $2-10M revenue businesses.\n- The $30k Scale and Exit fee is fixed. Calculate ROI as: (3-year cost of inaction - $30k) / $30k.\n- Be realistic. Conservative estimates are more persuasive than inflated ones.",
      required: true,
    },
    {
      description: "SalaryIntelligence \u2014 JSON schema fields",
      find: `  "role": "the role title you are estimating for",
  "location": "normalized city, country",
  "currency": "3-letter currency code",
  "min": 0,
  "max": 0,
  "confidence": "low or medium",
  "justification_factors": ["factor1", "factor2", "factor3"]`,
      replace: `  "scenario": "the scaling challenge scenario being estimated",
  "location": "normalized city, country (prospect's location)",
  "currency": "3-letter currency code",
  "annual_cost_of_inaction": 0,
  "three_year_compounded": 0,
  "roi_vs_30k": 0.0,
  "confidence": "low or medium",
  "justification_factors": ["factor1", "factor2", "factor3"]`,
      required: true,
    },
    {
      description: "SalaryIntelligence \u2014 rules min/max annual salary",
      find: "- min and max should be ANNUAL salary as integers (no decimals).",
      replace: "- annual_cost_of_inaction: integer, annual cost of NOT solving the scaling problem (in currency units). three_year_compounded: annual_cost_of_inaction * 3 * 1.2 (20% YoY growth). roi_vs_30k: (three_year_compounded - 30000) / 30000, rounded to 2 decimal places.",
      required: true,
    },
    {
      description: "SalaryIntelligence \u2014 justification_factors",
      find: "- justification_factors: list 3-5 factors that influenced the estimate (e.g., \"5+ years Python experience\", \"Bangalore tech market\", \"Senior-level role\").",
      replace: "- justification_factors: list 3-5 factors that drove the cost-of-inaction estimate (e.g., \"Founder spending 30hrs/week on ops\", \"Revenue plateau at $3M for 2 years\", \"No documented processes\").",
      required: true,
    },
    {
      description: "SalaryIntelligence \u2014 confidence low if location vague",
      find: "- confidence should be \"low\" if location is vague, \"medium\" if you have good location + skills data.",
      replace: "- confidence should be \"low\" if scaling challenge is unclear, \"medium\" if you have good evidence of the bottleneck.",
      required: true,
    },
    {
      description: "SalaryIntelligence buildSalaryContextBlock \u2014 Market Salary Estimate",
      find: `lines.push(\`Market Salary Estimate for ${String.fromCharCode(36)}{resumeEstimate.role} in ${String.fromCharCode(36)}{resumeEstimate.location}:\`);`,
      replace: `lines.push(\`ROI Intelligence for Scale and Exit Program in ${String.fromCharCode(36)}{resumeEstimate.location}:\`);`,
      required: false,
    },
    {
      description: "SalaryIntelligence buildSalaryContextBlock \u2014 Market Salary Estimate (simpler match)",
      find: "lines.push(`Market Salary Estimate for",
      replace: "lines.push(`ROI Intelligence for Scale and Exit Program in",
      required: false,
    },
    {
      description: "SalaryIntelligence buildSalaryContextBlock \u2014 Range per year",
      find: "`  Range: ${resumeEstimate.currency} ${resumeEstimate.min.toLocaleString()} - ${resumeEstimate.max.toLocaleString()} per year`",
      replace: "`  Annual Cost of Inaction: ${resumeEstimate.currency} ${(resumeEstimate.annual_cost_of_inaction || resumeEstimate.min || 0).toLocaleString()} | 3-Year Compounded: ${resumeEstimate.currency} ${(resumeEstimate.three_year_compounded || resumeEstimate.max || 0).toLocaleString()}`",
      required: false,
    },
    {
      description: "SalaryIntelligence buildSalaryContextBlock \u2014 Range fallback",
      find: "lines.push(`  Range: ${resumeEstimate.currency}",
      replace: "lines.push(`  Annual Cost of Inaction: ${resumeEstimate.currency}",
      required: false,
    },
    {
      description: "SalaryIntelligence buildSalaryContextBlock \u2014 No JD note",
      find: `lines.push(\`  Note: This is a general market estimate based on the candidate's profile. No specific company/role JD was provided.\`);`,
      replace: `lines.push(\`  Note: This is a general ROI estimate. No specific prospect profile was provided.\`);`,
      required: false,
    },
    {
      description: "SalaryIntelligence buildSalaryContextBlock \u2014 No JD note (simpler match)",
      find: "This is a general market estimate based on the candidate's profile. No specific company/role JD was provided.",
      replace: "This is a general ROI estimate. No specific prospect profile was provided.",
      required: false,
    },
    {
      description: "SalaryIntelligence buildSalaryContextBlock \u2014 Pre-computed Negotiation Script",
      find: `lines.push("Pre-computed Negotiation Script:");`,
      replace: `lines.push("Pre-computed Pricing Script:");`,
      required: true,
    },
    {
      description: "SalaryIntelligence buildSalaryContextBlock \u2014 opening",
      find: `lines.push(\`  Opening: ${String.fromCharCode(36)}{negotiationScript.opening_line}\`);`,
      replace: `lines.push(\`  Price Anchor: ${String.fromCharCode(36)}{negotiationScript.opening_line}\`);`,
      required: false,
    },
    {
      description: "SalaryIntelligence buildSalaryContextBlock \u2014 opening (simpler)",
      find: "lines.push(`  Opening: ${negotiationScript.opening_line}`);",
      replace: "lines.push(`  Price Anchor: ${negotiationScript.opening_line}`);",
      required: false,
    },
    {
      description: "SalaryIntelligence buildSalaryContextBlock \u2014 Counter-offer fallback",
      find: `lines.push(\`  Counter-offer fallback: ${String.fromCharCode(36)}{negotiationScript.counter_offer_fallback}\`);`,
      replace: `lines.push(\`  Discount Response: ${String.fromCharCode(36)}{negotiationScript.counter_offer_fallback}\`);`,
      required: false,
    },
    {
      description: "SalaryIntelligence buildSalaryContextBlock \u2014 Counter-offer fallback (simpler)",
      find: "lines.push(`  Counter-offer fallback: ${negotiationScript.counter_offer_fallback}`);",
      replace: "lines.push(`  Discount Response: ${negotiationScript.counter_offer_fallback}`);",
      required: false,
    },
    {
      description: "SalaryIntelligence buildSalaryContextBlock \u2014 Company-specific range",
      find: "lines.push(`  Company-specific range: ${sr.currency} ${sr.min.toLocaleString()}-${sr.max.toLocaleString()} (confidence: ${sr.confidence})`);",
      replace: "lines.push(`  Deal value range: ${sr.currency} ${sr.min.toLocaleString()}-${sr.max.toLocaleString()} (confidence: ${sr.confidence})`);",
      required: true,
    },
    {
      description: "SalaryIntelligence buildSalaryContextBlock \u2014 salary_intelligence XML tag",
      find: `return \`<salary_intelligence>\n${String.fromCharCode(36)}{lines.join("\\n")}\n</salary_intelligence>\`;`,
      replace: `return \`<roi_intelligence>\n${String.fromCharCode(36)}{lines.join("\\n")}\n</roi_intelligence>\`;`,
      required: false,
    },
    {
      description: "SalaryIntelligence buildSalaryContextBlock \u2014 salary_intelligence XML open tag (simpler)",
      find: "return `<salary_intelligence>",
      replace: "return `<roi_intelligence>",
      required: false,
    },
    {
      description: "SalaryIntelligence buildSalaryContextBlock \u2014 salary_intelligence XML close tag",
      find: "</salary_intelligence>`",
      replace: "</roi_intelligence>`",
      required: false,
    },
    {
      description: "SalaryIntelligence \u2014 invalid estimate log",
      find: `console.warn("[SalaryIntelligence] Invalid estimate, missing required fields");`,
      replace: `console.warn("[ROIIntelligence] Invalid estimate, missing required fields");`,
      required: false,
    },
    {
      description: "SalaryIntelligence \u2014 resume-based estimate log",
      find: "`[SalaryIntelligence] Resume-based estimate: ${parsed.currency} ${parsed.min.toLocaleString()}-${parsed.max.toLocaleString()} (${parsed.confidence})`",
      replace: "`[ROIIntelligence] Offer-based ROI estimate (confidence: ${parsed.confidence})`",
      required: false,
    },
  ],

  // =========================================================================
  // 11. NegotiationConversationTracker.js \u2014 state machine (phase names kept)
  // =========================================================================
  "NegotiationConversationTracker.js": [
    {
      description: "NCT \u2014 SALARY_PATTERNS comment",
      find: "const SALARY_PATTERNS = [",
      replace: "// Detects dollar amounts in pricing discussion utterances\nconst SALARY_PATTERNS = [",
      required: false,
    },
    {
      description: "NCT \u2014 PUSHBACK_SIGNALS \u2014 above our / beyond our (budget language)",
      find: 'const PUSHBACK_SIGNALS = ["above our", "beyond our", "out of range", "can\'t go higher", "can\'t go above", "budget is fixed", "budget tops", "best we can do", "highest we can go"];',
      replace: 'const PUSHBACK_SIGNALS = ["above our", "beyond our", "out of range", "can\'t go higher", "can\'t go above", "budget is fixed", "budget tops", "best we can do", "highest we can go", "too expensive", "out of our budget", "more than we planned", "can\'t justify"];',
      required: true,
    },
    {
      description: "NCT \u2014 ACCEPTANCE_SIGNALS \u2014 that works",
      find: 'const ACCEPTANCE_SIGNALS = ["that works", "i\'ll get that approved", "let me send that", "we can do that", "let me confirm", "i can approve"];',
      replace: 'const ACCEPTANCE_SIGNALS = ["that works", "i\'ll get that approved", "let me send that", "we can do that", "let me confirm", "i can approve", "let\'s move forward", "let\'s do it", "send me the contract", "how do we get started"];',
      required: true,
    },
    {
      description: "NCT \u2014 BENEFITS_SIGNALS \u2014 signing bonus first",
      find: 'const BENEFITS_SIGNALS = ["signing bonus", "sign-on", "equity", "stock", "rsu", "options", "pto", "vacation days", "remote", "work from home", "wfh", "flexible"];',
      replace: 'const BENEFITS_SIGNALS = ["payment plan", "installments", "phased", "scope", "deliverables", "guarantee", "refund", "pilot", "trial", "milestone", "retainer"];',
      required: true,
    },
    {
      description: "NCT \u2014 SALARY_CONTEXT_WORDS \u2014 targeting asking",
      find: 'const SALARY_CONTEXT_WORDS = ["targeting", "asking", "looking for", "expect", "want", "need", "require", "range"];',
      replace: 'const SALARY_CONTEXT_WORDS = ["targeting", "asking", "looking for", "expect", "investment", "fee", "cost", "price", "budget", "afford", "spend", "pay"];',
      required: true,
    },
    {
      description: "NCT getStateXML \u2014 Recruiter in offer history",
      find: `${String.fromCharCode(96)}  - ${String.fromCharCode(36)}{e.speaker === "recruiter" ? "Recruiter" : "You"}: ${String.fromCharCode(36)}{e.currency} ${String.fromCharCode(36)}{(e.amount / 1e3).toFixed(0)}k ("${String.fromCharCode(36)}{escapeXml(e.raw.substring(0, 60))}")${String.fromCharCode(96)}`,
      replace: `${String.fromCharCode(96)}  - ${String.fromCharCode(36)}{e.speaker === "recruiter" ? "Prospect" : "Kate"}: ${String.fromCharCode(36)}{e.currency} ${String.fromCharCode(36)}{(e.amount / 1e3).toFixed(0)}k ("${String.fromCharCode(36)}{escapeXml(e.raw.substring(0, 60))}")${String.fromCharCode(96)}`,
      required: false,
    },
    {
      description: "NCT getStateXML \u2014 Recruiter (simpler match)",
      find: '? "Recruiter" : "You"',
      replace: '? "Prospect" : "Kate"',
      required: false,
    },
    {
      description: "NCT getStateXML \u2014 Their latest offer recruiter label",
      find: "Their latest offer:",
      replace: "Prospect's latest figure:",
      required: true,
    },
    {
      description: "NCT addRecruiterUtterance \u2014 Not stated yet (offer)",
      find: '"Not stated yet"',
      replace: '"Not stated yet"',
      required: false,
      description: "no-op \u2014 already neutral",
    },
    {
      description: "NCT normalizeAmount range check \u2014 20k to 5M",
      find: "if (amount >= 2e4 && amount <= 5e6 && !seen.has(amount)) {",
      replace: "if (amount >= 5e3 && amount <= 1e6 && !seen.has(amount)) {",
      required: false,
      description: "Adjust amount range to be more realistic for $30k program discussions",
    },
    {
      description: "NCT reset log",
      find: "console.log(\"[NegotiationConversationTracker] Reset to neutral (0.5)\");",
      replace: "console.log(\"[PricingConversationTracker] Reset to initial state\");",
      required: false,
    },
  ],

  // =========================================================================
  // 12. LiveNegotiationAdvisor.js \u2014 real-time coaching
  // =========================================================================
  "LiveNegotiationAdvisor.js": [
    {
      description: "LiveNegAdvisor PHASE_INSTRUCTIONS \u2014 PROBE",
      find: `PROBE: \`No numbers on table yet. Coach user to delay their ask by asking "What's the budgeted range?" OR anchor at upper market range if pressed.\``,
      replace: `PROBE: \`No price on the table yet. Coach Kate to let the prospect talk more. Ask: "What's prompting you to look at this now?" or "What does solving this look like for your business?" \u2014 qualify before anchoring at $30k.\``,
      required: true,
    },
    {
      description: "LiveNegAdvisor PHASE_INSTRUCTIONS \u2014 ANCHOR",
      find: `ANCHOR: \`Recruiter dropped a number. User needs to counter. Acknowledge briefly, counter 10-15% above their target. Ground in 2-3 specific achievements + market data. Never accept first offer.\``,
      replace: `ANCHOR: \`Prospect raised a price concern or asked about cost. Kate should anchor at $30,000 confidently. Acknowledge briefly, then ground in 2-3 specific client outcomes and the ROI framing. Never pre-discount.\``,
      required: true,
    },
    {
      description: "LiveNegAdvisor PHASE_INSTRUCTIONS \u2014 COUNTER",
      find: `COUNTER: \`User countered. Hold position and reinforce justification with specific wins. Ask open-ended question to keep negotiation alive. Do NOT drop the ask unless recruiter makes a specific counter.\``,
      replace: `COUNTER: \`Kate named $30k. Hold the number. Reinforce with a specific client win or ROI example. Ask an open question to keep momentum: "What would make this feel like an obvious yes?" Do NOT drop the price.\``,
      required: true,
    },
    {
      description: "LiveNegAdvisor PHASE_INSTRUCTIONS \u2014 HOLD",
      find: `HOLD: \`Recruiter pushed back saying ask is above range. This is NOT a final no \u2014 it is a tactic. Options in order: (1) hold with silence + re-justify, (2) ask "What is the budget band for this role?", (3) ask about signing bonus or equity. Do NOT immediately drop the number.\``,
      replace: `HOLD: \`Prospect pushed back on $30k. This is NOT a final no \u2014 it is resistance. Options in order: (1) hold with silence + re-justify ROI, (2) ask "What number would feel comfortable, and what's driving that?", (3) explore payment plan or phased scope. Do NOT drop below $30k.\``,
      required: false,
    },
    {
      description: "LiveNegAdvisor PHASE_INSTRUCTIONS \u2014 PIVOT_BENEFITS",
      find: `PIVOT_BENEFITS: \`Salary ceiling appears fixed. Maximize total comp: (1) signing bonus first \u2014 easiest approval, different budget, (2) equity, (3) extra PTO, (4) remote flexibility. Frame as: "I understand the base is set \u2014 could we look at the signing bonus?"\``,
      replace: `PIVOT_BENEFITS: \`Price resistance is firm. Shift focus to total program value: (1) emphasize the guarantee and what it covers, (2) reference the implementation support and mentorship hours included, (3) offer a milestone-based payment structure if available. Frame as: "I understand the investment feels significant \u2014 let me show you exactly what $30k delivers and why our clients see 10x ROI within 18 months."\``,
      required: false,
    },
    {
      description: "LiveNegAdvisor PHASE_INSTRUCTIONS \u2014 CLOSE",
      find: `CLOSE: \`Recruiter signaling agreement. Confirm full package, request written offer within 24-48h. Say: "That sounds great \u2014 could you send the written offer so I can review the full package?"\``,
      replace: `CLOSE: \`Prospect signaling yes. Confirm next steps, send proposal within 24h, set a 2-week close window. Say: "Fantastic \u2014 I'll send the proposal today. Let's plan to connect next week to answer any final questions and get you started."\``,
      required: false,
    },
    {
      description: "LiveNegAdvisor prompt \u2014 USER'S PROFILE role",
      find: "USER'S PROFILE:",
      replace: "KATE'S SALES CONTEXT:",
      required: true,
    },
    {
      description: "LiveNegAdvisor prompt \u2014 Role field",
      find: "Role: ${(resume.experience || [])[0]?.role || \"Unknown\"}",
      replace: "Rep: Kate Schnetzer, Account Executive, The Scalable Company",
      required: false,
    },
    {
      description: "LiveNegAdvisor prompt \u2014 Key achievements",
      find: "Key achievements:",
      replace: "Key program outcomes / client wins:",
      required: true,
    },
    {
      description: "LiveNegAdvisor prompt \u2014 CONTEXT Job title at company",
      find: "Job: ${jd?.title || \"Unknown\"} at ${jd?.company || \"Unknown\"}",
      replace: "Prospect: ${jd?.title || \"Unknown\"} at ${jd?.company || \"Unknown\"}",
      required: false,
    },
    {
      description: "LiveNegAdvisor prompt \u2014 Market salary range",
      find: "Market salary range: ${marketRange}",
      replace: "ROI range vs $30k fee: ${marketRange}",
      required: false,
    },
    {
      description: "LiveNegAdvisor prompt \u2014 User's target",
      find: "User's target: ${userTarget ? `USD ${userTarget.toLocaleString()}` : \"Not established\"}",
      replace: "Kate's price target: $30,000 (program fee, non-negotiable floor)",
      required: false,
    },
    {
      description: "LiveNegAdvisor prompt \u2014 tacticalNote description",
      find: `  "tacticalNote": "1-2 sentences: what just happened tactically and why this is the right move",`,
      replace: `  "tacticalNote": "1-2 sentences: what just happened in the pricing conversation and why this is the right sales move",`,
      required: true,
    },
    {
      description: "LiveNegAdvisor prompt \u2014 exactScript description",
      find: `  "exactScript": "Exact words for the user to say \u2014 first person, real numbers, under 3 sentences"`,
      replace: `  "exactScript": "Exact words for Kate to say \u2014 first person, real numbers ($30k), under 3 sentences"`,
      required: false,
    },
    {
      description: "LiveNegAdvisor PHASE_LABELS \u2014 Getting started",
      find: '    INACTIVE: "Getting started",',
      replace: '    INACTIVE: "Discovery phase",',
      required: true,
    },
    {
      description: "LiveNegAdvisor PHASE_LABELS \u2014 Exploring the range",
      find: '    PROBE: "Exploring the range",',
      replace: '    PROBE: "Qualifying the prospect",',
      required: true,
    },
    {
      description: "LiveNegAdvisor PHASE_LABELS \u2014 Recruiter made an offer",
      find: '    ANCHOR: "Recruiter made an offer",',
      replace: '    ANCHOR: "Price raised \u2014 anchor at $30k",',
      required: true,
    },
    {
      description: "LiveNegAdvisor PHASE_LABELS \u2014 You countered holding position",
      find: '    COUNTER: "You countered \u2014 holding position",',
      replace: '    COUNTER: "Kate named $30k \u2014 holding position",',
      required: false,
    },
    {
      description: "LiveNegAdvisor PHASE_LABELS \u2014 Recruiter pushed back",
      find: '    HOLD: "Recruiter pushed back",',
      replace: '    HOLD: "Prospect pushed back on price",',
      required: true,
    },
    {
      description: "LiveNegAdvisor PHASE_LABELS \u2014 Pivoting to total comp",
      find: '    PIVOT_BENEFITS: "Pivoting to total comp",',
      replace: '    PIVOT_BENEFITS: "Pivoting to program value and guarantees",',
      required: true,
    },
    {
      description: "LiveNegAdvisor PHASE_LABELS \u2014 Closing the deal",
      find: '    CLOSE: "Closing the deal"',
      replace: '    CLOSE: "Closing the deal"',
      required: false,
      description: "no-op \u2014 already neutral",
    },
    {
      description: "LiveNegAdvisor fallback \u2014 Negotiating",
      find: '`${PHASE_LABELS[state.phase] ?? "Negotiating"}.${state.offers.latestRecruiterAmount ? ` Their offer: USD ${state.offers.latestRecruiterAmount.toLocaleString()}.` : ""} Hold your position and justify with market data.`',
      replace: '`${PHASE_LABELS[state.phase] ?? "Negotiating"}.${state.offers.latestRecruiterAmount ? ` Prospect figure: USD ${state.offers.latestRecruiterAmount.toLocaleString()}.` : ""} Hold at $30k and justify with ROI and client wins.`',
      required: false,
    },
    {
      description: "LiveNegAdvisor fallback \u2014 Their offer USD (simpler)",
      find: "Their offer: USD ${state.offers.latestRecruiterAmount.toLocaleString()}.",
      replace: "Prospect figure: USD ${state.offers.latestRecruiterAmount.toLocaleString()}.",
      required: false,
    },
    {
      description: "LiveNegAdvisor fallback \u2014 Hold your position market data",
      find: "Hold your position and justify with market data.",
      replace: "Hold at $30k and justify with ROI and client wins.",
      required: false,
    },
    {
      description: "LiveNegAdvisor fallback \u2014 opening_line based on market data",
      find: `exactScript: negotiationScript?.opening_line || "Based on my experience and the market data for this role, I'm targeting the upper end of the range we discussed."`,
      replace: `exactScript: negotiationScript?.opening_line || "The Scale and Exit program is $30,000. Based on what I'm hearing about your situation, the ROI is typically 10x within 18 months."`,
      required: true,
    },
    {
      description: "LiveNegAdvisor marketRange \u2014 negotiationScript salary_range",
      find: "negotiationScript?.salary_range",
      replace: "negotiationScript?.salary_range",
      required: false,
      description: "no-op \u2014 key name preserved for compatibility",
    },
  ],

  // =========================================================================
  // 13. AOTPipeline.js \u2014 verify no direct prompt text, no changes needed
  //     (all prompts are in the 5 dependencies above)
  // =========================================================================
  "AOTPipeline.js": [
    {
      description: "AOTPipeline log \u2014 Starting AOT pipeline",
      find: '`[AOTPipeline] ⚡ Starting AOT pipeline for ${jd.title || jd.role || "Unknown"} at ${jd.company || "Unknown"}...`',
      replace: '`[AOTPipeline] ⚡ Starting sales prep pipeline for ${jd.title || jd.role || "Unknown"} at ${jd.company || "Unknown"}...`',
      required: false,
    },
    {
      description: "AOTPipeline \u2014 Negotiation script pre-computed log",
      find: `console.log("[AOTPipeline] Negotiation script pre-computed");`,
      replace: `console.log("[AOTPipeline] Pricing script pre-computed");`,
      required: false,
    },
    {
      description: "AOTPipeline \u2014 Gap analysis complete log",
      find: "`[AOTPipeline] Gap analysis complete: ${analysis.match_percentage}% match`",
      replace: "`[AOTPipeline] Prospect fit analysis complete: ${analysis.match_percentage}% match`",
      required: false,
    },
  ],
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const KNOWLEDGE_DIR = "dist-electron/premium/electron/knowledge";

function applyPatches(stagingDir: string): boolean {
  const knowledgeDir = join(stagingDir, KNOWLEDGE_DIR);
  let allPassed = true;

  console.log(`\nPatch target directory: ${knowledgeDir}\n`);
  console.log("=".repeat(70));

  for (const [filename, patches] of Object.entries(PATCH_MAP)) {
    const filePath = join(knowledgeDir, filename);
    let content: string;

    try {
      content = readFileSync(filePath, "utf-8");
    } catch (err) {
      console.error(`\n❌ CANNOT READ: ${filename} \u2014 ${(err as Error).message}`);
      allPassed = false;
      continue;
    }

    console.log(`\n📄 ${filename}`);
    let applied = 0;
    let failed = 0;
    let skipped = 0;

    for (const patch of patches) {
      // Skip no-op placeholders
      if (patch.find === patch.replace || patch.description?.startsWith("no-op")) {
        skipped++;
        continue;
      }

      const findStr = typeof patch.find === "string" ? patch.find : patch.find;
      let count = 0;

      if (typeof findStr === "string") {
        // Check occurrence count
        let idx = 0;
        while ((idx = content.indexOf(findStr as string, idx)) !== -1) {
          count++;
          idx++;
        }

        if (count === 0) {
          // Idempotency check: if the replacement text is already in the file,
          // a prior rebuild already applied this patch. Treat as success.
          if (content.includes(patch.replace)) {
            console.log(`   ✅ ${patch.description} (already applied)`);
            applied++;
            continue;
          }
          if ((patch as any).required) {
            console.error(`   ❌ REQUIRED patch not found: "${patch.description}"`);
            console.error(`      Looking for: ${(findStr as string).substring(0, 80).replace(/\n/g, "\\n")}...`);
            allPassed = false;
            failed++;
          } else {
            console.log(`   ⚠️  Optional patch not found (ok): "${patch.description}"`);
            skipped++;
          }
          continue;
        }

        if (count > 1) {
          console.warn(`   ⚠️  Multiple matches (${count}) for: "${patch.description}" \u2014 applying all`);
        }

        content = content.split(findStr as string).join(patch.replace);
        applied++;
        console.log(`   ✅ ${patch.description}`);
      } else {
        // Regex path
        const regex = findStr as RegExp;
        const matches = content.match(regex);
        count = matches ? matches.length : 0;

        if (count === 0) {
          if ((patch as any).required) {
            console.error(`   ❌ REQUIRED regex patch not found: "${patch.description}"`);
            allPassed = false;
            failed++;
          } else {
            console.log(`   ⚠️  Optional regex not found (ok): "${patch.description}"`);
            skipped++;
          }
          continue;
        }

        content = content.replace(regex, patch.replace);
        applied++;
        console.log(`   ✅ ${patch.description}`);
      }
    }

    // Write back
    writeFileSync(filePath, content, "utf-8");
    console.log(`   \u2192 Applied: ${applied}, Failed: ${failed}, Skipped: ${skipped}`);
  }

  return allPassed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: bun run scripts/patch-premium-prompts.ts <staging-dir>");
  console.error("Example: bun run scripts/patch-premium-prompts.ts /tmp/rebuild-staging");
  process.exit(1);
}

const stagingDir = args[0];
console.log(`\n🔧 Patching premium modules in: ${stagingDir}`);
console.log(`   Context: Kate Schnetzer / The Scalable Company / Scale and Exit program ($30k)\n`);

const passed = applyPatches(stagingDir);

console.log("\n" + "=".repeat(70));
if (passed) {
  console.log("✅ All required patches applied successfully.\n");
  process.exit(0);
} else {
  console.error("❌ One or more REQUIRED patches failed. Review output above.");
  console.error("   This means the premium modules may have been updated.");
  console.error("   Update PATCH_MAP in scripts/patch-premium-prompts.ts to match.\n");
  process.exit(1);
}
