# Menu Bar Calendar Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Notion Calendar-style menu bar to Natively — tray title shows next meeting + countdown, left-click opens a frameless popup listing upcoming Zoom-link meetings (7 days), clicking an event opens DealDetails in the main window.

**Architecture:** Expand CalendarManager fetch to 7 days. Add `tray.setTitle()` updating every 30s. New `CalendarMenuBarHelper.ts` manages a frameless BrowserWindow popup on tray left-click. New `CalendarMenuBar.tsx` React component renders the event list. New IPC `menubar:open-calendar-event` focuses the Launcher and pushes `open-calendar-event` to the renderer, which calls the existing `handleOpenUpcomingMeeting` → DealDetails flow.

**Tech Stack:** Electron main process (TypeScript), React renderer (TypeScript), existing CalendarManager, existing IPC/preload patterns, existing `handleOpenUpcomingMeeting` navigation logic.

**Rebuild workflow (after each set of changes):**
```bash
cd /Users/jamesleylane/Projects/natively-cluely-ai-assistant
osascript -e 'quit app "Natively"'
npm run build && npm run build:electron
rm -rf /tmp/rebuild-staging
./node_modules/.bin/asar extract /Applications/Natively.app/Contents/Resources/app.asar /tmp/rebuild-staging
rm -rf /tmp/rebuild-staging/dist && cp -R dist /tmp/rebuild-staging/dist
rm -rf /tmp/rebuild-staging/dist-electron/electron && cp -R dist-electron/electron /tmp/rebuild-staging/dist-electron/electron
cp "/Applications/Natively.app/Contents/Resources/app.asar" "/Applications/Natively.app/Contents/Resources/app.asar.backup-$(date +%Y%m%d-%H%M%S).bak"
./node_modules/.bin/asar pack /tmp/rebuild-staging /tmp/rebuild-app.asar --unpack "*.{node,dylib}"
cp /tmp/rebuild-app.asar /Applications/Natively.app/Contents/Resources/app.asar
open -a "Natively"
```
**DO NOT run codesign** — it wipes Keychain credentials (Deepgram key, calendar tokens).

---

## Task 1: Expand CalendarManager fetch range to 7 days

**Files:**
- Modify: `electron/services/CalendarManager.ts`

**Step 1: Open the file and find `fetchEventsInternal()`**

Look for the date range block near the top of `fetchEventsInternal()`. It currently calls `nextBusinessDay(now)` and builds `endOfNext`.

**Step 2: Replace the range calculation**

Remove the `const next = nextBusinessDay(now)` and `endOfNext` lines. Replace with:

```typescript
const endOfWindow = new Date(now);
endOfWindow.setDate(endOfWindow.getDate() + 7);
endOfWindow.setHours(23, 59, 59, 999);
```

In the `params` object, change `timeMax: endOfNext.toISOString()` to:
```typescript
timeMax: endOfWindow.toISOString(),
```

**Step 3: Build electron**

```bash
npm run build:electron
```
Expected: exits 0, no TypeScript errors.

**Step 4: Commit**

```bash
git add electron/services/CalendarManager.ts
git commit -m "feat: expand calendar fetch range to 7 days for menu bar"
```

---

## Task 2: Add tray title countdown

**Files:**
- Modify: `electron/main.ts`

**Step 1: Add `trayTitleInterval` field and `updateTrayTitle()` method**

Find the `private tray: Tray | null = null` field declaration (~line 226). Add below it:
```typescript
private trayTitleInterval: ReturnType<typeof setInterval> | null = null;
```

Find `updateTrayMenu()` and add this new method directly before it:

```typescript
public updateTrayTitle(): void {
    if (!this.tray) return;
    const calMgr = CalendarManager.getInstance();
    calMgr.getUpcomingEvents().then(events => {
        if (!this.tray) return;
        const now = Date.now();
        const current = events.find(e =>
            new Date(e.startTime).getTime() <= now && new Date(e.endTime).getTime() > now
        );
        const next = events.find(e => new Date(e.startTime).getTime() > now);

        const truncate = (title: string) =>
            title.length > 28 ? title.slice(0, 28) + '…' : title;

        let title = '';
        if (current) {
            const mins = Math.round((new Date(current.endTime).getTime() - now) / 60000);
            title = `${truncate(current.title)} · ending ${mins}m`;
        } else if (next) {
            const mins = Math.round((new Date(next.startTime).getTime() - now) / 60000);
            if (mins < 60) {
                title = `${truncate(next.title)} · in ${mins}m`;
            } else {
                const hrs = Math.floor(mins / 60);
                const rem = mins % 60;
                title = `${truncate(next.title)} · in ${hrs}h${rem > 0 ? ` ${rem}m` : ''}`;
            }
        }
        this.tray!.setTitle(title);
    }).catch(() => {});
}
```

