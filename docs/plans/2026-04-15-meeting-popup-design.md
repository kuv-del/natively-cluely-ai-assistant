# Pre-Meeting Popup + Meeting Linking Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a Notion Calendar–style popup T-2 minutes before meetings. Clicking "Join" opens Zoom AND starts Natively linked to the calendar event. Also fix the bug where manual "Start now" creates unlinked meetings.

**Architecture:** CalendarManager gets main-process polling (60s interval) so reminders fire even when the Launcher isn't visible. A new `MeetingPopupHelper` creates a small frameless BrowserWindow popup. A new `?window=meeting-popup` route in App.tsx renders the popup UI. The App.tsx `handleStartMeeting` is fixed to pass the next calendar event's info.

**Tech Stack:** Electron BrowserWindow, React component, IPC, existing CalendarManager

---

## Task 1: Add main-process calendar polling to CalendarManager

**Files:**
- Modify: `electron/services/CalendarManager.ts:117-133` (init method)

**Step 1: Add polling interval to `init()`**

After the existing bootstrap logic in `init()`, add a 60-second polling interval that calls `getUpcomingEvents(true)`. This ensures reminders are scheduled regardless of whether the Launcher renderer is open.

```typescript
// At the end of init(), after the bootstrap block (line ~132):

// Main-process polling: fetch events + schedule reminders every 60s,
// independent of whether the Launcher renderer is mounted.
if (this.updateInterval) clearInterval(this.updateInterval);
this.updateInterval = setInterval(() => {
    if (this.isConnected) {
        this.getUpcomingEvents(true).catch(err => {
            console.error('[CalendarManager] Polling fetch failed:', err);
        });
    }
}, 60_000);

// Also do an initial fetch on startup (after a short delay for token bootstrap)
setTimeout(() => {
    if (this.isConnected) {
        this.getUpcomingEvents(true).catch(err => {
            console.error('[CalendarManager] Initial fetch failed:', err);
        });
    }
}, 5_000);
```

**Step 2: Verify with console log**

After rebuild + swap, check `~/Documents/natively_debug.log` or Natively DevTools console for `[CalendarManager]` log lines showing periodic fetches and `scheduleReminders` calls.

**Step 3: Commit**

```bash
git add electron/services/CalendarManager.ts
git commit -m "feat(calendar): add main-process polling so reminders fire without Launcher open"
```

---

## Task 2: Create MeetingPopupHelper — the floating popup window

**Files:**
- Create: `electron/MeetingPopupHelper.ts`

**Step 1: Create the helper class**

Follow the `ScriptHelperWindowHelper` pattern: small frameless `BrowserWindow`, always-on-top, transparent, centered on screen. The popup loads `?window=meeting-popup` with event data passed via IPC.

```typescript
import { BrowserWindow, screen, app, shell } from "electron"
import path from "node:path"

const isDev = process.env.NODE_ENV === "development"
const startUrl = isDev
    ? "http://localhost:5180"
    : `file://${path.join(app.getAppPath(), "dist/index.html")}`

const POPUP_WIDTH = 380
const POPUP_HEIGHT = 200

export interface PopupMeetingEvent {
    id: string
    title: string
    startTime: string
    endTime: string
    link?: string
    attendeeCount: number
}

export class MeetingPopupHelper {
    private popupWindow: BrowserWindow | null = null
    private pendingEvent: PopupMeetingEvent | null = null

    public show(event: PopupMeetingEvent): void {
        this.pendingEvent = event

        // If popup already open, just update it
        if (this.popupWindow && !this.popupWindow.isDestroyed()) {
            this.popupWindow.webContents.send("meeting-popup:event", event)
            this.popupWindow.show()
            return
        }

        this.createWindow()
    }

    public close(): void {
        if (this.popupWindow && !this.popupWindow.isDestroyed()) {
            this.popupWindow.close()
        }
        this.popupWindow = null
        this.pendingEvent = null
    }

    public getPendingEvent(): PopupMeetingEvent | null {
        return this.pendingEvent
    }

