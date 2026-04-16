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

---

## Phased roadmap (Kate's framing — 2026-04-13)

### Phase 1 — foundation + immediate sales loop

**Goal:** the daily sales workflow works end-to-end. Storage unified, prep + transcripts + summaries flow through Convex, Next Steps actions push to HubSpot.

**TOP PRIORITY:**

| # | Item | Status |
|---|------|--------|
| 1.20 | **Auto-stop Natively when Zoom call ends** — detect when the Zoom meeting ends (process exits, audio stops, or Zoom window closes) and automatically stop the Natively recording session so Kate doesn't have to click End Meeting manually every time. | Priority |
| 1.21 | **RSVP status + calendar color on meeting feed** — the calendar icon on each meeting row in the Launcher feed should reflect the prospect's RSVP status: green calendar if accepted, red alert triangle if declined, black/grey calendar if unconfirmed/needsAction/tentative. Also show the current Google Calendar color of the event (blueberry, lavender, tomato, etc.) as a small color dot or border. Data already available: `event.attendees[].responseStatus` and `event.colorId`/`colorHex` from CalendarManager. | Priority |

| # | Item | Status |
|---|---|---|
| 1.1 | **Storage architecture** — Convex as source of truth for all Natively transcripts, preps, summaries, chats. Local SQLite stays as in-call cache. (DECISION LOCKED tonight — see section below.) | Next up |
| 1.2 | **Past-meetings pills** under the Prep/Profile/Summary/etc tab strip. Click → navigate to that prior meeting (trivial once storage is unified). | After 1.1 |
| 1.3 | **Knowledge base revamps** — sales-reframing of the 13 LLM-heavy premium modules currently using interview-coaching prompts. Source: `docs/rebuild-plan/02-premium-modules-architecture.md` | Phase 1 |
| 1.4 | **SDR notes + SDR call transcript** — when a meeting was preceded by an SDR call, surface BOTH the SDR's triage notes (synced from `#sco-sdr-meetings-booked` Slack channel via `slack-triage-sync` cron) AND the SDR's call transcript (already in Convex `call_transcripts` via the Gong / `discovery-transcript-sync` flow) inside that meeting's MeetingDetails. Likely a dedicated "SDR Context" subsection in the Prep tab, or its own collapsible block. Match by contact_id/deal_id linkage in Convex. | Phase 1 |
| 1.5 | **Company & prospect enrichment** — fill out the prospect profile with deeper data (LinkedIn snapshot, recent news, headcount trends, recent deals). Sources: existing gobot enrichment scripts + Convex. | Phase 1 |
| 1.6 | **Next Steps button + commands** — the structured-output recommendation pipeline from Kate's spec doc, with chat-back corrections that re-output the entire structure preserving order. | Phase 1 |
| 1.7 | **Test HubSpot updates** — actually fire the approved Next Steps actions through to HubSpot (ship the gobot endpoint that PATCHes deals directly, no Notion in the loop). | Phase 1 |
| 1.8 | **"SCO" marker on meetings** — Kate wants this **tomorrow**. Visual indicator on calendar events / meeting list rows that distinguishes Scalable Co. sales meetings from personal/other meetings. Likely a small badge or color tag derived from whether the contact has a HubSpot deal in Convex. | **Tomorrow** |
| 1.9 | **Past calls auto-merged into upcoming/current call's Prep tab** — when Kate opens the Prep tab for an upcoming or in-progress meeting, automatically pull in summaries + transcripts + key signals from ALL prior calls with the same contact (SDR call, prior discovery, prior demo, follow-ups). Renders as a "Previous Conversations" section in the Prep tab — chronological, with each prior call's date / type / summary expandable. Different from past-meetings pills (1.2) which are navigation; this is in-place context aggregation. Both surfaces are powered by the same Convex query once storage is unified. | Phase 1 |
| 1.10 | **Hydrate in-call overlay with prospect context at startMeeting** — today the overlay (`NativelyInterface`) receives only `calendarEventId` + audio device info when a meeting starts. It has zero context during the live call: no prep dossier, no contact/deal info from Convex, no prior transcripts, no SDR notes. All coaching is done on the live transcript alone. Fix: when `startMeeting` IPC fires, bundle up and pass into the overlay: (a) prep dossier JSON, (b) `/natively/meeting-profile` payload (contact + company + deal), (c) prior meetings' summaries + transcripts for the same `contact_id` / `deal_id`, (d) SDR triage notes if present. Store on `SessionTracker.currentMeetingMetadata` so the RAG pipeline, in-call chat overlay (`MeetingChatOverlay`), and AI suggestion generators can all read from it. Depends on: 1.1 (storage unification — so prior transcripts actually exist in Convex) and the Prospect-tab query (the same cumulative bundle powers both). Circle back after 1.1 + Prospect tab are in. | Phase 1 |
| 1.11 | **MeetingDetails chat can reach every tab (not just transcript + summary)** — today the chat input at the bottom of MeetingDetails calls `rag:query-meeting`, which only indexes full transcript + summary overview + key points + action items. It cannot see the Prep dossier, the Profile tab's Convex data (contact/company/deal), or the Usage log. Fallback path (when RAG isn't ready) additionally caps transcript at the last 20 turns. Fix in two stages: (a) quick win — extend `buildContextString()` in `MeetingChatOverlay` to also include the prep dossier + profile payload so fallback-mode chat immediately gets richer context (~20-line change, no RAG pipeline touch); (b) bigger win — once DealDetails lands, re-scope the chat from meeting-scoped to contact-scoped, pulling in prior meetings' transcripts + SDR notes via the same cumulative Convex query. Related to 1.10 (overlay hydration) — they both want the same bundle in different surfaces. | Phase 1 |
| 1.12 | **Remove Notion endpoints once Natively is live** — cleanup item. Once Kate is using DealDetails as her primary surface for meeting review and deal context, and she's confident nothing else in her workflow still depends on Notion meeting pages, delete: (a) `scripts/sync-sdr-notes-to-notion.ts` (Convex→Notion backup), (b) the Notion push in `src/zoom-transcript-sync.ts` `convex.action(api.notionSync.pushToNotion)`, (c) the Notion sub-item creation in `src/discovery-transcript-sync.ts`, (d) `convex/notionSync.ts` entirely if nothing else calls it. Success criterion: gobot can run with `NOTION_TOKEN` unset and the sales pipeline is unaffected. Do NOT touch Notion MCP server (`src/lib/actions/notion-mcp-server.ts`) — Kate still uses Notion for personal knowledge/tasks, this cleanup only targets the sales-meeting writeback paths. | After Natively is live |
| 1.13 | **DealDetails page** — new cumulative-per-contact page that sits alongside MeetingDetails (MeetingDetails stays 1:1 per meeting, untouched). Contact-first: keyed by `contact_id` because the contact IS the deal. Header: `{First} {Last} — {Company}`. Tabs: **Discovery Call \| Demo Call \| Follow Up \| Summary \| Prep \| Profile \| Grade**. Each meeting-type tab shows per-call summary up top + transcript below, with secondary pills if there are multiple calls of that type. Summary tab is a cumulative deal narrative synthesized across all calls. Prep tab shows the dossier for the next upcoming meeting. Profile tab reuses the existing MeetingDetails Profile view. Grade tab is a placeholder for 1.14. Nav entry point: "View Deal" button on MeetingDetails header (only renders when the meeting has a linked `contact_id`). See "DealDetails waterfall" section below for the full build order. | ✅ Stages 0-4 shipped; nav polish shipped 2026-04-14 |
| 1.14 | **Deal grading assessment (Grade tab)** — future build. Placeholder tab in the DealDetails page today. Eventually renders a structured scoring rubric for the deal: MEDDIC coverage, urgency, intent, qualification status, stakeholder map, offer state, next-step clarity. Generated by a dedicated scoring prompt that reads the cumulative deal summary + all per-meeting summaries + the prep dossier + the SDR notes and outputs a numerical score (1-10) across each dimension plus a narrative verdict. Stores to a new `deal_grades` table in Convex keyed by `contact_id` with history (one row per regeneration so Kate can see the score move over time). Triggered manually from the tab via a "Regenerate grade" button, and automatically after any new transcript + summary lands for this contact. **Depends on:** 1.13 DealDetails scaffold + Stage 1 summary generation job + Stage 4 cumulative summary. **Model:** Claude Sonnet via local Max plan (same runner as summary jobs). | Phase 1, after 1.13 lands |
| 1.16 | **Meeting outcome classifier (tomato color + manual command)** — per the architectural rule above. Two triggers: (a) Google Calendar color watcher that polls past-scheduled demo meetings, reads `colorId` for each via the Calendar API, detects `colorId === 11` (tomato), compares the event's `updated` timestamp against `start_time` to classify as cancelled (tomato set before start) vs no-show (tomato set at/after start), writes to `meetings.call_outcome` with values `cancelled` / `no_show` and `outcome_set_at` + `outcome_source="tomato"`; (b) manual command path via gobot/natively chat — user says "mark [prospect] as no-show" / "cancel [prospect]," bot resolves by name → finds the most recent demo meeting → writes outcome with `outcome_source="manual"`. New schema fields on `meetings`: `call_outcome` (already exists — repurpose), `outcome_set_at` (new), `outcome_source` (new). New launchd job `com.go.outcome-classifier` runs every 15 min, scoped to demos with `start_time >= 7 days ago AND call_outcome IS NULL`. Idempotent — re-running never rewrites a set outcome unless the source changes. Blocks backlog 1.14 (Grade tab) which reads outcome data, and improves the DealDetails tab copy from "outcome unknown" to a real label. | Phase 1, after 1.13 DealDetails scaffold lands |
| 1.17 | **Multi-party transcript swap** — replace the Natively transcript with Zoom's speaker-labeled transcript when a group call happens. Two triggers: (a) **auto**: calendar event has 3+ attendees → swap automatically after the call; (b) **manual**: Kate tells Natively "swap with Zoom transcript" via in-call or post-call chat → does the same regardless of attendee count (handles uninvited participants joining). Zoom's transcript (already synced to Convex via `zoom-transcript-sync`) has per-speaker name labels. Logic: wait for Zoom transcript to land in Convex (poll or webhook), then overwrite the Natively transcript row with Zoom's version. The Natively summary/coaching data generated during the live call is preserved — only the raw transcript is swapped. | Phase 1 |
| 1.19 | **Live coaching reads full deal context from SQLite cache** — during a live meeting, the in-call chat overlay and AI coaching suggestions should read the full DealDetails bundle from the local SQLite cache (not Convex) for zero-latency responses. This includes: prior meeting summaries/transcripts, SDR notes, company/contact profile, deal stage, prep dossier — everything on the DealDetails page. Depends on: 1.1 storage unification (which pre-loads SQLite cache for upcoming meetings). Currently the overlay only gets a limited `dealContext` blob fetched at startMeeting time. | Phase 1, after 1.1 |
| 1.18 | **Attendee name labeling for 1:1 calls** — when a calendar event has exactly 2 attendees (Kate + 1 guest), label the "Interviewer" transcript segments with the guest's name from the calendar event (e.g., "John Smith" instead of "Interviewer"). Simple string substitution at display time in MeetingDetails — no diarization needed since there's only one remote voice. | Phase 1 |
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

