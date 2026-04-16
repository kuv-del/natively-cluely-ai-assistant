# Storage Unification + Navigation Rewire Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Convex the single source of truth for Natively transcripts/summaries. Add expandable transcripts to the DealDetails Meetings tab. Rewire navigation so meeting clicks go to DealDetails when a contact is linked.

**Architecture:** After a meeting ends, MeetingPersistence writes transcript + summary to both local SQLite (fast cache) AND Convex (permanent storage) via a direct HTTP POST. Speaker labels are replaced with real names (Kate Schnetzer + guest name from calendar attendees) before writing. DealDetails already reads from Convex and already has Natively-first read precedence — so transcripts appear automatically once written. The Meetings tab gets an expandable transcript widget under each meeting's summary. Navigation is rewired so clicking a meeting title goes to DealDetails (with MeetingDetails fallback for contactless meetings).

**Tech Stack:** Convex HTTP actions + mutations (gobot repo), Electron main process (natively repo), React (natively repo)

---

## Task 1: Create Convex mutation + HTTP endpoint for saving Natively transcripts

**Files (gobot repo: `/Users/jamesleylane/gobot`):**
- Create: `convex/nativelyMutations.ts`
- Modify: `convex/http.ts` (add POST endpoint)

**Step 1: Create the mutation**

Create `convex/nativelyMutations.ts`:

```typescript
import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Save a Natively-recorded transcript after a meeting ends.
 * Upserts by calendar_event_id — if Natively already saved a transcript for
 * this event (e.g. retry after crash), it overwrites rather than duplicating.
 */
export const saveTranscript = mutation({
  args: {
    calendar_event_id: v.string(),
    contact_id: v.optional(v.id("contacts")),
    hubspot_contact_id: v.optional(v.string()),
    meeting_id: v.optional(v.id("meetings")),
    transcript: v.optional(v.string()),
    segments: v.optional(v.array(v.object({
      speaker: v.string(),
      text: v.string(),
      timestamp: v.optional(v.number()),
    }))),
    duration_seconds: v.optional(v.number()),
    meeting_type: v.optional(v.string()),
    recorded_at: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Upsert by calendar_event_id
    const existing = await ctx.db
      .query("natively_transcripts")
      .withIndex("by_calendar_event", (q) =>
        q.eq("calendar_event_id", args.calendar_event_id)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        transcript: args.transcript,
        segments: args.segments,
        duration_seconds: args.duration_seconds,
        meeting_type: args.meeting_type,
        recorded_at: args.recorded_at,
        ...(args.contact_id ? { contact_id: args.contact_id } : {}),
        ...(args.hubspot_contact_id ? { hubspot_contact_id: args.hubspot_contact_id } : {}),
        ...(args.meeting_id ? { meeting_id: args.meeting_id } : {}),
      });
      return existing._id;
    }

    // contact_id is required for new rows
    if (!args.contact_id) {
      throw new Error("contact_id required for new natively_transcripts row");
    }

    return await ctx.db.insert("natively_transcripts", {
      calendar_event_id: args.calendar_event_id,
      contact_id: args.contact_id,
      hubspot_contact_id: args.hubspot_contact_id,
      meeting_id: args.meeting_id,
      source: "natively",
      transcript: args.transcript,
      segments: args.segments,
      duration_seconds: args.duration_seconds,
      meeting_type: args.meeting_type,
      recorded_at: args.recorded_at,
    });
  },
});

/**
 * Save a Natively-generated per-meeting summary.
 * Upserts by calendar_event_id + summary_type="per_meeting".
 */
export const saveSummary = mutation({
  args: {
    calendar_event_id: v.string(),
    contact_id: v.optional(v.id("contacts")),
    hubspot_contact_id: v.optional(v.string()),
    meeting_id: v.optional(v.id("meetings")),
    summary_markdown: v.string(),
    meeting_type: v.optional(v.string()),
    generator_model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("natively_summaries")
      .withIndex("by_calendar_event", (q) =>
        q.eq("calendar_event_id", args.calendar_event_id)
      )
      .first();

    // Only upsert per_meeting type (don't clobber cumulative_deal summaries)
    if (existing && existing.summary_type === "per_meeting") {
      await ctx.db.patch(existing._id, {
        summary_markdown: args.summary_markdown,
        meeting_type: args.meeting_type,
        generator_model: args.generator_model,
        ...(args.contact_id ? { contact_id: args.contact_id } : {}),
        ...(args.hubspot_contact_id ? { hubspot_contact_id: args.hubspot_contact_id } : {}),
        ...(args.meeting_id ? { meeting_id: args.meeting_id } : {}),
      });
      return existing._id;
    }

    if (!args.contact_id) {
      throw new Error("contact_id required for new natively_summaries row");
    }

    return await ctx.db.insert("natively_summaries", {
      calendar_event_id: args.calendar_event_id,
      contact_id: args.contact_id,
      hubspot_contact_id: args.hubspot_contact_id,
      meeting_id: args.meeting_id,
      summary_type: "per_meeting",
      summary_markdown: args.summary_markdown,
      meeting_type: args.meeting_type,
      generator_model: args.generator_model,
    });
  },
});
```