    private createWindow(): void {
        const primary = screen.getPrimaryDisplay()
        const { x: dx, y: dy, width: dw } = primary.workArea
        // Position: top-right corner with margin (like Notion Calendar)
        const marginRight = 20
        const marginTop = 20
        const defaultX = dx + dw - POPUP_WIDTH - marginRight
        const defaultY = dy + marginTop

        this.popupWindow = new BrowserWindow({
            width: POPUP_WIDTH,
            height: POPUP_HEIGHT,
            x: defaultX,
            y: defaultY,
            frame: false,
            transparent: true,
            resizable: false,
            fullscreenable: false,
            hasShadow: true,
            alwaysOnTop: true,
            backgroundColor: "#00000000",
            show: false,
            skipTaskbar: true,
            focusable: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, "preload.js"),
                backgroundThrottling: false
            }
        })

        if (process.platform === "darwin") {
            this.popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
            this.popupWindow.setAlwaysOnTop(true, "floating")
        }

        const url = `${startUrl}?window=meeting-popup`
        this.popupWindow.loadURL(url).catch(e => {
            console.error("[MeetingPopupHelper] Failed to load URL:", e)
        })

        this.popupWindow.once("ready-to-show", () => {
            this.popupWindow?.show()
            // Push event data to renderer
            if (this.pendingEvent) {
                this.popupWindow?.webContents.send("meeting-popup:event", this.pendingEvent)
            }
        })

        this.popupWindow.on("closed", () => {
            this.popupWindow = null
        })
    }
}
```

**Step 2: Commit**

```bash
git add electron/MeetingPopupHelper.ts
git commit -m "feat(popup): add MeetingPopupHelper — floating pre-meeting popup window"
```

---

## Task 3: Wire CalendarManager to show popup instead of system notification

**Files:**
- Modify: `electron/services/CalendarManager.ts:345-402` (scheduleReminders + showNotification)
- Modify: `electron/main.ts:2675-2698` (CalendarManager event listeners)

**Step 1: Replace `showNotification()` with a new event emission**

In `CalendarManager.ts`, replace the existing `showNotification` method body. Instead of creating an Electron Notification, emit a `'meeting-reminder'` event with the event data:

```typescript
private showNotification(event: CalendarEvent) {
    console.log(`[CalendarManager] Meeting reminder: "${event.title}" in 2 minutes`);
    this.emit('meeting-reminder', event);
}
```

**Step 2: Handle the event in main.ts**

In `main.ts`, after the existing CalendarManager event listeners (~line 2689), add:

```typescript
// Import at top of main.ts (near other imports):
import { MeetingPopupHelper, PopupMeetingEvent } from "./MeetingPopupHelper"

// After CalendarManager init block (~line 2695):
const meetingPopup = new MeetingPopupHelper();

calMgr.on('meeting-reminder', (event: any) => {
    console.log('[Main] Meeting reminder popup for:', event.title);
    // Play system notification sound
    const { shell } = require('electron');
    // macOS system sound
    if (process.platform === 'darwin') {
        require('child_process').exec('afplay /System/Library/Sounds/Glass.aiff');
    }
    meetingPopup.show({
        id: event.id,
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        link: event.link,
        attendeeCount: event.attendees?.length || 0
    });
});
```

**Step 3: Add IPC handlers for popup actions**

In `electron/ipcHandlers.ts`, add handlers for the popup's Join and Dismiss buttons:

```typescript
// Meeting popup actions
safeHandle("meeting-popup:join", async (_, eventData: any) => {
    try {
        const { shell } = require('electron');
        // 1. Open Zoom link
        if (eventData.link) {
            await shell.openExternal(eventData.link);
        }
        // 2. Start Natively meeting with calendar event linked
        const inputDeviceId = null; // Will use defaults
        const outputDeviceId = null;
        await appState.startMeeting({
            title: eventData.title,
            calendarEventId: eventData.id,
            source: 'calendar',
            audio: { inputDeviceId, outputDeviceId }
        });
        // 3. Switch to overlay
        appState.getWindowHelper().setWindowMode('overlay');
        return { success: true };
    } catch (error: any) {
        console.error("[IPC] meeting-popup:join error:", error);
        return { success: false, error: error.message };
    }
});

