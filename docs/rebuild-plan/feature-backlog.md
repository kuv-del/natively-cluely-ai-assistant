# Natively Customization Backlog

Features Kate has confirmed she wants but that we're not building right now. Listed in the order she expects to ship, not necessarily priority order.

---

## Architectural decisions locked (2026-04-14)

These are load-bearing — everything below inherits from them.

### Contact-first workflow
Kate sells to company owners directly — **the contact IS the deal**. All new Natively-side queries, endpoints, and schema additions key on `contact_id` as the primary anchor. `deal_id` and `company_id` remain present for backward compatibility with gobot's existing HubSpot/deal pipeline, but Natively's read/write path uses `contact_id` first. New DealDetails endpoint is `GET /natively/deal-details?contact_id=...`, not `?deal_id=...`.

### HubSpot contact ID is the canonical cross-system linkage
**Rule:** every sales-related Convex table that references a contact MUST include `hubspot_contact_id` as a denormalized string field, indexed via `by_hubspot_contact`, **in addition to** the internal Convex `contact_id: v.id("contacts")` FK.

**Why:**
- Convex internal `_id` values are not stable across re-imports, table rebuilds, or data migrations
- HubSpot contact ID is stable forever — it's how every external system (HubSpot workflows, Zapier, Apps Script sheet-sync, Natively) identifies a prospect
- Without HubSpot ID denormalization, if a Convex contact row is ever deleted + re-created, every dependent row loses its anchor
- Enables reliable cross-system reconciliation: any external tool that holds a HubSpot contact ID can find the corresponding Convex rows with one indexed lookup, no join chain needed

**Write-time invariant:** when a pipeline writes a sales-related row that has a resolved `contact_id`, it MUST also resolve + persist `hubspot_contact_id` in the same write. Ingestion scripts (`slack-triage-sync`, `zoom-transcript-sync`, `discovery-transcript-sync`, future Natively write-throughs) fetch the contact's `hubspot_contact_id` from the `contacts` table and pass it through to the mutation.

**Existing tables not yet compliant:** `meetings`, `call_transcripts`, `deals`. These are load-bearing and widely-used; retrofitting them requires a coordinated update to every writer. **Action item — backlog entry:** sweep existing tables into compliance in a dedicated ratcheting pass, schema first (add optional `hubspot_contact_id`), then update each writer, then backfill existing rows via a one-time mutation like `sdrNotes.backfillHubspotIds` (see `convex/sdrNotes.ts`).

**Compliant tables as of 2026-04-14:** `contacts` (has `hubspot_contact_id` natively), `sdr_notes`, `natively_transcripts`, `natively_summaries`, `natively_preps`, `natively_notes`.

### Dual-pool Convex structure
Existing shared tables (`call_transcripts`, `meetings`, `deals`, `contacts`, `companies`) are untouched. **New Natively-private tables sit alongside them**, all FK'd to `contact_id`:
- `natively_transcripts`
- `natively_summaries`
- `natively_preps`
- `natively_notes` (running prospect notes, cumulative across meetings)

Natively writes only to the private pool. Other gobot pipelines (zoom-transcript-sync, discovery-transcript-sync, slack-triage-sync) continue writing to the shared pool as they do today.

### Read precedence: Natively-first with shared-pool fallback
When Natively (or DealDetails) loads prospect context, the Convex endpoint unions the two pools with **Natively winning on dedup by `calendar_event_id`**:
1. Fetch all Natively-private rows for this `contact_id`
2. Fetch all shared-pool rows for this `contact_id`
3. Exclude any shared-pool row whose `calendar_event_id` is already in the Natively set
4. Return the merged set sorted chronologically

This means: if Kate ran Natively for the demo and Zoom backup for the discovery, she sees both — Natively's richer data for the demo, Zoom's transcript for the discovery. If Kate ran Natively for both, Zoom duplicates are silently filtered out.

### Natively as the primary engine
- Natively is the canonical capture surface for Kate's own calls going forward
- Zoom transcript sync stays as a safety net for calls Kate forgot to start Natively on
- SDR discovery transcript sync + SDR Slack note sync continue as-is — Natively reads them from the shared pool but doesn't overwrite them
- Local SQLite in Natively becomes a **current-week cache only** — historical lookups go to Convex. Cache retention: keep current week + the week prior, let older data age out

### Meeting outcome classification — tomato color + manual command, nothing else
**Rule:** a meeting is only classified as "cancelled" or "no-show" via two explicit triggers. Nothing else — no heuristics, no inference from missing transcripts, no guessing from calendar availability.

**Trigger 1: Google Calendar tomato color (colorId=11).** Kate colors the event tomato. Timing determines the label:
- Tomato **before** the meeting's scheduled start_time → **cancelled**
- Tomato **at or after** the meeting's scheduled start_time → **no-show**

**Trigger 2: Manual command via gobot or Natively chat.** Kate explicitly tells the bot "mark [prospect] as no-show" or "cancel [prospect]." Bot resolves the meeting and writes the outcome.

**Explicitly NOT a trigger:**
- Missing Zoom transcript → could be a sync failure, processing delay, or Zoom didn't record; says nothing about whether the meeting happened
- Past start_time with no activity → could be in-progress, could be a delayed transcript, could be anything
- Attendee availability changes → unrelated to Kate's decision

**Future extension:** front-desk agent will handle reschedule-requested and rescheduled states as a separate layer on top of this; it will write distinct outcome values. For now only cancelled / no-show are supported.

**Implications for scripts currently running:**
- `scripts/link-sdr-notes-to-demos.ts` — does NOT use transcript absence as a no-show signal. Only links sdr_notes → demos when a Zoom transcript is present (high-confidence "demo happened"). Past demos without transcripts go into a neutral "outcome unknown" bucket.
- DealDetails — Discovery/Demo/Follow-Up tabs show outcome labels pulled from `meetings.call_outcome` populated by the outcome classifier (backlog 1.16), never inferred client-side.

### Expected-null pattern: Kate-taken discoveries have no SDR triage notes
Kate sometimes takes the initial discovery/triage call herself instead of handing off to an SDR. In those cases the prospect will have a discovery meeting on Kate's calendar + a Zoom transcript in Convex, but **no row in `sdr_notes`** — because the SDR didn't post anything in `#sco-sdr-meetings-booked` (Kate took the call, not them). This is **not** a sync gap; it's expected behavior. DealDetails empty-state copy on the SDR-notes section should read "No SDR notes — check Discovery tab for the transcript" rather than "missing data," and automated coverage reports should not flag Kate-taken-discovery contacts as missing SDR notes.

### Slack notes: Slack → Convex → Notion (not Slack → Notion directly)
Current `src/slack-triage-sync.ts` writes straight to Notion. Flip it so:
1. **Primary path:** Slack → Convex `sdr_notes` table (new). This is the source of truth.
2. **Secondary script:** new `scripts/sync-sdr-notes-to-notion.ts` reads unsynced rows from Convex and pushes to Notion as a backup surface.
3. **Later cleanup** (see Phase 1 item 1.12 below): once Natively is live and Kate isn't using Notion for meeting review, delete the Convex→Notion sync script entirely. Notion stops being a dependency.

### Discovery vs SDR Triage classification — mutually exclusive per contact (2026-04-14)
**Rule (Kate, 2026-04-14):** a contact can have **at most one** meeting of type `discovery` OR `sdr_triage`. Never both, never two.
- Kate hosted the call → `discovery`
- Anyone else hosted → `sdr_triage`
- There is no `sdr_discovery` category (legacy rows backfilled to `sdr_triage`)

**Root cause of prior duplication:** sheet-sync created a `discovery` meeting when the call was booked on Kate's calendar; separately, `discovery-transcript-sync.ts` created a fresh `sdr_triage` row when the Gong Drive transcript arrived. Two rows per call. Fixed 2026-04-14 (evening) — `discovery-transcript-sync` now looks up any existing discovery/sdr_triage row for the same contact on the same date via `meetingsFns.findByContactAndTime` and **patches it in place** (relabel type, rename title, attach transcript) instead of creating a new one.

**SDR transfer pattern:** when an SDR takes a call that was originally booked on Kate's calendar, the sheet-sync `discovery` row gets reclassified to `sdr_triage` the moment the Gong Drive transcript lands. No ghost rows.

---

## Session 2026-04-14 (evening) — shipped + data repair

