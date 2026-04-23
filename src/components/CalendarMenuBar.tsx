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

function fetchEvents(setEvents: (e: CalendarEvent[]) => void, setLoading?: (v: boolean) => void) {
    (window as any).electronAPI?.menubarGetEvents?.()
        .then((evts: CalendarEvent[]) => {
            setEvents(evts || []);
            setLoading?.(false);
        })
        .catch(() => setLoading?.(false));
}

export default function CalendarMenuBar() {
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Initial load
        fetchEvents(setEvents, setLoading);

        // Refresh signal from main process when popup is shown — no loading spinner
        const cleanup = (window as any).electronAPI?.onMenubarRefresh?.(() => {
            fetchEvents(setEvents);
        });
        return () => cleanup?.();
    }, []);

    const now = Date.now();
    const current = events.find(e =>
        new Date(e.startTime).getTime() <= now && new Date(e.endTime).getTime() > now
    );
    const upcoming = events.filter(e => new Date(e.startTime).getTime() > now);
    const next = upcoming[0];
    const rest = current ? upcoming : upcoming.slice(1);

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
                    {countdownLabel && (
                        <SectionHeader label={countdownLabel} />
                    )}
                    {current && <EventRow event={current} isNext onClick={handleEventClick} />}
                    {!current && next && <EventRow event={next} isNext onClick={handleEventClick} />}

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