### Known bugs

| # | Bug | Status |
|---|-----|--------|
| B1 | **SDR triage call transcripts missing in DealDetails** — Patrick Spellman and Ginger Tenny show SDR triage call summaries in Past Meetings but the actual call transcripts are missing. Previously worked. Likely a regression in how DealDetails queries or displays transcripts from `call_transcripts` in Convex. Investigate: does the Convex endpoint return the transcript field? Does the UI render it? | Open |

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

### Stage 4.5 — Navigation polish + HubSpot URL fix

> ✅ SHIPPED 2026-04-14 (evening) — natively commits cbdfc7c, 4381e22, 740817c, 258f64c, 54d9be3 · gobot commit f88f2df

**Shipped:**
1. **DealDetails header restructure + Past Meetings tab + tab reorder** (cbdfc7c) — Past Meetings tab added, existing tabs reordered to match Kate's preferred read order
2. **Deal pill on main feed — recorded meeting rows** (4381e22) — orange "Deal" pill to the right of the meeting title. Click opens DealDetails for that meeting's contact; click title still opens MeetingDetails (existing). Per-row state map (loading / no-deal / idle) keyed on meeting id. Gated on `m.calendarEventId`
3. **Past Meetings drilldown — Deal → MeetingDetails** (740817c) — clicking a past meeting in DealDetails Past Meetings tab navigates into its MeetingDetails. Reconciles `DealDetailsMeetingRef` with local SQLite via `calendar_event_id`, falls back to synthetic Meeting when not found locally
4. **patch-premium-prompts.ts idempotency** (258f64c) — re-running on an already-patched staging dir no longer fails the rebuild-and-swap workflow. Required for iterative ship cycles
5. **Deal pill on upcoming-meeting rows** (54d9be3) — mirrors the recorded-row pill. Same async fetch flow, same orange styling, same per-row state machine keyed on `upcoming-${ev.id}` so loading/no-deal state doesn't bleed between rows
6. **HubSpot link icon on upcoming rows** (54d9be3) — the previously-decorative `LinkIcon` is now a clickable button. Async-fetches `convexGetMeetingProfile`, extracts `hubspot_contact_id`, opens the HubSpot contact record in the default browser via `window.electronAPI.openExternal()`. Error state: flashes red for 2s on no-contact / fetch failure
7. **HubSpot portal ID + URL format fix** (54d9be3 natively · f88f2df gobot) — `src/lib/hubspot-mapping.ts` had the wrong portal ID (`21182745`) and legacy URL paths (`/contact/{id}`, `/deal/{id}`) which redirected clicks through a login wall instead of landing on the record. Corrected to portal `24045483` (verified via Kate's BCC address `24045483@bcc.hubspot.com`) and canonical object-type paths: `/record/0-1/{id}` (contact), `/record/0-3/{id}` (deal), `/record/0-2/{id}` (company). New helper `hubspotCompanyUrl()` added (not yet wired). Same fix also applied in gobot to `vps-gateway.ts`, `discovery-transcript-sync.ts`, `notion-transcript-push.ts`, `convex/notionSync.ts`, `scripts/backfill-deal-hub.ts`. Existing Notion pages written before this fix still carry stale URLs — no backfill run yet

**Test gate:** Kate visually confirmed on Michael Koonce's DealDetails page + main-feed upcoming rows. HubSpot link icon opened the contact record without the login redirect after the portal fix.

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
- **HubSpot portal id for Kate's account:** `21182745` (used for app.hubspot.com URLs). NOT `24045483` (that's the workflow account id used in BCC and workflow URLs).
- **HubSpot deal stage map source of truth:** `gobot/src/lib/sales/hubspot-config.ts` `DEAL_STAGE_MAP`. Mirrored in `natively/src/lib/hubspot-mapping.ts`.
- **Smart Calendar Paperclip plugin** (read-only reference): `/Users/jamesleylane/client-scalable/plugins/plugin-smart-calendar/`. Has `data-layer.ts` + `shared-types.ts` with the same patterns Natively uses now. Don't re-extract — Natively has its own implementation.
- **Live Call Companion plugin** (read-only reference): `/Users/jamesleylane/client-scalable/plugins/plugin-live-call-companion/`. Scaffold only — not built out. The transcript-extraction pipeline for Next Steps actions has to be built fresh in Natively.
- **Rebuild & swap workflow for Natively:** invoke the `natively-rebuild` skill or follow `~/gobot/.claude/skills/natively-rebuild.md`. Critical flag: `--unpack "*.{node,dylib}"` (NOT `--unpack-dir` with brace expansion).