### Shipped to running Natively (uncommitted batch of 10 files in experiment worktree)
- **Prior SDR Context widget** on MeetingDetails Prep tab. For any meeting, fetches prior `sdr_triage`/`sdr_discovery` calls for the same contact and renders them as cards: type label, date, rep name, full markdown summary, "Show full transcript" toggle. Also renders any `sdr_notes` rows for the contact. Silent if empty.
- **Past Meetings card widget** on DealDetails. Replaced the bare heading + summary + divider layout with bordered cards matching the MeetingDetails prep pattern: header row (type + date + Open pill), summary body, "Show full transcript" toggle that expands into a 400px-max scrollable panel. Same UX across both pages.
- **Chat-with-AI ask bar on DealDetails** (floating at the bottom, same UX as MeetingDetails). Routes to a new Claude Max subprocess path (see below), not Groq/Gemini. Context blob packs the entire deal: contact, company, deal, cumulative summary, every past meeting with full summary AND full transcript, SDR notes, upcoming meeting + prep dossier. No truncation — Claude Max context window handles it.
- **`useClaudeBackend` prop on `MeetingChatOverlay`** (`src/components/MeetingChatOverlay.tsx`). Opt-in flag that short-circuits the Groq/Gemini/RAG streaming pipeline and calls `window.electronAPI.claudeChatOneshot(prompt)` instead. Non-streaming (one-shot response after a typing indicator). `claudeSystemPreamble` prop lets callers frame the task. MeetingDetails chat is NOT yet switched over — still on Groq/Gemini.
- **KaTeX math plugin removed from chat renderer** — `remark-math` + `rehype-katex` were interpreting Claude's `$260K-$500K` revenue mentions as inline LaTeX math and rendering them in italic math font. Kept `remarkGfm` for tables/lists.

### New Convex surface area (gobot, committed + deployed to dev)
- `convex/natively.ts` — new query `prepBundleForMeeting(meeting_id)`. Given any meeting, returns prior SDR calls for the same contact (each with transcript, summary, rep, source, date) + all `sdr_notes` rows for that contact. Read-time aggregation — no new table, no data duplication.
- `convex/http.ts` — new HTTP route `GET /natively/meeting-prep-bundle?meeting_id=...` wrapping the query.
- Deployed to dev (`opulent-bandicoot-376`). Verified live against Andres Vargas's discovery meeting: returns 1 prior SDR triage (Kristina Bravo, 17k-char transcript + 770-char summary).
- Commit `80cebad` pushed to origin.

### New Natively IPC surface
- `claude-chat-oneshot` IPC handler (`electron/ipcHandlers.ts`). Spawns `claude -p <prompt>` via `child_process.spawn`. Flags: `--no-session-persistence`, `--disable-slash-commands`. CWD: `os.tmpdir()` (sandboxed — blocks CLAUDE.md auto-discovery + prevents `~/Documents` TCC prompts). Explicit `PATH=/opt/homebrew/bin:...` so the binary resolves in Electron's minimal env. Does NOT use `--bare` (would force `ANTHROPIC_API_KEY` and break Kate's OAuth-based Max plan).
- 120-second timeout, handles ENOENT / non-zero exit / empty output / subprocess throw.
- Returns `{ ok: true, answer } | { ok: false, error }`.

### Root-cause fixes (gobot, committed)
- **Summarizer PATH bug** — `~/Library/LaunchAgents/com.go.summary-gen.plist` had `PATH=/Users/jamesleylane/.bun/bin:/usr/local/bin:/usr/bin:/bin`. `claude` lives at `/opt/homebrew/bin/claude`. Every run of `scripts/generate-meeting-summaries.ts` was ENOENT'ing on the first `Bun.spawn(["claude", ...])`. Fixed by prepending `/opt/homebrew/bin:` to the PATH env in the plist and reloading launchctl. Manual verification run summarized 10 meetings (success=10, errors=0). Plist edit is outside the repo; launchd/template file is intentionally NOT committed (would need to be if a template is added later). Before this fix, **zero** rows across 313 `call_transcripts` had any `summary_markdown` populated.
- **`discovery-transcript-sync` classifier** (`src/discovery-transcript-sync.ts`, commits `0bd0b07` + `1a1f709`). Two changes: (a) classify by `parsed.rep_name` — Kate-run → `discovery`, otherwise → `sdr_triage`. No `sdr_discovery` ever gets created. (b) Before creating a new meeting, call `meetingsFns.findByContactAndTime` and if an existing discovery/sdr_triage row is found for the same contact + date, patch it in place instead of creating a duplicate. Kills the dual-pipeline duplication at the source.
- **Dead `/gong-sync` HTTP handler removed** (`convex/http.ts`, commit `e98a832`). 145 lines deleted. The handler had no live callers anywhere in the repo — the 119 existing `gong` rows in `call_transcripts` were a one-time backfill from Feb 26 – Mar 4 and have been frozen since. Active Gong ingestion all flows through `discovery-transcript-sync` reading the shared Drive folder. Deployed to dev Convex — `POST /gong-sync` now returns 404.