**Step 2: Add HTTP endpoint in `convex/http.ts`**

Add a POST endpoint at `/natively/save-meeting` that accepts transcript + summary and calls both mutations. Add it near the existing `/natively/` endpoints:

```typescript
// POST /natively/save-meeting — Natively pushes transcript + summary after a meeting
http.route({
  path: "/natively/save-meeting",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { calendar_event_id, contact_id, hubspot_contact_id, meeting_id,
              transcript, segments, duration_seconds, meeting_type, recorded_at,
              summary_markdown, generator_model } = body;

      if (!calendar_event_id) {
        return new Response(JSON.stringify({ error: "calendar_event_id required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      // Save transcript
      let transcriptId = null;
      if (segments || transcript) {
        transcriptId = await ctx.runMutation(api.nativelyMutations.saveTranscript, {
          calendar_event_id,
          contact_id: contact_id || undefined,
          hubspot_contact_id: hubspot_contact_id || undefined,
          meeting_id: meeting_id || undefined,
          transcript: transcript || undefined,
          segments: segments || undefined,
          duration_seconds: duration_seconds || undefined,
          meeting_type: meeting_type || undefined,
          recorded_at: recorded_at || undefined,
        });
      }

      // Save summary
      let summaryId = null;
      if (summary_markdown) {
        summaryId = await ctx.runMutation(api.nativelyMutations.saveSummary, {
          calendar_event_id,
          contact_id: contact_id || undefined,
          hubspot_contact_id: hubspot_contact_id || undefined,
          meeting_id: meeting_id || undefined,
          summary_markdown,
          meeting_type: meeting_type || undefined,
          generator_model: generator_model || undefined,
        });
      }

      return new Response(JSON.stringify({ ok: true, transcriptId, summaryId }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    } catch (err: any) {
      console.error("[/natively/save-meeting]", err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
  }),
});

// CORS preflight for save-meeting
http.route({
  path: "/natively/save-meeting",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});
```

Don't forget to add `import { api } from "./_generated/api"` if not already imported at the top of http.ts.

**Step 3: Deploy Convex**

```bash
cd /Users/jamesleylane/gobot && bunx convex deploy
```

**Step 4: Commit**

```bash
cd /Users/jamesleylane/gobot
git add convex/nativelyMutations.ts convex/http.ts
git commit -m "feat(convex): add POST /natively/save-meeting — transcript + summary write endpoint"
```

---

## Task 2: Add Convex write-through + speaker labeling to MeetingPersistence

**Files (natively repo: `/Users/jamesleylane/Projects/natively-cluely-ai-assistant`):**
- Modify: `electron/MeetingPersistence.ts`

**What to do:**