**Step 2: Start interval at end of `showTray()`**

Find the end of `showTray()` (after `this.updateTrayMenu()`). Add:

```typescript
this.updateTrayTitle();
if (this.trayTitleInterval) clearInterval(this.trayTitleInterval);
this.trayTitleInterval = setInterval(() => this.updateTrayTitle(), 30_000);
```

**Step 3: Clear interval in `hideTray()`**

In `hideTray()`, before `this.tray.destroy()` add:

```typescript
if (this.trayTitleInterval) {
    clearInterval(this.trayTitleInterval);
    this.trayTitleInterval = null;
}
```

**Step 4: Build**

```bash
npm run build:electron
```
Expected: exits 0.

**Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "feat: add tray title with next meeting countdown (30s updates)"
```

---

## Task 3: Create CalendarMenuBarHelper.ts

**Files:**
- Create: `electron/CalendarMenuBarHelper.ts`

**Step 1: Create the file**

```typescript
import { BrowserWindow, Tray, screen, app } from 'electron';
import path from 'path';

export class CalendarMenuBarHelper {
    private static win: BrowserWindow | null = null;

    public static toggle(tray: Tray): void {
        if (this.win && !this.win.isDestroyed()) {
            this.close();
        } else {
            this.open(tray);
        }
    }

    public static open(tray: Tray): void {
        if (this.win && !this.win.isDestroyed()) return;

        const trayBounds = tray.getBounds();
        const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });

        const width = 380;
        const height = 600;

        const x = Math.min(
            Math.round(trayBounds.x + trayBounds.width / 2 - width / 2),
            display.workArea.x + display.workArea.width - width
        );
        const y = Math.round(trayBounds.y + trayBounds.height + 4);

        const preloadPath = app.isPackaged
            ? path.join(process.resourcesPath, 'app.asar', 'dist-electron', 'electron', 'preload.js')
            : path.join(app.getAppPath(), 'dist-electron', 'electron', 'preload.js');

        this.win = new BrowserWindow({
            width,
            height,
            x,
            y,
            frame: false,
            resizable: false,
            movable: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            show: false,
            vibrancy: 'menu',
            visualEffectState: 'active',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: preloadPath,
            },
        });

        const indexPath = app.isPackaged
            ? path.join(process.resourcesPath, 'app.asar', 'dist', 'index.html')
            : path.join(app.getAppPath(), 'dist', 'index.html');

        this.win.loadURL(`file://${indexPath}?window=calendar-menubar`);

        this.win.once('ready-to-show', () => {
            this.win?.show();
        });

        this.win.on('blur', () => {
            this.close();
        });

        this.win.on('closed', () => {
            this.win = null;
        });
    }

    public static close(): void {
        if (this.win && !this.win.isDestroyed()) {
            this.win.close();
            this.win = null;
        }
    }

    public static getWindow(): BrowserWindow | null {
        return this.win && !this.win.isDestroyed() ? this.win : null;
    }
}
```

**Step 2: Commit**

```bash
git add electron/CalendarMenuBarHelper.ts
git commit -m "feat: add CalendarMenuBarHelper for tray popup window"
```

---

## Task 4: Wire tray left-click to open popup

**Files:**
- Modify: `electron/main.ts`

**Step 1: Import CalendarMenuBarHelper**

Near the top of `main.ts`, with the other local imports, add:
```typescript
import { CalendarMenuBarHelper } from './CalendarMenuBarHelper';
```

**Step 2: Replace tray click handler in `showTray()`**

Find:
```typescript
this.tray.on('double-click', () => {
    this.centerAndShowWindow()
})
```

Replace with:
```typescript
// Single click: toggle calendar popup
this.tray.on('click', () => {
    CalendarMenuBarHelper.toggle(this.tray!);
});
// Double-click: open main window directly
this.tray.on('double-click', () => {
    CalendarMenuBarHelper.close();
    this.centerAndShowWindow();
});
```

**Step 3: Build and commit**

```bash
npm run build:electron
git add electron/main.ts
git commit -m "feat: wire tray left-click to toggle calendar popup"
```

---

## Task 5: Add IPC handlers and preload bridges

**Files:**
- Modify: `electron/ipcHandlers.ts`
- Modify: `electron/preload.ts`

**Step 1: Import CalendarMenuBarHelper in ipcHandlers.ts**

At the top of `ipcHandlers.ts`, with other local imports:
```typescript
import { CalendarMenuBarHelper } from './CalendarMenuBarHelper';
```

**Step 2: Add IPC handlers**

Find a logical location (e.g., near the existing calendar IPC handlers). Add:

```typescript
// ── Menu bar calendar popup ──────────────────────────────────────────────
safeHandle("menubar:get-events", async () => {
    const calMgr = CalendarManager.getInstance();
    return calMgr.getUpcomingEvents();
});