### Data repair (pure Convex mutations, no git)
- **119 stale `gong` rows** deleted from `call_transcripts` (the Feb–Mar 2026 one-time backfill residue).
- **45 duplicate / ghost rows** deleted across 36 contacts with discovery/sdr_triage duplicates:
  - 12 "SDR transfer" ghost discovery rows (sheet-sync row left behind when Kate's original discovery was transferred to an SDR)
  - 13 same-call sync-twice `sdr_triage` duplicates (Gong Drive worker ran twice on the same transcript file; title format change between runs left both behind)
  - 11 backfill-collision discoveries (Group B — my own rep_name-based reclassification created `discovery` rows that duplicated sheet-sync rows)
  - 3 surviving-ghost-after-dedupe discoveries (Group C — cluster had both same-type dupes AND a cross-type ghost)
  - 5 empty-meeting same-call dupes (sheet-sync wrote a meeting shell; gong_drive wrote the same call with transcript; collapsed to the row with the transcript)
  - 1 template hold (`"Discovery Call — Kate Schnetzer"` calendar-slot placeholder, not a real prospect)
- **12 meetings reclassified** from `sdr_triage`/`sdr_discovery` → `discovery` based on `rep_name` = Kate Schnetzer.
- **41 `sdr_discovery` rows normalized** to `sdr_triage`. Zero `sdr_discovery` rows remain.
- **Post-cleanup invariant:** 210 contacts have discovery/sdr_triage rows, zero have 2+. Rule enforced dataset-wide.

### Known bugs surfaced but not fixed
- **Cumulative summary generator gate is wrong.** `convex/nativelySummariesFns.ts` `contactsWithSufficientSummaries` counts rows in `natively_summaries` where `summary_type === "per_meeting"` — a table nothing writes to. Zero per-meeting rows exist, so the gate always returns empty. The actual cumulative generator (`scripts/generate-deal-summary.ts`) reads from `meetings.summary_markdown` via `dealDetails.byContactId`, not from `natively_summaries.per_meeting`. Fix is ~10 lines: rewrite the gate query to count meetings with non-null `summary_markdown` per contact. Until fixed, only manually-seeded cumulative summaries exist (Michael Koonce is the only one in the table). **Koonce's cumulative summary is now stale** after this session's cleanup deleted his duplicate row — regeneration would need the gate fixed first.
- **`natively_transcripts` table still has no writer.** Verified exhaustively this session: no mutation anywhere in gobot or the Natively fork writes to this table. Kate's Flow 2 (Natively records her own discovery live → Convex) is still architecturally unbuilt. Table is empty. Sketch of minimal implementation is in Phase 1 (1.1 Storage architecture).
- **Gong-sourced `call_transcripts` rows have 100% orphan rate** in the original 313-row audit (119 rows, none linked to a `meeting_id`). All deleted in this session's cleanup. When/if a new gong-ingest path is built, it must link meetings by `calendar_event_id` + `contact_id` + time window, not just company name → first contact.
- **`rep_name` parser captures transcript filler words** for ~20 rows in the broader `call_transcripts` dataset (values like "Oh", "Yeah.", "Okay."). Parser grabs the first speaker utterance from the transcript as the rep name. Cosmetic but visible in the Past Meetings card header on DealDetails for affected rows.
- **MeetingDetails chat is still on Groq/Gemini.** Per Kate's rule ("Deepgram live only, Claude Max for everything else"), it should be switched to `useClaudeBackend={true}`. Infrastructure is in place — just a one-prop change on the MeetingChatOverlay instance in `MeetingDetails.tsx`.
- **Meeting reconciler for SDR transfers not built.** When an SDR transfers a meeting off Kate's calendar (deletes the event from her view), the Convex `meetings` row isn't deleted — only the `discovery-transcript-sync` in-place patch covers the case where the Gong Drive transcript later lands. If the transcript never comes (non-demo call, SDR skipped Gong), the stale discovery row persists. Needs a periodic reconciler that walks upcoming Convex meetings and removes any whose `calendar_event_id` is gone from Google Calendar.
- **Docs still reference the dead `/gong-sync` endpoint** in `docs/architecture.md` and two plan docs under `docs/plans/2026-03-03-transcript-to-notion-sync*.md`. Historical references, safe to leave; can be scrubbed in a docs pass.

### Files changed this session

**gobot (committed + pushed):**
- `convex/http.ts` — removed `/gong-sync` handler; added `/natively/meeting-prep-bundle` route
- `convex/natively.ts` — added `prepBundleForMeeting` query
- `src/discovery-transcript-sync.ts` — classifier by rep_name + collapse-onto-existing-meeting

**Natively experiment worktree (uncommitted — pending Kate's confirmation to batch-commit):**
- `electron/ipcHandlers.ts` — `convex-get-meeting-prep-bundle` + `claude-chat-oneshot` handlers
- `electron/preload.ts` — two new IPC bridges + types
- `src/types/electron.d.ts` — type declarations for both new APIs
- `src/types/deal-details.ts` — corrected `transcript` type from phantom `Array<{speaker, text, timestamp}>` → `string | null`
- `src/components/MeetingDetails.tsx` — Prior SDR Context section on Prep tab
- `src/components/DealDetails.tsx` — Past Meetings card widget + full-context Claude chat
- `src/components/deal-tabs/DealCallTypeTab.tsx` — fixed `.map()` on string runtime bug uncovered by the type correction
- `src/components/MeetingChatOverlay.tsx` — `useClaudeBackend` prop, math plugin removed

### 🎯 Priority 1 for 2026-04-15 — test Natively during a real Zoom call

Before any new feature work tomorrow, Kate needs to **run Natively during an actual live Zoom sales call** to validate everything that landed tonight under real conditions. This is a smoke test of the full stack end-to-end: Deepgram live transcription in the header UI, coaching overlay, MeetingDetails capture, post-call summary generation, DealDetails aggregation, prior SDR context surfacing, chat-with-Claude over the full deal.

Gaps or friction surfaced during the live call become the top of the next session's work. Do not block this test on any other feature build.

---

## New backlog items — 2026-04-14 night (Kate's brainstorm)

Not yet sequenced into phases. Captured verbatim so they're not lost; Kate will prioritize in a future session.

### Two-way Google Calendar sync into Natively
**What:** Full two-way sync between Google Calendar and Natively's internal meeting state. Today Natively only READS from Google Calendar (via `CalendarManager.fetchEventsInternal`) — if an event is edited, cancelled, moved, or added in Google Calendar (on Kate's phone, on the web, via another tool), Natively has to poll + re-read to notice. And changes made inside Natively (event color, reschedule, outcome marking) only write back via isolated helpers (`updateEvent`, `updateEventColor`) that aren't tied to a general sync loop.

**What Kate wants:**
- Reliable bidirectional sync — a change on either side propagates to the other within seconds (watch/push notifications preferred over polling)
- Natively's meeting list and calendar widget always reflect the live Google Calendar state
- When Kate edits event title / time / color / attendees inside Natively, the change lands in Google Calendar immediately
- Deletions, reschedules, and cancellations handled cleanly — no ghost rows left behind in Natively's UI

**Notes:** Google Calendar supports push notifications via the Calendar API watch channel — that's the reliable path. Polling every N seconds is the fallback. The existing `updateEvent`/`updateEventColor` helpers already handle the write-back direction; what's missing is a consolidated sync engine that keeps the read side fresh AND observes local mutations.

**Dependencies:** Probably wants the "Calendar widget with right-click color change" feature (3.1) to land at the same time — the widget is the UI consumer of the sync.

**Effort:** TBD. Push-notification path needs a public webhook endpoint (VPS-side), polling fallback doesn't.

### Google Calendar widget with two-way sync
**What:** Full calendar widget rendered inside Natively's launcher (or a dedicated surface), showing Kate's live calendar in Google-Calendar–native format (day / 3-day / week view). Events render in their Google Calendar colors. Interactions write back immediately:
- Right-click → change color (Blueberry / Lavender / Tomato / Tangerine) — already wired at the IPC layer via `calendarUpdateEventColor`
- Drag to reschedule — PATCH the event's start/end
- Delete from right-click menu → PATCH or DELETE via Calendar API
- Click an event → open its MeetingDetails / DealDetails page

**Relationship to existing items:** This supersedes backlog 3.1 ("Calendar widget with right-click color change") with a broader scope. 3.1 can be folded into this. Also related to the "Next 3 working days" calendar view in the "Larger items not yet started" section — that was scoped 2026-04-13 and skipped; this is the follow-through.

**Dependencies:** Two-way Google Calendar sync (above) should ship first OR in parallel — the widget is the primary consumer of the sync.

### Consolidate navigation: DealDetails without MeetingDetails
**What:** Experiment with making DealDetails the single meeting-viewing surface, removing MeetingDetails from the navigation flow entirely. Today the UX is: click a meeting in the Launcher → opens MeetingDetails (1:1 per calendar event) → "View Deal" button → DealDetails (cumulative per contact). Kate wants to try: click a meeting → go directly to DealDetails, with that specific meeting auto-selected / scrolled into focus within the Past Meetings (or upcoming) list on the deal page.

**Why:** The Prep and Summary tabs on DealDetails already contain everything MeetingDetails shows for a given meeting, in the context of the whole deal. Navigating through MeetingDetails → DealDetails adds a click and fragments context. Going deal-first matches how Kate thinks about the prospect (contact = deal = story) rather than event-by-event.

**What to test:**
1. Launch flow: clicking a meeting in the Launcher feed opens DealDetails for that contact, auto-tab to Prep (if upcoming) or Past Meetings (if recorded), auto-scroll to that meeting's card
2. Keep MeetingDetails around as a fallback for meetings with no linked `contact_id` (stray personal events, Kate-hosted calls with no prospect match)
3. Move the MeetingDetails in-call chat, live transcript bar, usage view to live-only surfaces rendered INSIDE the deal page context (or keep them in MeetingDetails only for the active in-call state)

**Risk:** DealDetails is busier than MeetingDetails. The Past Meetings tab with 5+ calls + full transcripts could feel heavy compared to a single meeting view. A11y / scroll-position behavior needs thought.

**Dependencies:** Storage unification (1.1) should land first so every past meeting has real data in DealDetails — otherwise collapsing MeetingDetails leaves gaps.

### Nurture planning & scheduling + task manager panel
**What:** New panel (likely a sidebar or a new launcher route) that combines two things Kate needs in her daily sales workflow:
1. **Nurture plan management:** for each active prospect, show the current nurture sequence — scheduled touches (emails, calls, follow-ups), their send dates, status (queued / sent / paused), and the content for each. Kate can edit, pause, reschedule, or approve drafts.
2. **Task manager:** a task queue scoped to her sales workflow — follow up with X, send Y, call Z back, review transcript for A. Integrates with the existing Apple Reminders / Convex goals pipeline on the gobot side OR stands alone with its own store.

**Why together:** Nurture plans and tasks feed each other — a nurture step that needs Kate's personal touch becomes a task; a task completed marks a nurture step done. Rendering them in the same panel keeps both visible at once.

**Overlaps with:** backlog 3.2 (Nurture tab on MeetingDetails) and 4.1 (powerdialer UI). Those are per-meeting or per-list views; this new panel is the persistent cross-prospect view. Likely the nurture tab feeds into this panel's data, and the task manager is a new layer on top.

**Dependencies:** 
- Stage 5 (Natively write-through to Convex) should be live so prep/summary data feeds the nurture recommender
- gobot's existing `nurture-coordinator` agent already exists (per `.claude/agents` in gobot) — this panel would be its UI surface
- HubSpot tasks API integration if we want tasks to sync back to the CRM

### Robust knowledge and coaching docs (sales-specific)
**What:** Build out a comprehensive internal knowledge base tailored to Kate's sales methodology (Scalable Operating System, Ryan Deiss's frameworks, objection handling, qualification rubrics, pricing conversations, buyer-persona profiles for founders in the $2M–$10M revenue band). This is the content layer that powers Natively's coaching — during a live call the model can pull from these docs to deliver relevant suggestions, and post-call it can cite them when critiquing the call.