safeHandle("meeting-popup:dismiss", async () => {
    // Popup closes itself via window.close() — nothing else needed
    return { success: true };
});
```

**Step 4: Add preload bridges**

In `electron/preload.ts`, add to the `electronAPI` object:

```typescript
// Meeting popup
meetingPopupJoin: (eventData: any) => ipcRenderer.invoke("meeting-popup:join", eventData),
meetingPopupDismiss: () => ipcRenderer.invoke("meeting-popup:dismiss"),
onMeetingPopupEvent: (cb: (event: any) => void) => {
    const handler = (_: any, event: any) => cb(event);
    ipcRenderer.on("meeting-popup:event", handler);
    return () => ipcRenderer.removeListener("meeting-popup:event", handler);
},
```

**Step 5: Commit**

```bash
git add electron/services/CalendarManager.ts electron/main.ts electron/ipcHandlers.ts electron/preload.ts
git commit -m "feat(popup): wire CalendarManager reminder → popup window + IPC handlers"
```

---

## Task 4: Create the popup React component

**Files:**
- Create: `src/components/MeetingPopup.tsx`
- Modify: `src/App.tsx:38-44` (add window route)

**Step 1: Create the popup component**

A small, clean UI matching Natively's dark theme. Shows meeting title, time, and a prominent "Join" button.

```tsx
import React, { useEffect, useState } from 'react';
import { Video, X, Clock } from 'lucide-react';

interface PopupEvent {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    link?: string;
    attendeeCount: number;
}

const MeetingPopup: React.FC = () => {
    const [event, setEvent] = useState<PopupEvent | null>(null);

    useEffect(() => {
        let cleanup: (() => void) | undefined;
        if (window.electronAPI?.onMeetingPopupEvent) {
            cleanup = window.electronAPI.onMeetingPopupEvent((ev: PopupEvent) => {
                setEvent(ev);
            });
        }
        return () => cleanup?.();
    }, []);

    if (!event) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-transparent">
                <div className="bg-bg-primary/95 backdrop-blur-xl rounded-2xl p-6 border border-border-subtle shadow-2xl">
                    <p className="text-text-secondary text-sm">Loading...</p>
                </div>
            </div>
        );
    }

    const startTime = new Date(event.startTime);
    const endTime = new Date(event.endTime);
    const timeStr = `${startTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${endTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

    const handleJoin = async () => {
        try {
            await window.electronAPI?.meetingPopupJoin?.(event);
            window.close();
        } catch (e) {
            console.error('Join failed:', e);
        }
    };

    const handleDismiss = () => {
        window.electronAPI?.meetingPopupDismiss?.();
        window.close();
    };

    return (
        <div className="w-full h-full flex items-center justify-center bg-transparent select-none"
             style={{ WebkitAppRegion: 'drag' } as any}>
            <div className="bg-bg-primary/95 backdrop-blur-xl rounded-2xl border border-border-subtle shadow-2xl w-full mx-3 overflow-hidden">
                {/* Header bar */}
                <div className="px-5 pt-4 pb-3 flex items-start justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
                            Starting in 2 min
                        </span>
                    </div>
                    <button
                        onClick={handleDismiss}
                        className="text-text-tertiary hover:text-text-primary transition-colors -mt-0.5"
                        style={{ WebkitAppRegion: 'no-drag' } as any}
                    >
                        <X size={14} />
                    </button>
                </div>

                {/* Meeting info */}
                <div className="px-5 pb-3">
                    <h2 className="text-base font-bold text-text-primary leading-tight line-clamp-2 mb-1.5">
                        {event.title}
                    </h2>
                    <div className="flex items-center gap-2 text-text-secondary text-xs">
                        <Clock size={12} />
                        <span>{timeStr}</span>
                        {event.attendeeCount > 0 && (
                            <>
                                <span className="opacity-30">·</span>
                                <span>{event.attendeeCount} attendee{event.attendeeCount !== 1 ? 's' : ''}</span>
                            </>
                        )}
                    </div>
                </div>

                {/* Actions */}
                <div className="px-5 pb-4 pt-1 flex items-center gap-3">
                    <button
                        onClick={handleJoin}
                        className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-lg hover:shadow-emerald-500/25 active:scale-[0.97] flex items-center justify-center gap-2"
                        style={{ WebkitAppRegion: 'no-drag' } as any}
                    >
                        <Video size={15} />
                        Join Meeting
                    </button>
                    <button
                        onClick={handleDismiss}
                        className="px-3 py-2.5 rounded-xl text-xs font-medium text-text-tertiary hover:text-text-primary transition-colors"
                        style={{ WebkitAppRegion: 'no-drag' } as any}
                    >
                        Dismiss
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MeetingPopup;
```