safeHandle("menubar:open-calendar-event", async (_, eventId: string) => {
    CalendarMenuBarHelper.close();
    const launcherWin = appState.getWindowHelper().getLauncherWindow();
    if (launcherWin && !launcherWin.isDestroyed()) {
        launcherWin.show();
        launcherWin.focus();
        setTimeout(() => {
            launcherWin.webContents.send('open-calendar-event', { calendarEventId: eventId });
        }, 150);
    }
});

safeHandle("menubar:focus-main", async () => {
    CalendarMenuBarHelper.close();
    const launcherWin = appState.getWindowHelper().getLauncherWindow();
    if (launcherWin && !launcherWin.isDestroyed()) {
        launcherWin.show();
        launcherWin.focus();
    }
});
```

**Step 3: Add preload bridges**

In `electron/preload.ts`, find the `contextBridge.exposeInMainWorld('electronAPI', {` block. Add these entries (near the calendar section):

```typescript
// Menu bar calendar popup
menubarGetEvents: (): Promise<any[]> => ipcRenderer.invoke('menubar:get-events'),
menubarOpenCalendarEvent: (eventId: string) => ipcRenderer.invoke('menubar:open-calendar-event', eventId),
menubarFocusMain: () => ipcRenderer.invoke('menubar:focus-main'),
```

Also add the TypeScript type declarations. Find the interface/type block at the top of preload.ts (around line 128 where `onMeetingsUpdated` is declared) and add:

```typescript
menubarGetEvents: () => Promise<any[]>
menubarOpenCalendarEvent: (eventId: string) => Promise<void>
menubarFocusMain: () => Promise<void>
```

Also add the `open-calendar-event` listener bridge (same pattern as `onMeetingsUpdated`):

In the type declarations:
```typescript
onOpenCalendarEvent: (callback: (event: any, data: { calendarEventId: string }) => void) => () => void
```

In the implementation:
```typescript
onOpenCalendarEvent: (callback: (event: any, data: { calendarEventId: string }) => void) => {
    ipcRenderer.on('open-calendar-event', callback);
    return () => {
        ipcRenderer.removeListener('open-calendar-event', callback);
    };
},
```

**Step 4: Build**

```bash
npm run build:electron
```
Expected: exits 0.

**Step 5: Commit**

```bash
git add electron/ipcHandlers.ts electron/preload.ts
git commit -m "feat: add menubar IPC handlers and preload bridges"
```

---

## Task 6: Add open-calendar-event listener in Launcher.tsx

**Files:**
- Modify: `src/components/Launcher.tsx`

**Step 1: Add IPC listener in the main `useEffect`**

In `Launcher.tsx`, find the `useEffect` block at ~line 154 that sets up multiple listeners (undetectable, meeting state, etc.). At the end of that block (before the `return () => {...}` cleanup), add:

```typescript
// Menu bar: open a calendar event → DealDetails
let removeOpenCalendarEvent: (() => void) | undefined;
if (window.electronAPI?.onOpenCalendarEvent) {
    removeOpenCalendarEvent = window.electronAPI.onOpenCalendarEvent((_evt, data) => {
        handleOpenUpcomingMeeting({ id: data.calendarEventId, title: '', startTime: new Date().toISOString() });
    });
}
```

In the cleanup `return () => {...}` at the end of that same useEffect, add:
```typescript
removeOpenCalendarEvent?.();
```

**Step 2: Build renderer**

```bash
npm run build
```
Expected: exits 0, no TypeScript errors.

**Step 3: Commit**

```bash
git add src/components/Launcher.tsx
git commit -m "feat: handle open-calendar-event in Launcher for DealDetails navigation"
```

---

## Task 7: Create CalendarMenuBar React component and add route

**Files:**
- Create: `src/components/CalendarMenuBar.tsx`
- Modify: `src/App.tsx`

**Step 1: Create CalendarMenuBar.tsx**

```tsx
import React, { useEffect, useState } from 'react';

interface CalendarEvent {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    colorHex: string | null;
    attendees: Array<{ email: string; responseStatus: string }>;
}

function formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function getDayLabel(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const eventDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (eventDay.getTime() === today.getTime()) return 'Today';
    if (eventDay.getTime() === tomorrow.getTime()) return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function hasDeclinedAttendee(event: CalendarEvent): boolean {
    return event.attendees.some(a => a.responseStatus === 'declined');
}

const EventRow: React.FC<{
    event: CalendarEvent;
    isNext?: boolean;
    onClick: (id: string) => void;
}> = ({ event, isNext = false, onClick }) => {
    const [hovered, setHovered] = React.useState(false);
    const declined = hasDeclinedAttendee(event);
    const barColor = event.colorHex || '#4A90D9';

    return (
        <div
            onClick={() => onClick(event.id)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '5px 16px',
                cursor: 'pointer',
                borderRadius: 4,
                background: hovered ? 'rgba(0,0,0,0.06)' : 'transparent',
                transition: 'background 0.1s',
            }}
        >
            <div style={{ width: 3, height: 16, borderRadius: 2, background: barColor, flexShrink: 0 }} />
            {declined && <span style={{ fontSize: 11 }}>⚠️</span>}
            <span style={{
                fontSize: 13,
                color: '#1a1a1a',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
            }}>
                {formatTime(event.startTime)} · {event.title}
            </span>
            {isNext && <span style={{ fontSize: 13, color: '#aaa' }}>›</span>}
        </div>
    );
};

const SectionHeader: React.FC<{ label: string }> = ({ label }) => (
    <div style={{ padding: '8px 16px 3px', color: '#888', fontSize: 12, fontWeight: 500 }}>
        {label}
    </div>
);

const BottomRow: React.FC<{ label: string; shortcut?: string; onClick: () => void }> = ({ label, shortcut, onClick }) => {
    const [hovered, setHovered] = React.useState(false);
    return (
        <div
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 16px',
                fontSize: 13,
                color: '#1a1a1a',
                cursor: 'pointer',
                background: hovered ? 'rgba(0,0,0,0.06)' : 'transparent',
            }}
        >
            <span>{label}</span>
            {shortcut && <span style={{ fontSize: 11, color: '#aaa' }}>{shortcut}</span>}
        </div>
    );
};