**Relationship to 1.3:** Backlog item 1.3 covers "reframe the 13 premium module prompts for sales context." This is broader — prompts are the PROCESSING layer; this is the CONTENT layer the prompts read from. Think of 1.3 as "teach the engine to speak sales" and this as "give the engine a playbook to reference."

**What to build:**
- A `knowledge/` or `coaching/` directory structured by topic: qualification, pricing, discovery flow, objection library, next-step patterns, buyer psychology, nurture cadences, post-call playbooks
- Documents in structured formats (markdown with front-matter tags) so the knowledge engine can retrieve them via embeddings / RAG
- Wired into the existing premium `KnowledgeOrchestrator` / `ContextAssembler` modules (see `dist-electron/premium/electron/knowledge/`)
- Versioned in the Natively repo so edits flow through git

**Sources:** Scalable Co.'s internal methodology docs (Kate has access), Ryan Deiss's published frameworks, Kate's own notes from successful deals, post-mortem writeups.

**Dependencies:** 1.3 (premium module prompt reframing) — the prompts need to know how to ask the knowledge base for the right document.

### Live coaching alerts (Pluely-style)
**What:** Real-time in-call coaching alerts that surface during a live Zoom call based on what's happening in the transcript. Modeled on Pluely and similar live-coaching tools — small non-modal notifications that fire as the conversation progresses, suggesting specific moves:
- "They just mentioned budget — ask for the actual number"
- "Three minutes of small talk — time to transition to the qualification questions"
- "They raised a price objection — here's the playbook"
- "You haven't asked about timeline — ask now"
- "Strong buying signal detected: they said 'let's do this.' Move to next-step commitment."
- Silence detection, pace alerts, etc.

**Relationship to existing coaching:** Natively already has the premium `LiveNegotiationAdvisor`, `ObjectionHandler`, `LiveInsightEngine`, `TurnByTurnCoach` modules (see `dist-electron/premium/electron/knowledge/`). These generate suggestions but they're interview-focused today. This item is: (a) reframe them for sales (overlaps with 1.3), (b) surface their output as proactive alerts not just on-demand suggestions, (c) make the alert UX reference-similar to Pluely's visual pattern (small, persistent, non-interrupting).

**Dependencies:**
- 1.3 (reframe premium prompts for sales)
- Robust knowledge/coaching docs (above) — alerts need to reference concrete plays, not just generic advice
- Overlay hydration 1.10 — alerts need the full deal context (prior transcripts, SDR notes, prep dossier) not just the live turn

---

## Phased roadmap (Kate's framing — 2026-04-13)

### Phase 1 — foundation + immediate sales loop

**Goal:** the daily sales workflow works end-to-end. Storage unified, prep + transcripts + summaries flow through Convex, Next Steps actions push to HubSpot.

| # | Item | Status |
|---|---|---|
| 1.1 | **Storage architecture** — Convex as source of truth for all Natively transcripts, preps, summaries, chats. Local SQLite stays as in-call cache. (DECISION LOCKED tonight — see section below.) | Next up |
| 1.2 | **Past-meetings pills** under the Prep/Profile/Summary/etc tab strip. Click → navigate to that prior meeting (trivial once storage is unified). | After 1.1 |
| 1.3 | **Knowledge base revamps** — sales-reframing of the 13 LLM-heavy premium modules currently using interview-coaching prompts. Source: `docs/rebuild-plan/02-premium-modules-architecture.md` | Phase 1 |
| 1.4 | **SDR notes + SDR call transcript** — when a meeting was preceded by an SDR call, surface BOTH the SDR's triage notes (synced from `#sco-sdr-meetings-booked` Slack channel via `slack-triage-sync` cron) AND the SDR's call transcript (already in Convex `call_transcripts` via the Gong / `discovery-transcript-sync` flow) inside that meeting's MeetingDetails. Likely a dedicated "SDR Context" subsection in the Prep tab, or its own collapsible block. Match by contact_id/deal_id linkage in Convex. | ✅ Shipped 2026-04-14 (evening) — `Prior SDR Context` section on MeetingDetails Prep tab + same widget on DealDetails Past Meetings tab, powered by `natively.prepBundleForMeeting` |
| 1.5 | **Company & prospect enrichment** — fill out the prospect profile with deeper data (LinkedIn snapshot, recent news, headcount trends, recent deals). Sources: existing gobot enrichment scripts + Convex. | Phase 1 |
| 1.6 | **Next Steps button + commands** — the structured-output recommendation pipeline from Kate's spec doc, with chat-back corrections that re-output the entire structure preserving order. | Phase 1 |
| 1.7 | **Test HubSpot updates** — actually fire the approved Next Steps actions through to HubSpot (ship the gobot endpoint that PATCHes deals directly, no Notion in the loop). | Phase 1 |
| 1.8 | **"SCO" marker on meetings** — Kate wants this **tomorrow**. Visual indicator on calendar events / meeting list rows that distinguishes Scalable Co. sales meetings from personal/other meetings. Likely a small badge or color tag derived from whether the contact has a HubSpot deal in Convex. | **Tomorrow** |
| 1.9 | **Past calls auto-merged into upcoming/current call's Prep tab** — when Kate opens the Prep tab for an upcoming or in-progress meeting, automatically pull in summaries + transcripts + key signals from ALL prior calls with the same contact (SDR call, prior discovery, prior demo, follow-ups). Renders as a "Previous Conversations" section in the Prep tab — chronological, with each prior call's date / type / summary expandable. Different from past-meetings pills (1.2) which are navigation; this is in-place context aggregation. Both surfaces are powered by the same Convex query once storage is unified. | Phase 1 |
| 1.10 | **Hydrate in-call overlay with prospect context at startMeeting** — today the overlay (`NativelyInterface`) receives only `calendarEventId` + audio device info when a meeting starts. It has zero context during the live call: no prep dossier, no contact/deal info from Convex, no prior transcripts, no SDR notes. All coaching is done on the live transcript alone. Fix: when `startMeeting` IPC fires, bundle up and pass into the overlay: (a) prep dossier JSON, (b) `/natively/meeting-profile` payload (contact + company + deal), (c) prior meetings' summaries + transcripts for the same `contact_id` / `deal_id`, (d) SDR triage notes if present. Store on `SessionTracker.currentMeetingMetadata` so the RAG pipeline, in-call chat overlay (`MeetingChatOverlay`), and AI suggestion generators can all read from it. Depends on: 1.1 (storage unification — so prior transcripts actually exist in Convex) and the Prospect-tab query (the same cumulative bundle powers both). Circle back after 1.1 + Prospect tab are in. | Phase 1 |
| 1.11 | **MeetingDetails chat can reach every tab (not just transcript + summary)** — today the chat input at the bottom of MeetingDetails calls `rag:query-meeting`, which only indexes full transcript + summary overview + key points + action items. It cannot see the Prep dossier, the Profile tab's Convex data (contact/company/deal), or the Usage log. Fallback path (when RAG isn't ready) additionally caps transcript at the last 20 turns. Fix in two stages: (a) quick win — extend `buildContextString()` in `MeetingChatOverlay` to also include the prep dossier + profile payload so fallback-mode chat immediately gets richer context (~20-line change, no RAG pipeline touch); (b) bigger win — once DealDetails lands, re-scope the chat from meeting-scoped to contact-scoped, pulling in prior meetings' transcripts + SDR notes via the same cumulative Convex query. Related to 1.10 (overlay hydration) — they both want the same bundle in different surfaces. | ⚠️ Partial — DealDetails side done 2026-04-14 (evening): floating ask bar + `MeetingChatOverlay` with full deal context (profile + cumulative summary + every past meeting with full transcript + sdr_notes + upcoming prep). Routed through new `claude-chat-oneshot` IPC → `claude -p` via Kate's Max plan (no truncation, no rate limits). **MeetingDetails side still pending** — per Kate's 2026-04-14 rule ("Deepgram live only, Claude Max for everything else") the MeetingDetails chat should also flip to `useClaudeBackend={true}`. One-prop change, infrastructure already shipped. |
| 1.12 | **Remove Notion endpoints once Natively is live** — cleanup item. Once Kate is using DealDetails as her primary surface for meeting review and deal context, and she's confident nothing else in her workflow still depends on Notion meeting pages, delete: (a) `scripts/sync-sdr-notes-to-notion.ts` (Convex→Notion backup), (b) the Notion push in `src/zoom-transcript-sync.ts` `convex.action(api.notionSync.pushToNotion)`, (c) the Notion sub-item creation in `src/discovery-transcript-sync.ts`, (d) `convex/notionSync.ts` entirely if nothing else calls it. Success criterion: gobot can run with `NOTION_TOKEN` unset and the sales pipeline is unaffected. Do NOT touch Notion MCP server (`src/lib/actions/notion-mcp-server.ts`) — Kate still uses Notion for personal knowledge/tasks, this cleanup only targets the sales-meeting writeback paths. | After Natively is live |
| 1.13 | **DealDetails page** — new cumulative-per-contact page that sits alongside MeetingDetails (MeetingDetails stays 1:1 per meeting, untouched). Contact-first: keyed by `contact_id` because the contact IS the deal. Header: `{First} {Last} — {Company}`. Tabs: **Discovery Call \| Demo Call \| Follow Up \| Summary \| Prep \| Profile \| Grade**. Each meeting-type tab shows per-call summary up top + transcript below, with secondary pills if there are multiple calls of that type. Summary tab is a cumulative deal narrative synthesized across all calls. Prep tab shows the dossier for the next upcoming meeting. Profile tab reuses the existing MeetingDetails Profile view. Grade tab is a placeholder for 1.14. Nav entry point: "View Deal" button on MeetingDetails header (only renders when the meeting has a linked `contact_id`). See "DealDetails waterfall" section below for the full build order. | Phase 1 |
| 1.14 | **Deal grading assessment (Grade tab)** — future build. Placeholder tab in the DealDetails page today. Eventually renders a structured scoring rubric for the deal: MEDDIC coverage, urgency, intent, qualification status, stakeholder map, offer state, next-step clarity. Generated by a dedicated scoring prompt that reads the cumulative deal summary + all per-meeting summaries + the prep dossier + the SDR notes and outputs a numerical score (1-10) across each dimension plus a narrative verdict. Stores to a new `deal_grades` table in Convex keyed by `contact_id` with history (one row per regeneration so Kate can see the score move over time). Triggered manually from the tab via a "Regenerate grade" button, and automatically after any new transcript + summary lands for this contact. **Depends on:** 1.13 DealDetails scaffold + Stage 1 summary generation job + Stage 4 cumulative summary. **Model:** Claude Sonnet via local Max plan (same runner as summary jobs). | Phase 1, after 1.13 lands |
| 1.16 | **Meeting outcome classifier (tomato color + manual command)** — per the architectural rule above. Two triggers: (a) Google Calendar color watcher that polls past-scheduled demo meetings, reads `colorId` for each via the Calendar API, detects `colorId === 11` (tomato), compares the event's `updated` timestamp against `start_time` to classify as cancelled (tomato set before start) vs no-show (tomato set at/after start), writes to `meetings.call_outcome` with values `cancelled` / `no_show` and `outcome_set_at` + `outcome_source="tomato"`; (b) manual command path via gobot/natively chat — user says "mark [prospect] as no-show" / "cancel [prospect]," bot resolves by name → finds the most recent demo meeting → writes outcome with `outcome_source="manual"`. New schema fields on `meetings`: `call_outcome` (already exists — repurpose), `outcome_set_at` (new), `outcome_source` (new). New launchd job `com.go.outcome-classifier` runs every 15 min, scoped to demos with `start_time >= 7 days ago AND call_outcome IS NULL`. Idempotent — re-running never rewrites a set outcome unless the source changes. Blocks backlog 1.14 (Grade tab) which reads outcome data, and improves the DealDetails tab copy from "outcome unknown" to a real label. | Phase 1, after 1.13 DealDetails scaffold lands |
| 1.15 | **Ratchet existing Convex tables into HubSpot-ID compliance** — per the canonical linkage rule, every sales-related table must denormalize `hubspot_contact_id`. The Stage 0 additions (`sdr_notes`, `natively_*`) are compliant. The legacy tables (`meetings`, `call_transcripts`, `deals`) are not — they only carry Convex `_id` FKs. Plan: (a) add optional `hubspot_contact_id` field + `by_hubspot_contact` index to each, (b) update every writer (`zoom-transcript-sync`, `discovery-transcript-sync`, `convex/http.ts` sheet-sync handler, HubSpot deal sync webhook, meeting outcome flows) to resolve + pass through HubSpot ID on write, (c) run a one-time backfill mutation that walks existing rows, looks up contact via `contact_id`, patches in `hubspot_contact_id`. No breaking changes to reads — old consumers that use Convex `_id` keep working; new consumers that want stable cross-system linkage use the new index. Do this BEFORE writing the DealDetails backend query (Stage 1 of 1.13) since that query will benefit from querying by HubSpot ID for stability. | Phase 1, before 1.13 Stage 1 |