**Step 2: Add the window route in App.tsx**

Near the top of `App.tsx` where the other window types are detected (~line 38-44), add:

```typescript
const isMeetingPopupWindow = new URLSearchParams(window.location.search).get('window') === 'meeting-popup';
```

Update the `isDefault` check to include `!isMeetingPopupWindow`.

Then add an early return for the popup window (near the other early returns like `isScriptHelperWindow`):

```typescript
if (isMeetingPopupWindow) {
    return <MeetingPopup />;
}
```

Import at top:
```typescript
import MeetingPopup from './components/MeetingPopup';
```

**Step 3: Commit**

```bash
git add src/components/MeetingPopup.tsx src/App.tsx
git commit -m "feat(popup): MeetingPopup component — pre-meeting join UI"
```

---

## Task 5: Fix "Start now" / main CTA to link calendar events

**Files:**
- Modify: `src/App.tsx:336-354` (handleStartMeeting)
- Modify: `src/App.tsx:484-485` (Launcher prop)
- Modify: `src/components/Launcher.tsx:50` (prop type)
- Modify: `src/components/Launcher.tsx:94` (destructure prop)
- Modify: `src/components/Launcher.tsx:746` (main CTA)
- Modify: `src/components/Launcher.tsx:894` ("Start now" button)

**Step 1: Change `onStartMeeting` to accept an optional calendar event**

In `App.tsx`, update `handleStartMeeting` to accept an optional event parameter and pass it through:

```typescript
const handleStartMeeting = async (calendarEvent?: { id: string; title: string }) => {
    try {
        localStorage.setItem('natively_last_meeting_start', Date.now().toString());
        const inputDeviceId = localStorage.getItem('preferredInputDeviceId');
        let outputDeviceId = localStorage.getItem('preferredOutputDeviceId');
        const useExperimentalSck = localStorage.getItem('useExperimentalSckBackend') === 'true';

        if (useExperimentalSck) {
            console.log("[App] Using ScreenCaptureKit backend (Experimental).");
            outputDeviceId = "sck";
        } else {
            console.log("[App] Using CoreAudio backend (Default).");
        }

        const metadata: any = {
            audio: { inputDeviceId, outputDeviceId }
        };

        // Link to calendar event if provided
        if (calendarEvent) {
            metadata.title = calendarEvent.title;
            metadata.calendarEventId = calendarEvent.id;
            metadata.source = 'calendar';
        }

        const result = await window.electronAPI.startMeeting(metadata);
        if (result.success) {
            analytics.trackMeetingStarted();
            await window.electronAPI.setWindowMode('overlay');
        } else {
            console.error("Failed to start meeting:", result.error);
        }
    } catch (err) {
        console.error("Failed to start meeting:", err);
    }
};
```

**Step 2: Update Launcher prop type**

In `Launcher.tsx`, change the prop type:

```typescript
onStartMeeting: (calendarEvent?: { id: string; title: string }) => void;
```

**Step 3: Update the main CTA and "Start now" button to pass the event**

Main CTA (line 746) — pass `nextMeeting` when available:
```typescript
onStartMeeting(nextMeeting ? { id: nextMeeting.id, title: nextMeeting.title } : undefined);
```

"Start now" button (line 894) — pass `nextMeeting`:
```typescript
onClick={() => onStartMeeting(nextMeeting ? { id: nextMeeting.id, title: nextMeeting.title } : undefined)}
```

**Step 4: Commit**

```bash
git add src/App.tsx src/components/Launcher.tsx
git commit -m "fix(meeting): Start now + main CTA pass calendarEventId so meetings link correctly"
```