export default function CalendarMenuBar() {
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (window as any).electronAPI?.menubarGetEvents?.()
            .then((evts: CalendarEvent[]) => {
                setEvents(evts || []);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const now = Date.now();
    const current = events.find(e =>
        new Date(e.startTime).getTime() <= now && new Date(e.endTime).getTime() > now
    );
    const upcoming = events.filter(e => new Date(e.startTime).getTime() > now);
    const next = upcoming[0];
    const rest = upcoming.slice(current ? 0 : 1); // if there's a current meeting, all upcoming go to rest

    // Group rest by day
    const grouped: { label: string; events: CalendarEvent[] }[] = [];
    for (const event of rest) {
        const label = getDayLabel(event.startTime);
        const g = grouped.find(x => x.label === label);
        if (g) g.events.push(event);
        else grouped.push({ label, events: [event] });
    }

    const countdownLabel = (() => {
        if (current) {
            const mins = Math.round((new Date(current.endTime).getTime() - now) / 60000);
            return `Ending in ${mins} min`;
        }
        if (next) {
            const mins = Math.round((new Date(next.startTime).getTime() - now) / 60000);
            return `Upcoming in ${mins} min`;
        }
        return null;
    })();

    const handleEventClick = (eventId: string) => {
        (window as any).electronAPI?.menubarOpenCalendarEvent?.(eventId);
    };

    return (
        <div style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
            background: 'rgba(242,242,242,0.96)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderRadius: 12,
            boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
            overflow: 'hidden',
            minWidth: 360,
            maxHeight: 580,
            overflowY: 'auto',
            paddingTop: 6,
            paddingBottom: 0,
            WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}>

            {loading && (
                <div style={{ padding: 20, color: '#999', fontSize: 13, textAlign: 'center' }}>
                    Loading…
                </div>
            )}

            {!loading && (
                <>
                    {/* Countdown + featured event */}
                    {countdownLabel && (
                        <SectionHeader label={countdownLabel} />
                    )}
                    {current && <EventRow event={current} isNext onClick={handleEventClick} />}
                    {!current && next && <EventRow event={next} isNext onClick={handleEventClick} />}

                    {/* Grouped remaining events */}
                    {grouped.map(group => (
                        <React.Fragment key={group.label}>
                            <SectionHeader label={group.label} />
                            {group.events.map(e => (
                                <EventRow key={e.id} event={e} onClick={handleEventClick} />
                            ))}
                        </React.Fragment>
                    ))}

                    {events.length === 0 && (
                        <div style={{ padding: '12px 16px', color: '#999', fontSize: 13 }}>
                            No upcoming meetings
                        </div>
                    )}
                </>
            )}

            {/* Bottom bar */}
            <div style={{ borderTop: '1px solid rgba(0,0,0,0.1)', marginTop: 8 }}>
                <BottomRow
                    label="Natively"
                    shortcut="⌘1"
                    onClick={() => (window as any).electronAPI?.menubarFocusMain?.()}
                />
                <BottomRow
                    label="Settings…"
                    shortcut="⌘,"
                    onClick={() => (window as any).electronAPI?.openSettingsWindow?.()}
                />
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.1)', marginTop: 2 }}>
                    <BottomRow
                        label="Quit Natively Completely"
                        onClick={() => (window as any).electronAPI?.quitApp?.()}
                    />
                </div>
            </div>
        </div>
    );
}
```

**Step 2: Add route in App.tsx**

In `src/App.tsx`, find the block where `isSettingsWindow`, `isLauncherWindow`, etc. are declared. Add:

```typescript
const isCalendarMenubarWindow = new URLSearchParams(window.location.search).get('window') === 'calendar-menubar';
```

Update the `isDefault` line to also exclude this window:
```typescript
const isDefault = !isSettingsWindow && !isOverlayWindow && !isModelSelectorWindow && !isCropperWindow && !isScriptHelperWindow && !isMeetingPopupWindow && !isCalendarMenubarWindow;
```

Add the import at the top:
```typescript
import CalendarMenuBar from './components/CalendarMenuBar';
```

Then find the early-return pattern for other window types (e.g., `if (isCropperWindow) { ... }`) and add before them:

```typescript
if (isCalendarMenubarWindow) {
    return (
        <QueryClientProvider client={queryClient}>
            <CalendarMenuBar />
        </QueryClientProvider>
    );
}
```

**Step 3: Build renderer**

```bash
npm run build
```
Expected: exits 0, no TypeScript errors.

**Step 4: Commit**

```bash
git add src/components/CalendarMenuBar.tsx src/App.tsx
git commit -m "feat: add CalendarMenuBar component and ?window=calendar-menubar route"
```

---

## Task 8: Full build, pack, swap, and verify

**Step 1: Run the full rebuild workflow**

```bash
cd /Users/jamesleylane/Projects/natively-cluely-ai-assistant
osascript -e 'quit app "Natively"'
npm run build && npm run build:electron
rm -rf /tmp/rebuild-staging
./node_modules/.bin/asar extract /Applications/Natively.app/Contents/Resources/app.asar /tmp/rebuild-staging
rm -rf /tmp/rebuild-staging/dist && cp -R dist /tmp/rebuild-staging/dist
rm -rf /tmp/rebuild-staging/dist-electron/electron && cp -R dist-electron/electron /tmp/rebuild-staging/dist-electron/electron
cp "/Applications/Natively.app/Contents/Resources/app.asar" "/Applications/Natively.app/Contents/Resources/app.asar.backup-$(date +%Y%m%d-%H%M%S).bak"
./node_modules/.bin/asar pack /tmp/rebuild-staging /tmp/rebuild-app.asar --unpack "*.{node,dylib}"
cp /tmp/rebuild-app.asar /Applications/Natively.app/Contents/Resources/app.asar
open -a "Natively"
```

**DO NOT run codesign.** Screen Recording permission may need manual toggle in System Settings after rebuild — that's a macOS TCC limitation, not a bug.

**Step 2: Verify checklist**

- [ ] Menu bar shows next meeting name + countdown (e.g., `"Meeting... · in 12m"`) beside Natively icon
- [ ] Left-clicking tray icon opens the popup dropdown
- [ ] Clicking tray icon again closes the popup
- [ ] Clicking outside the popup closes it
- [ ] Events grouped correctly: countdown section → Today → Tomorrow → future dates
- [ ] ⚠️ shows on events where a guest has `declined`
- [ ] Clicking an event: popup closes, Natively main window focuses, DealDetails opens (or MeetingDetails if no linked contact)
- [ ] "Natively" bottom row focuses main window
- [ ] "Settings…" opens Settings
- [ ] "Quit Natively Completely" quits the app
- [ ] Double-clicking tray icon still opens main window directly
- [ ] Tray title updates every 30s