### Phase 2 — meeting lifecycle popups + task blocks

**Goal:** Notion Calendar–style automation for joining, starting, and transcribing meetings, plus block-based prompts for non-meeting work.

| # | Item | Status |
|---|---|---|
| 2.1 | **Pre-meeting auto-join popup** (T-2 minutes). One-click opens Zoom + starts Natively coaching overlay. Same as the existing "Pre-meeting auto-join popup" detail section below. | Phase 2 |
| 2.2 | **Powerdialing blocks** — Kate can schedule a block of time for cold-calling. When the block fires, a popup appears prompting her to start the dialing session. | Phase 2 |
| 2.3 | **Task blocks** — Kate can schedule reminder blocks for non-meeting tasks. Popup fires at the scheduled time to prompt the action. | Phase 2 |

### Phase 3 — bigger UI features + nurture loop

**Goal:** Calendar becomes interactive; nurture planning becomes a first-class tab.

| # | Item | Status |
|---|---|---|
| 3.1 | **Calendar widget** with right-click color change (Blueberry / Lavender / Tomato / Tangerine) and visibility into cancellations / RSVP changes. Two-way write helpers already wired tonight in `CalendarManager.updateEventColor` — just needs UI. | Phase 3 |
| 3.2 | **Nurture tab on MeetingDetails** — fifth (or new) tab. Outputs a recommended nurture plan from the meeting transcript + dossier + intel. Kate can chat with it (existing chat feature at the bottom of the page) to refine. On approval, sends to a nurture-planner sub-agent (likely the existing gobot `nurture-coordinator`). The tab then shows a live feed of the plan: scheduled send dates, content, status (queued / sent / paused if prospect responds). | Phase 3 |

### Phase 4 — bigger surface area: pipeline, powerdialer, bulk chat, larger calendar

**Goal:** Natively becomes the daily command center, not just an in-call tool.

| # | Item | Status |
|---|---|---|
| 4.1 | **Manual nurture cadence + powerdialer UI** — when Kate needs to call a list of prospects, render them in a powerdialer format (dial → log → next prospect). | Phase 4 |
| 4.2 | **Chat with AI about a bulk of meetings** — select multiple past meetings, ask the AI questions across all of them ("which prospects mentioned cash flow concerns last month?"). | Phase 4 |
| 4.3 | **Sales pipeline view** in the Launcher — Kanban-style by deal stage, sourced from Convex deals. Mirrors `plugin-pipeline-manager` in `client-scalable/plugins/`. | Phase 4 |
| 4.4 | **Larger calendar view** — a full calendar surface (week / month) larger than the top hero widget. Probably a new Launcher route. | Phase 4 |
| 4.5 | **macOS menu bar dropdown** with upcoming meetings (Notion Calendar style) — moved here from earlier "parked" section. | Phase 4 |

### Side note — verify before building

- **Cross-meeting search.** Kate says she might already have this via the search bar at the top of the Launcher. Verify before scoping a new feature. The current Launcher header has a search input but I haven't traced whether it's wired to anything beyond meeting titles.

---

## DealDetails waterfall — ordered build plan (2026-04-14)

This is the ordered sequence to ship DealDetails (backlog 1.13). Each stage has an explicit test gate. Do NOT start the next stage until the previous one is verified by Kate.