---

## Task 6: Prevent duplicate reminders + skip if meeting already active

**Files:**
- Modify: `electron/services/CalendarManager.ts:347-372` (scheduleReminders)

**Step 1: Track which events have already been reminded**

Add a `Set<string>` to track reminded event IDs so re-polling doesn't fire duplicate popups. Also skip if a meeting is already active.

```typescript
// Add to class properties (near line 103):
private remindedEventIds: Set<string> = new Set();

// Replace scheduleReminders:
private scheduleReminders(events: CalendarEvent[]) {
    // Clear existing timers
    this.reminderTimeouts.forEach(t => clearTimeout(t));
    this.reminderTimeouts = [];

    const now = Date.now();

    events.forEach(event => {
        if (!event.startTime) return;
        // Skip if already reminded for this event
        if (this.remindedEventIds.has(event.id)) return;

        const startTime = new Date(event.startTime).getTime();
        const reminderTime = startTime - (2 * 60 * 1000); // T-2 minutes

        if (reminderTime > now) {
            const delay = reminderTime - now;
            if (delay < 24 * 60 * 60 * 1000) {
                const timeout = setTimeout(() => {
                    this.remindedEventIds.add(event.id);
                    this.showNotification(event);
                }, delay);
                this.reminderTimeouts.push(timeout);
            }
        }
    });

    // Clean up old reminded IDs (events older than 1 hour ago)
    const oneHourAgo = now - 60 * 60 * 1000;
    for (const id of this.remindedEventIds) {
        const evt = events.find(e => e.id === id);
        if (evt && new Date(evt.startTime).getTime() < oneHourAgo) {
            this.remindedEventIds.delete(id);
        }
    }
}
```

**Step 2: In main.ts, skip popup if meeting already active**

In the `'meeting-reminder'` handler, check `appState.getIsMeetingActive()`:

```typescript
calMgr.on('meeting-reminder', (event: any) => {
    // Don't show popup if already in a meeting
    if (appState.getIsMeetingActive()) {
        console.log('[Main] Skipping meeting reminder — already in a meeting');
        return;
    }
    // ... rest of popup logic
});
```

**Step 3: Commit**

```bash
git add electron/services/CalendarManager.ts electron/main.ts
git commit -m "fix(popup): prevent duplicate reminders + skip popup during active meeting"
```

---

## Task 7: Build, rebuild-and-swap, visual verification

**Step 1: Build**

```bash
cd /Users/jamesleylane/Projects/natively-cluely-ai-assistant
npm run build
npm run build:electron
```

**Step 2: Rebuild and swap**

Use the `natively-rebuild` skill to run the 9-step asar swap workflow.

**Step 3: Re-grant Screen Recording permission**

System Settings → Privacy & Security → Screen Recording → remove + re-add Natively → toggle on → relaunch.

**Step 4: Visual verification**

- Confirm overlay renders normally (not raw JS)
- Open Settings → verify calendar is connected
- Check that upcoming meetings appear in the feed
- Wait for a meeting within 2 minutes OR temporarily change reminder time to T-5 minutes for testing
- Verify popup appears with correct title, time, attendee count
- Click "Join" → verify Zoom opens + Natively overlay starts + meeting is linked in the feed
- Click "Dismiss" on a second test → verify popup closes cleanly

**Step 5: Test the "Start now" fix**

- On a meeting in the feed, click "Start now" (not Prepare → Start)
- End the meeting
- Verify the recorded meeting shows in the feed linked to the calendar event (not as a separate "Untitled Session")

---

## Summary

| Task | What | Effort |
|------|------|--------|
| 1 | CalendarManager main-process polling | ~10 min |
| 2 | MeetingPopupHelper (floating window) | ~15 min |
| 3 | Wire reminder → popup + IPC handlers | ~15 min |
| 4 | MeetingPopup React component | ~15 min |
| 5 | Fix "Start now" / CTA to link events | ~10 min |
| 6 | Dedup reminders + skip during active meeting | ~10 min |
| 7 | Build, swap, verify | ~15 min |

**Total: ~90 minutes**
