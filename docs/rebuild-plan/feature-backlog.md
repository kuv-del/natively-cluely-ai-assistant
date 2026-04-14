# Natively Customization Backlog

Features Kate has confirmed she wants but that we're not building right now. Listed in the order she expects to ship, not necessarily priority order.

---

## Phased roadmap (Kate's framing — 2026-04-13)

### Phase 1 — foundation + immediate sales loop

**Goal:** the daily sales workflow works end-to-end. Storage unified, prep + transcripts + summaries flow through Convex, Next Steps actions push to HubSpot.

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