### Dependency graph
```
Stage 0: Foundational plumbing (this session)
  ├─ Convex schema: new Natively-private tables (natively_*) + sdr_notes table
  ├─ Convex module: sdrNotes.ts (mutations/queries)
  ├─ Slack triage sync flip: Slack → Convex primary, Notion secondary
  └─ New script: scripts/sync-sdr-notes-to-notion.ts (Convex → Notion backup)
        ↓
Stage 1: Backend data layer for DealDetails
  ├─ Convex query: dealDetailsByContactId(contact_id) — unions Natively-private + shared pool
  ├─ Convex HTTP endpoint: GET /natively/deal-details?contact_id=
  ├─ meetings.summary_markdown field (for per-meeting summaries)
  └─ Summary generation job on Mac via launchd + Claude Max subprocess
        ↓
Stage 2: DealDetails scaffold + navigation (Natively side)
        ↓
Stage 3: Wire the tabs one at a time (Profile → Prep → Discovery → Demo → FollowUp)
        ↓
Stage 4: Cumulative Summary tab (Claude Sonnet via Max, synthesizes per-meeting summaries) [done]
        ↓
Stage 5: Storage unification (backlog 1.1) — Natively write-through to natively_* tables
        ↓
Stage 6: Grade tab (backlog 1.14) — deal grading assessment
```

Stages 0-4 can all ship without waiting for 1.1. Zoom + Gong transcripts already flow into the shared pool, so DealDetails can be meaningfully populated today. Natively-recorded calls light up automatically once Stage 5 lands.

---

### Stage 0 — Foundational plumbing (in progress)

**Build:**
1. Add new tables to `convex/schema.ts`:
   - `natively_transcripts` — keyed by `contact_id`; fields: `meeting_id?`, `calendar_event_id`, `segments`, `transcript`, `duration_seconds`, `source="natively"`, timestamps
   - `natively_summaries` — keyed by `contact_id`; fields: `meeting_id?`, `calendar_event_id?`, `summary_type` ("per_meeting" | "cumulative_deal"), `summary_markdown`, `generated_from`, timestamps
   - `natively_preps` — keyed by `contact_id`; fields: `meeting_id?`, `calendar_event_id`, `dossier` (any), timestamps
   - `natively_notes` — keyed by `contact_id`; fields: `notes_markdown`, `updated_at`
   - `sdr_notes` — keyed by `contact_id`; fields: `prospect_name`, `company_name`, `full_note`, `slack_ts`, `notion_synced_at?`, `source="slack"`, timestamps
2. New Convex module `convex/sdrNotes.ts` with `saveSdrNote` mutation (upsert by `slack_ts`), `getByContact` query, `listPendingNotionSync` query
3. Update `src/slack-triage-sync.ts` to call `convex.mutation(api.sdrNotes.saveSdrNote, ...)` before the existing Notion write. Keep the Notion write for now (zero-downtime transition)
4. Create `scripts/sync-sdr-notes-to-notion.ts` — reads `listPendingNotionSync`, pushes to Notion, marks synced
5. Deploy Convex via `bunx convex dev --once`
6. Test: verify a known SDR note writes to Convex, then verify the new Notion sync script picks it up

**Test gate:** Manually invoke `bun run src/slack-triage-sync.ts`. Check Convex dashboard — see new rows in `sdr_notes`. Run new Convex→Notion script. Check Notion — see the same note appear. **Kate verifies both surfaces.**

**Effort:** 2-3 hours (includes schema + two scripts + test).

### Stage 1 — Backend data layer for DealDetails
**Build:**
1. Add `meetings.summary_markdown` field to schema (nullable string)
2. New Convex query in `convex/meetingsFns.ts` (or new `convex/dealDetailsFns.ts`): `dealDetailsByContactId(contact_id)`. Returns:
   ```
   {
     contact, company, deal,
     meetings_by_type: {
       discovery: [{meeting, transcript, summary}],
       demo: [{...}],
       followup: [{...}],
       sdr_triage: [{...}],  // SDR discovery calls from Gong
     },
     upcoming_meeting: {meeting, prep_dossier},
     sdr_notes: [...],
     prospect_notes: {notes_markdown}  // from natively_notes
   }
   ```
   Internal logic: for each meeting-type group, union Natively-private transcripts/summaries (from `natively_*` tables) with shared-pool transcripts/summaries (from `call_transcripts` joined via `meeting_id`), Natively wins on dedup by `calendar_event_id`.
3. HTTP wrapper in `convex/http.ts`: `GET /natively/deal-details?contact_id=...`
4. New bun script `scripts/generate-meeting-summaries.ts` — finds meetings with transcripts but no `summary_markdown`, calls `claude -p` subprocess against Max plan, writes summary back. Also fills `natively_summaries` rows for Natively-captured calls that lack summaries.
5. New launchd plist `com.go.summary-gen.plist` — runs every 15 min, `StartCalendarInterval`
6. Make sure script ends with `process.exit(0)` (Convex WebSocket keep-alive gotcha)

**Test gate:** Curl the endpoint for a known prospect — verify grouped structure. Run summary gen script on a known transcript — verify summary appears in Convex. Install launchd job, verify it fires on schedule.

**Effort:** 3-4 hours.

### Stage 2 — DealDetails scaffold + navigation entry
**Build:**
1. New component `src/components/DealDetails.tsx`. Structural duplicate of `MeetingDetails.tsx`. Tabs: Discovery Call · Demo Call · Follow Up · Summary · Prep · Profile · Grade
2. Header: `{contact.first_name} {contact.last_name} — {company.name}` from endpoint
3. `Launcher.tsx` state: add `selectedDealContactId: Id<"contacts"> | null`. Non-null → render `<DealDetails contactId={selectedDealContactId} />` instead of MeetingDetails
4. New IPC `convex-get-deal-details(contact_id)` → hits the Stage 1 endpoint
5. Nav entry point: "View Deal" button in MeetingDetails header. Only renders when `profile.meeting.contact_id` is non-null. Clicking sets `selectedDealContactId` via callback prop, unmounts MeetingDetails, mounts DealDetails

**Test gate:** Click a meeting with a linked contact → "View Deal" → DealDetails opens with the correct header. All tabs render empty states. Back button returns to meeting list. **Navigation verified before touching tab content.**

**Effort:** 1-1.5 hours.

### Stage 3 — Wire the tabs one at a time

**3a. Profile tab** — import existing ProfileView, pass `{ contact, company, deal }`. Test: visually identical to MeetingDetails Profile tab. *(~15 min)*

**3b. Prep tab** — render `upcoming_meeting.prep_dossier` via existing `DossierView`. Empty state "No upcoming meeting with this prospect" when null. *(~30 min)*

**3c. Discovery Call tab + Demo Call tab + Follow Up tab** (identical structure, build once, parametrize by `meeting_type`):
- If zero meetings of this type: empty state "No {type} calls yet for this prospect"
- If one meeting: single block with summary top, transcript bottom, "Open meeting →" link in corner
- If multiple: secondary pill row at top ("Call 1 · Call 2 · Call 3", oldest left) that switches between them; same block below
- Summary section reads `summary_markdown`; placeholder "Summary generating…" if null (Stage 1 job will fill it within 15 min)
- Transcript section reads the transcript field, monospace, scrollable

**Test each meeting-type tab on a real prospect with real data before moving to the next.** *(~2 hours total)*

**Effort:** 2.5-3 hours total.

### Stage 4 — Cumulative Summary tab

> ✅ SHIPPED 2026-04-14 — gobot commits b845aa9, dd31314, cf40716 · natively commit 81988ab

**Build:**
1. New script `scripts/generate-deal-summary.ts` — takes a `contact_id`, reads all `summary_markdown` rows + `natively_summaries` rows + deal metadata, sends to Claude Sonnet via `claude -p`, writes to a new row in `natively_summaries` with `summary_type="cumulative_deal"`
2. Separate launchd job `com.go.deal-summary-gen` (StartInterval: 1800) — runs every 30 min, iterates all eligible contacts
3. New `convex/nativelySummariesFns.ts` — `insertCumulativeSummary` mutation + `contactsWithSufficientSummaries` query
4. `convex/dealDetails.ts` extended to return `cumulative_summary` (full doc, most recent by `_creationTime desc`)
5. Summary tab on DealDetails renders narrative via ReactMarkdown + meta line (generated-at + model)

**Test gate:** Ran generator on Michael Koonce (2 calls) — produced 3296-char narrative. `tsc --noEmit` clean, `npm run build` succeeded.

**Effort:** ~2 hours.

### Stage 5 — Storage unification (backlog 1.1)
Separate session. When this lands, Natively's local saves write through to the `natively_*` tables. DealDetails automatically shows Natively-recorded calls with richer data.