At the end of `processAndSaveMeeting()` (after the SQLite save at line ~178), add a Convex push. Before writing, replace speaker labels with real names using calendar attendee data.

**Step 1: Add speaker label replacement + Convex push**

After the `DatabaseManager.getInstance().saveMeeting(meetingData, ...)` call and the `wins.forEach(...)` notification block (~line 184), add:

```typescript
// ── Speaker label replacement + Convex write-through ─────────────
// Only push to Convex if we have a calendar event (linked meeting)
if (calendarEventId) {
    try {
        // 1. Fetch calendar event for attendee names
        const { CalendarManager } = require('./services/CalendarManager');
        const calMgr = CalendarManager.getInstance();
        let events: any[] = [];
        try {
            events = await calMgr.getUpcomingEvents(true);
        } catch {}

        // Also check recent events (the meeting may have already passed)
        const event = events.find((e: any) => e.id === calendarEventId);
        const attendees: Array<{ email: string; name: string | null }> = event?.attendees ?? [];

        // 2. Replace speaker labels
        const labeledSegments = (data.transcript || []).map((seg: TranscriptSegment) => {
            let speaker = seg.speaker;
            if (speaker === 'user') {
                speaker = 'Kate Schnetzer';
            } else if (speaker === 'interviewer') {
                // Find non-Kate attendee for 1:1 calls
                const guest = attendees.find((a: any) =>
                    a.email && !a.email.includes('kate.schnetzer') && !a.email.includes('schnetzerfamily')
                );
                speaker = guest?.name || 'Guest';
            }
            return { speaker, text: seg.text, timestamp: seg.timestamp };
        });

        // 3. Build full transcript string (for search/display)
        const fullTranscriptText = labeledSegments
            .map((s: any) => `${s.speaker}: ${s.text}`)
            .join('\n');

        // 4. Resolve contact_id via meeting-profile endpoint
        let contactId: string | undefined;
        let hubspotContactId: string | undefined;
        let meetingId: string | undefined;
        let meetingType: string | undefined;
        try {
            const profileUrl = `https://opulent-bandicoot-376.convex.site/natively/meeting-profile?calendar_event_id=${encodeURIComponent(calendarEventId)}`;
            const profileResp = await fetch(profileUrl, { signal: AbortSignal.timeout(8000) });
            if (profileResp.ok) {
                const profile = await profileResp.json();
                if (profile?.meeting) {
                    contactId = profile.meeting.contact_id;
                    meetingId = profile.meeting.id;
                    meetingType = profile.meeting.meeting_type;
                }
                if (profile?.contact?.hubspot_contact_id) {
                    hubspotContactId = profile.contact.hubspot_contact_id;
                }
            }
        } catch (profileErr) {
            console.warn('[MeetingPersistence] meeting-profile lookup failed (non-fatal):', profileErr);
        }

        // 5. Build summary markdown from detailedSummary
        let summaryMarkdown: string | undefined;
        if (summaryData) {
            const parts: string[] = [];
            if ((summaryData as any).overview) parts.push((summaryData as any).overview);
            if (summaryData.keyPoints?.length) {
                parts.push('## Key Points');
                summaryData.keyPoints.forEach((kp: string) => parts.push(`- ${kp}`));
            }
            if (summaryData.actionItems?.length) {
                parts.push('## Action Items');
                summaryData.actionItems.forEach((ai: string) => parts.push(`- ${ai}`));
            }
            if (parts.length > 0) summaryMarkdown = parts.join('\n');
        }

        // 6. POST to Convex
        if (contactId) {
            const saveUrl = 'https://opulent-bandicoot-376.convex.site/natively/save-meeting';
            const payload = {
                calendar_event_id: calendarEventId,
                contact_id: contactId,
                hubspot_contact_id: hubspotContactId,
                meeting_id: meetingId,
                transcript: fullTranscriptText,
                segments: labeledSegments,
                duration_seconds: Math.round(data.durationMs / 1000),
                meeting_type: meetingType,
                recorded_at: new Date().toISOString(),
                summary_markdown: summaryMarkdown,
                generator_model: 'natively-local',
            };
            const saveResp = await fetch(saveUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(15000),
            });
            if (saveResp.ok) {
                console.log('[MeetingPersistence] Transcript + summary pushed to Convex');
            } else {
                console.warn('[MeetingPersistence] Convex save failed:', saveResp.status, await saveResp.text());
            }
        } else {
            console.log('[MeetingPersistence] No contact_id found — skipping Convex push (contactless meeting)');
        }
    } catch (convexErr) {
        // Non-fatal — SQLite has the data, Convex push is best-effort
        console.error('[MeetingPersistence] Convex write-through failed (non-fatal):', convexErr);
    }
}
```

**Step 2: Also update the SQLite transcript with labeled speakers**

Before the `DatabaseManager.getInstance().saveMeeting(meetingData, ...)` call, replace the transcript in meetingData with labeled segments (same replacement logic). This way SQLite also has names, not just "user"/"interviewer".

Add before the `const meetingData: Meeting = {` block:

```typescript
// Replace speaker labels for SQLite too
const labeledTranscript = data.transcript.map((seg) => {
    // Label replacement happens in Convex push block below, but we also
    // want SQLite to have names. Do a simpler pass here using metadata.
    return seg; // We'll apply labels in the Convex block and update SQLite there
});
```

Actually, simpler: do the attendee lookup BEFORE the SQLite save and apply labels to both. Restructure the function so attendee resolution happens early.

**Step 3: Commit**

```bash
cd /Users/jamesleylane/Projects/natively-cluely-ai-assistant
git add electron/MeetingPersistence.ts
git commit -m "feat(storage): write-through to Convex + speaker name labeling from calendar attendees"
```

---

## Task 3: Rename "Past Meetings" → "Meetings" + add expandable transcript

**Files (natively repo):**
- Modify: `src/components/DealDetails.tsx`

**Step 1: Rename the tab**

In DealDetails.tsx, change `TAB_LABELS` (line 63):
```typescript
past_meetings: 'Meetings',
```

**Step 2: Add expandable transcript widget under each meeting's summary**

In the Past Meetings tab rendering (line 482-524), after the summary `ReactMarkdown` block and before the divider, add an expandable transcript section. The `group.transcript` field already exists in the data from Convex.

After the summary block (after line 516's closing `)`), add:

```tsx
{/* Expandable transcript */}
{group.transcript && group.transcript.length > 0 && (() => {
    const PREVIEW_COUNT = 4;
    const isExpanded = expandedTranscripts[`${group._meetingType}-${idx}`];
    const visibleSegments = isExpanded ? group.transcript! : group.transcript!.slice(0, PREVIEW_COUNT);
    const hasMore = group.transcript!.length > PREVIEW_COUNT;
    return (
        <div className="mt-3">
            <div className={`rounded-lg border ${isLight ? 'bg-bg-elevated/50 border-border-muted' : 'bg-white/3 border-white/6'} p-3 space-y-2`}>
                {visibleSegments.map((seg, si) => (
                    <div key={si} className="flex gap-2 text-[12px] leading-relaxed">
                        <span className={`shrink-0 font-medium ${seg.speaker === 'Kate Schnetzer' || seg.speaker === 'user' || seg.speaker === 'Me' ? 'text-blue-400' : 'text-emerald-400'}`}>
                            {seg.speaker === 'user' ? 'Me' : seg.speaker === 'interviewer' ? 'Them' : seg.speaker}:
                        </span>
                        <span className="text-text-secondary">{seg.text}</span>
                    </div>
                ))}
            </div>
            {hasMore && (
                <button
                    onClick={() => setExpandedTranscripts(prev => ({
                        ...prev,
                        [`${group._meetingType}-${idx}`]: !isExpanded
                    }))}
                    className="mt-1.5 text-[11px] font-medium text-text-tertiary hover:text-text-primary transition-colors"
                >
                    {isExpanded ? 'Collapse transcript' : `Show full transcript (${group.transcript!.length} segments)`}
                </button>
            )}
        </div>
    );
})()}
```

**Step 3: Add state for expanded transcripts**

Near the other `useState` declarations in DealDetails, add:

```typescript
const [expandedTranscripts, setExpandedTranscripts] = useState<Record<string, boolean>>({});
```

**Step 4: Commit**

```bash
git add src/components/DealDetails.tsx
git commit -m "feat(ui): rename Past Meetings → Meetings + add expandable transcript widget"
```

---

## Task 4: Rewire navigation — meeting title → DealDetails

**Files (natively repo):**
- Modify: `src/components/Launcher.tsx`

**What to do:**

Change `handleOpenMeeting` so that when a meeting has a linked contact (via convexGetMeetingProfile), it opens DealDetails instead of MeetingDetails. Falls back to MeetingDetails if no contact.

**Step 1: Update handleOpenMeeting**

Replace the existing `handleOpenMeeting` function (line 376-401):

```typescript
const handleOpenMeeting = async (meeting: Meeting) => {
    setForwardMeeting(null);
    console.log("[Launcher] Opening meeting:", meeting.id);
    analytics.trackCommandExecuted('open_meeting_details');

    // Try to resolve contact from calendar event → open DealDetails if found
    if (meeting.calendarEventId && window.electronAPI?.convexGetMeetingProfile) {
        try {
            const profile = await window.electronAPI.convexGetMeetingProfile(meeting.calendarEventId);
            if (profile?.meeting?.contact_id) {
                console.log("[Launcher] Meeting has contact — opening DealDetails");
                setSelectedDealContactId(profile.meeting.contact_id);
                return;
            }
        } catch (err) {
            console.warn("[Launcher] convexGetMeetingProfile failed, falling back to MeetingDetails:", err);
        }
    }

    // Fallback: no contact linked → open MeetingDetails
    if (window.electronAPI?.getMeetingDetails) {
        try {
            const fullMeeting = await window.electronAPI.getMeetingDetails(meeting.id);
            if (fullMeeting) {
                setSelectedMeeting(fullMeeting);
                return;
            }
        } catch (err) {
            console.error("[Launcher] Failed to fetch meeting details:", err);
        }
    }
    setSelectedMeeting(meeting);
};
```

**Step 2: Commit**

```bash
git add src/components/Launcher.tsx
git commit -m "feat(nav): meeting title click → DealDetails when contact linked, MeetingDetails fallback"
```

---

## Task 5: Deploy Convex, build Natively, rebuild-and-swap, verify

**Step 1: Deploy Convex changes**

```bash
cd /Users/jamesleylane/gobot && bunx convex deploy
```

**Step 2: Build Natively**

```bash
cd /Users/jamesleylane/Projects/natively-cluely-ai-assistant
npm run build
npm run build:electron
```

**Step 3: Rebuild and swap using natively-rebuild skill**

**Step 4: Verify**

- Start a meeting with a calendar event that has a contact
- Say a few words, end the meeting
- Check Convex dashboard — `natively_transcripts` should have a new row with speaker names
- Open the Meetings tab in DealDetails — transcript should appear with expandable widget
- Click a meeting title in the feed — should go to DealDetails (not MeetingDetails)
- Click a contactless meeting — should fall back to MeetingDetails

---

## Summary

| Task | What | Where | Effort |
|------|------|-------|--------|
| 1 | Convex mutation + HTTP endpoint | gobot repo | ~20 min |
| 2 | Write-through + speaker labeling | natively MeetingPersistence | ~25 min |
| 3 | Rename tab + expandable transcript | natively DealDetails.tsx | ~15 min |
| 4 | Navigation rewire | natively Launcher.tsx | ~10 min |
| 5 | Deploy + build + verify | both repos | ~15 min |

**Total: ~85 minutes**