**Historical backfill decision (pending from Kate):** do we also backfill old local-only Natively meetings from SQLite → Convex as a one-time script during Stage 5, or leave pre-Stage-5 Natively history invisible?

### Stage 6 — Grade tab (backlog 1.14)
Separate session. Real build is the deal grading assessment — rubric + scoring prompt + `deal_grades` table + tab UI.

---

## Top of next session — DECISION LOCKED, time to build

### Storage architecture: Convex is the durable source of truth for ALL Natively data

**Kate's call (2026-04-13):** "we save everything in convex, makes it safer and simpler." Locked. No further debate. Resume next session by starting this build.

**What this means concretely:**
- Natively transcripts, summaries, dossiers (preps), call chats, usage records — all written to Convex on save
- Local SQLite stays as a fast in-call cache, but is no longer authoritative
- Zoom transcripts continue to feed Convex via the existing path; Natively writes alongside via new endpoints, distinguished by a `source` field
- Cross-tool consistency: Paperclip plugins and Natively read from the same Convex tables
- This is the foundation under everything else (Next Steps actions extraction, past-meetings pills, nurture plans). Build this BEFORE Next Steps actions.

**Proposed architecture:**
1. **Schema migration** in `convex/schema.ts`:
   - `call_transcripts.source` field (`"zoom" | "natively" | "gong" | "manual"`)
   - `meetings.source` field already exists — confirm values
   - `meeting_prep.source` field for dossier provenance
2. **New Convex HTTP endpoints** (mirror existing `/sheet-sync` + `/natively/meeting-profile` patterns, CORS open):
   - `POST /natively/upsert-transcript` — body `{ calendar_event_id, segments[], summary, usage }`. Looks up meeting by calendar_event_id, upserts transcript record with source=natively.
   - `POST /natively/upsert-prep` — body `{ calendar_event_id, dossier }`. Upserts to `meeting_prep` with source=natively.
   - `GET /natively/transcripts?calendar_event_id=` — returns all transcripts (zoom + natively) for a meeting, sorted by created_at.
3. **Natively writes through to Convex** in `DatabaseManager.ts` — every local save also fires the corresponding Convex upsert IPC (fire-and-forget background write so the UI never blocks).
4. **Natively reads from Convex** — the Transcript tab on `MeetingDetails.tsx` queries the new GET endpoint instead of (or in addition to) the local SQLite. If a Zoom transcript exists in Convex but Natively didn't record locally, it still shows.
5. **Prep file → Convex sync** — the existing `~/Library/Application Support/natively/prep/<event_id>.json` flow stays as the fast local path, but each loaded dossier ALSO upserts to Convex `meeting_prep`. Other tools (Paperclip plugins) can then read the same dossier.

**Why this is the right call:** Eliminates the divergence between "Natively local DB" and "Convex" as separate worlds. Future features (Next Steps actions extraction running on gobot side, cross-tool consistency between Paperclip plugins and Natively, cloud backup) all depend on Convex having complete data. It's the foundation under everything else we want to build.

**Estimated effort:** ~3–4 hours. Schema + HTTP routes (~1h), Natively write-through (~1h), read paths (~1h), testing + edge cases (~30m).

**Decision needed from Kate next session:** ship this BEFORE Next Steps actions (foundation-first), or AFTER (so you have one working extraction loop before refactoring storage)? My rec: BEFORE.

---

### Past-meetings pills on MeetingDetails (sequenced after storage decision)

**What Kate asked for (2026-04-13):** On the MeetingDetails page, show a pills row for prior calls with the same contact. Pills labeled by call type — "SDR Call" / "Discovery Call" / "Demo Call" / "Follow Up Call". Click behavior:
- If the prior meeting already exists in Natively → navigate to its MeetingDetails page
- If it's in Convex but not in Natively → fetch the transcript from Convex (`call_transcripts` table) and display it inline. Optionally run a summary on it.

**Reference**: gobot's `src/discovery-transcript-sync.ts` + Convex `transcript_lookups` table. That flow searches Google Drive's Gong folder for matching transcripts when a new meeting is booked. Same idea, different source — for Natively pills, the data is already in Convex (no Drive search needed).

**Why this is sequenced after the storage architecture decision**: once Natively reads from Convex (per the storage decision above), the pills feature becomes trivial — just "list prior meetings for this contact_id" + "click → navigate." No import step, no special-case "fetch transcript and display" path. If we build it before the storage refactor, we throw half of it away.

**Build steps (after storage architecture is settled):**
1. **New Convex query** in `convex/meetingsFns.ts`: `byContactExcept({ contact_id, exclude_meeting_id, limit })` — returns prior meetings for a contact, sorted by `start_time` desc, excluding the current one.
2. **HTTP wrapper** in `convex/http.ts`: `GET /natively/contact-meetings?contact_id=&exclude=` — returns the same array.
3. **Extend `/natively/meeting-profile`** to ALSO return `prior_meetings: [{ id, calendar_event_id, meeting_type, start_time, has_transcript }]` so a single call powers the whole tab.
4. **Natively MeetingDetails**: render a pills row **directly below the tab strip** (Prep / Profile / Summary / Transcript / Usage), aligned top-left of the active tab's content area. Pills are a sub-header that's persistent across all tabs so they always provide navigation context. Pill content: pretty call type label (SDR Call / Discovery Call / Demo Call / Follow Up Call) + month/day in small text. Pill style: same theme as the existing call-type pill we just added in the header.
5. **Click handler**: navigate to the prior meeting's MeetingDetails page using the same `selectedMeeting` state + handleOpenMeeting flow. Once Natively reads from Convex, every meeting (local or remote) renders through the same path.
6. **Empty state**: if the contact has no prior meetings, just don't render the pills row.

**Estimated effort (after storage is unified):** ~30–45 min. Without the storage refactor, it's ~2–3 hours including a special-case "import-and-display" path that we'll throw away.

---

## Last session state — 2026-04-13 (resume here)

### What's currently live in the running Natively
- ✅ Calendar fetch range: 24h → **2 business days** (today + next business day, skips weekends)
- ✅ Calendar events now carry: title, description, attendees (email/name/responseStatus), colorId, colorHex, location, link, source
- ✅ `GCAL_COLOR_MAP` (all 11 Google Calendar color hex values) in `electron/services/CalendarManager.ts`
- ✅ Event filter: only future events with a meeting link (Zoom / Meet / Teams / Webex) show in the Launcher feed; personal events without a join link are filtered out
- ✅ `resolveMeetingLink` checks hangoutLink → location → description (catches Zoom links in the location field)
- ✅ 2-way write helpers: `updateEvent(eventId, partial)` + `updateEventColor(eventId, colorId)` — wired to IPC + preload + types but no UI consumes them yet
- ✅ Meeting list grouping: **Today / Tomorrow / Past**. Tomorrow = next business day (Friday's Tomorrow = Monday). Past = yesterday + everything older lumped.
- ✅ **Profile tab** on MeetingDetails. Shows: First Name, Last Name, Email, Phone, Company, Location, SDR Owner, Deal Stage (display label), HubSpot Contact + Deal URL buttons that open in browser
- ✅ `src/lib/hubspot-mapping.ts` util — mirrors gobot's `hubspot-config.ts`. `DEAL_STAGE_MAP`, `getDealStageLabel(internal)`, `hubspotContactUrl(id)`, `hubspotDealUrl(id)`, `HUBSPOT_PORTAL_ID = "21182745"`
- ✅ Convex HTTP route `GET /natively/meeting-profile?calendar_event_id=` deployed live to opulent-bandicoot-376. Returns the meeting + joined contact + company + deal blob
- ✅ `convex-get-meeting-profile` IPC + `convexGetMeetingProfile` preload + types — calls the live Convex endpoint

### Pending — pick up here next session

#### 1. MeetingDetails header — start time → end time + pretty call type pill
**What Kate asked for (last message of session):** the date is already at the top of the meeting details page. Add the start time → end time alongside the date, AND a small pill showing the "pretty call type" (Discovery Call / Demo Call / Follow Up Call / Game Planning).

**Where the data comes from:**
- The Convex `meetings` table stores `meeting_type` as the lowercased internal slug (`discovery`, `demo`, `followup`, `game_planning`) — see `convex/http.ts` `CALL_TYPE_MAP`.
- The "pretty" version is the inverse mapping: `discovery → Discovery Call`, `demo → Demo Call`, `followup → Follow Up Call`, `game_planning → Game Planning`.

**Build steps:**
1. Update `convex/http.ts` `/natively/meeting-profile` handler to include `meeting_type` in the returned `meeting` object. Redeploy with `bunx convex dev --once`.
2. Update `electron/preload.ts` + `src/types/electron.d.ts` to include `meeting_type` in the `convexGetMeetingProfile` return type.
3. Add a `CALL_TYPE_PRETTY` map in `src/lib/hubspot-mapping.ts` (or new util): `{ discovery: "Discovery Call", demo: "Demo Call", followup: "Follow Up Call", game_planning: "Game Planning" }`.
4. In `MeetingDetails.tsx` header (around line 273-277, the existing date `<div>`), extend the layout to render: `[Date] · [Start–End time range] [Call Type pill]`. The pill is a small rounded element with the pretty label.
5. Pull the pill data from the loaded `profile.meeting.meeting_type` (the new field). Time range from `profile.meeting.start_time` and `profile.meeting.end_time`, formatted with `toLocaleTimeString({ hour: 'numeric', minute: '2-digit' })`. Fall back to the existing `meeting.date` parsing if `profile` hasn't loaded yet.
6. Build (`npm run build && npm run build:electron`), pack, swap.

**Why this isn't done yet:** Kate said "save session" before I could ship it. Edits not started.

---

## In progress (still — next major task)

### Next Steps actions (HubSpot updates + meeting booking + correction loop)
**Status:** Architecture mostly designed. Kate provided full output schema (the markdown spec doc with 11 recommendation fields, decision tiers, Universal Rules, Property-by-Property Guide). Path forward is **NOT Notion** — Kate explicitly said don't interact with Notion. Direct path: extract structured recommendations from transcript on gobot side, push approved actions to HubSpot via gobot's existing tools.

**The HubSpot Deal ID source is now confirmed:** the Profile tab's Convex lookup returns `deal.hubspot_deal_id` for any sales meeting. So Next Steps actions can read the deal ID from the same Convex query that powers the Profile tab.

**Open architecture decisions for next session:**
1. Where does the extraction run — Natively side (renderer with Anthropic SDK) or gobot side (new HTTP endpoint that takes the transcript and returns the structured analysis)?
2. Tier-based model routing per Kate's spec — Haiku for facts, Sonnet for narrative, Opus for strategic. Implement now or punt to v2?
3. New gobot endpoint to PATCH HubSpot deals directly (skip the Notion path that the existing `/webhook/notion-deal-approval` uses)
4. Meeting booking — wrap gobot's existing `schedule_meeting` tool from `anthropic-processor.ts` in a new HTTP endpoint that Natively can POST to

**Spec source of truth:** Kate's markdown spec with the 12 recommended properties, decision rules, processing tiers, universal rules. Last shared in the 2026-04-13 conversation (search for "Recommended HubSpot Updated, Scheduling & Actions").

---

## Parked — to do AFTER Next Steps actions

### 1. Pre-meeting auto-join popup (T-2 minutes)
**What:** Two minutes before a calendar meeting starts, show a popup (like Notion Calendar's blue "Join and transcribe" button) that one-click does both:
1. Opens the meeting's Zoom link in the user's browser/Zoom client
2. Starts the Natively coaching overlay (same as `Start now` in the current spotlight)

**Why:** Removes the two manual steps Kate currently does — she has to remember to open Zoom AND remember to start Natively. One click handles both.

**Where it lives:**
- Trigger: timer in main process based on `upcomingEvents` data (already fetched). Fire 2 minutes before any event with a meeting link.
- UI: macOS-native notification OR a transient floating Electron BrowserWindow (similar to ScriptHelperWindowHelper pattern). Probably the floating window — gives us full control over the click target and the visual.
- Action: clicking the join button calls `shell.openExternal(zoomLink)` AND fires the existing `startMeeting` IPC.

**Reference:** Notion Calendar's blue "Join and transcribe" pill on event hover.

---

### 2. macOS menu bar upcoming-meetings dropdown
**What:** A menu bar icon (like Notion Calendar's) that, when clicked, drops down a list of upcoming meetings grouped by day:
- Today (with "Upcoming in Xh Ym" header)
- Tomorrow
- This week (Wed/Thu/Fri)
- Each event row shows: time, title, "Join Zoom meeting" link, optional second link
- Settings, Quit at the bottom

**Why:** Kate wants to glance at her schedule from the menu bar without opening the full Natively launcher.

**Where it lives:**
- Electron `Tray` API (Natively already creates a tray — see `appState.tray` in `main.ts`, currently a context menu). Need to either replace that menu's contents or add a new menu structure.
- `Menu.buildFromTemplate()` for the dropdown items.
- Hook into the existing `upcomingEvents` data from `CalendarManager`. Refresh on tray open.
- Each event item's click handler: `shell.openExternal(zoomLink)` for the join action, OR open the Natively launcher to that meeting's prep panel.

**Reference:** Notion Calendar's macOS menu bar dropdown, screenshot saved 2026-04-13 in conversation.

---

## Larger items not yet started

### "Next 3 working days" calendar view in Launcher hero
- Replaces current UP NEXT spotlight + Calendar linked card with a Google-Calendar-style 3-column day view
- Events render in their actual Google Calendar colors (already extracted into `colorHex` field — wired and ready)
- Right-click → choose from Blueberry / Lavender / Tomato / Tangerine
- Two-way sync for color via PATCH to `/calendars/primary/events/{eventId}` — **already wired** as `calendarUpdateEventColor` IPC. Just needs UI.
- Left-click → opens meeting detail page (existing flow)
- Scoped 2026-04-13. Skipped for now per Kate's decision.

### Knowledge engine customization (sales reframing)
- The 13 LLM-heavy premium modules (ContextAssembler, IntentClassifier, MockInterviewGenerator, NegotiationEngine, etc.) currently use interview-coaching prompts
- Need to reframe each prompt for sales coaching context
- See `docs/rebuild-plan/02-premium-modules-architecture.md` for the full module list and which prompts need rewriting
- Kate listed this as the second priority after Next Steps actions

### Nurture plan recommendations (deeper post-call processing)
- After a call, run a deeper analysis pass that recommends a nurture sequence
- Hand off the recommended plan to a sub-agent (likely the existing `nurture-coordinator` agent on the gobot side)
- Lower priority — comes after HubSpot updates + meeting booking are working

---

## Reference notes

- **Convex live deployment:** `opulent-bandicoot-376` (set as `CONVEX_URL=https://opulent-bandicoot-376.convex.cloud` in `~/gobot/.env`). The "prod" deployment `determined-chinchilla-655` is unused — DO NOT push there.
- **Convex deploy command for Natively-related changes:** `cd ~/gobot && bunx convex dev --once` (NOT `bunx convex deploy`, which targets prod).
- **HubSpot portal id for Kate's account:** `24045483` (verified via BCC address `24045483@bcc.hubspot.com`). Used for ALL `app.hubspot.com` URLs — contacts, deals, companies, workflows. The older `21182745` value in earlier versions of this doc and in `src/lib/hubspot-mapping.ts` was wrong and was fixed in commit `f88f2df` / natively SESSION_HANDOFF 2026-04-14. The canonical helpers are `hubspotContactUrl()`, `hubspotDealUrl()`, `hubspotCompanyUrl()` in `src/lib/hubspot-mapping.ts` — never hardcode.
- **HubSpot deal stage map source of truth:** `gobot/src/lib/sales/hubspot-config.ts` `DEAL_STAGE_MAP`. Mirrored in `natively/src/lib/hubspot-mapping.ts`.
- **Smart Calendar Paperclip plugin** (read-only reference): `/Users/jamesleylane/client-scalable/plugins/plugin-smart-calendar/`. Has `data-layer.ts` + `shared-types.ts` with the same patterns Natively uses now. Don't re-extract — Natively has its own implementation.
- **Live Call Companion plugin** (read-only reference): `/Users/jamesleylane/client-scalable/plugins/plugin-live-call-companion/`. Scaffold only — not built out. The transcript-extraction pipeline for Next Steps actions has to be built fresh in Natively.
- **Rebuild & swap workflow for Natively:** invoke the `natively-rebuild` skill or follow `~/gobot/.claude/skills/natively-rebuild.md`. Critical flag: `--unpack "*.{node,dylib}"` (NOT `--unpack-dir` with brace expansion).
