import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useV3Tokens } from '../hooks/useV3Tokens';

interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  colorId?: string | null;
  colorHex: string | null;
  attendees: Array<{ email: string; responseStatus: string; self: boolean; name?: string | null }>;
  // New fields (Task #7):
  calendarKind?: 'scalable' | 'matria' | 'family' | 'other';
  eventType?: 'demo' | 'discovery' | 'followup' | 'appointment' | 'school' | 'task' | 'fun' | 'fyi' | 'other';
  attendeeContactName?: string | null;
  attendeeCompany?: string | null;
  isAllDay?: boolean;
  // Task #15: block detection
  isBlock?: boolean;
  blockKind?: 'am_out' | 'pm_out' | 'sat_out' | 'sun_out' | 'other_block' | null;
}

interface WeekViewProps {
  isLight: boolean;
  onEventClick: (event: CalendarEvent) => void;
}

// Muted GCAL Colors
const MUTED_GCAL: Record<string, string> = {
  "1": "#BBB4D6",  // Lavender
  "2": "#A6BFA0",  // Sage
  "3": "#B79EC7",  // Grape
  "4": "#D6928E",  // Flamingo
  "5": "#D9C28A",  // Banana
  "6": "#C99B6E",  // Tangerine
  "7": "#6E9CA0",  // Peacock
  "8": "#9C9C9C",  // Graphite
  "9": "#6F87B5",  // Blueberry
  "10": "#7A9C70", // Basil
  "11": "#B8625A", // Tomato
};

function mutedColorFor(colorId: string | null | undefined, fallback: string | null): string {
  if (colorId && MUTED_GCAL[colorId]) return MUTED_GCAL[colorId];
  return fallback || '#6F87B5';
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function format12HourTime(hour: number): string {
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

const AM_OUT_PHRASES = ['am out', 'morning meeting block'];
const PM_OUT_PHRASES = ['pm out'];

function computeTimeRange(events: CalendarEvent[]): { startHour: number; endHour: number } {
  // Only real events drive the time range. Blocks (am out / pm out / do not book / etc.)
  // and all-day items are excluded — they exist as boundary lines but don't expand the grid.
  const timed = events.filter(e => !e.isAllDay && !e.isBlock);
  if (timed.length === 0) return { startHour: 7, endHour: 21 };

  const startCandidates = timed
    .filter(e => !AM_OUT_PHRASES.some(p => (e.title || '').toLowerCase().includes(p)))
    .map(e => new Date(e.startTime).getHours());
  const endCandidates = timed
    .filter(e => !PM_OUT_PHRASES.some(p => (e.title || '').toLowerCase().includes(p)))
    .map(e => Math.ceil((new Date(e.endTime).getHours() + new Date(e.endTime).getMinutes() / 60)));

  const startHour = startCandidates.length ? Math.max(0, Math.min(...startCandidates)) : 7;
  const endHour   = endCandidates.length ? Math.min(24, Math.max(...endCandidates)) : 21;

  // Safety: ensure at least a 4-hour window
  if (endHour - startHour < 4) return { startHour: Math.max(0, startHour - 1), endHour: startHour + 4 };
  return { startHour, endHour };
}

const TZ_COLUMNS: Array<{ label: string; tz: string }> = [
  { label: 'PST', tz: 'America/Los_Angeles' },
  { label: 'EST', tz: 'America/New_York' },
  { label: 'CST', tz: 'America/Chicago' },
];

function hourInTz(localHour: number, tz: string, weekStart: Date): string {
  const d = new Date(weekStart);
  d.setHours(localHour, 0, 0, 0);
  const fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: true, timeZone: tz });
  const formatted = fmt.format(d);
  return formatted.replace(/[^\d APM]/g, '').trim();
}

function getGuestStatus(event: CalendarEvent): 'declined' | 'needsAction' | 'accepted' | 'none' {
  const guests = event.attendees.filter(a => !a.self);
  if (guests.length === 0) return 'none';
  if (guests.some(a => a.responseStatus === 'declined')) return 'declined';
  if (guests.some(a => a.responseStatus === 'needsAction')) return 'needsAction';
  return 'accepted';
}

function daysBetween(start: Date, end: Date): number {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.floor((end.getTime() - start.getTime()) / oneDay);
}

const RSVP_ICON: Record<string, string> = {
  declined: '⚠️',
  needsAction: '□',
  accepted: '☑',
};

export const WeekView: React.FC<WeekViewProps> = ({ onEventClick }) => {
  const v3 = useV3Tokens();
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day;
    const sunday = new Date(today.setDate(diff));
    sunday.setHours(0, 0, 0, 0);
    return sunday;
  });

  const [viewMode, setViewMode] = useState<'7' | '5' | '3' | 'agenda'>('7');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hourPx, setHourPx] = useState(48);
  const [currentTime, setCurrentTime] = useState(new Date());
  const gridContainerRef = React.useRef<HTMLDivElement>(null);
  const timeGridRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  // For 3-day mode, always fetch from today's week so events are current
  const fetchWeekStart = (viewMode === '3' || viewMode === 'agenda') ? (() => {
    const now = new Date();
    const diff = now.getDate() - now.getDay();
    const sun = new Date(now.setDate(diff));
    sun.setHours(0, 0, 0, 0);
    return sun;
  })() : weekStart;

  useEffect(() => {
    setLoading(true);
    (window as any).electronAPI?.weekviewGetEvents?.({
      weekStartIso: fetchWeekStart.toISOString(),
      mode: 'everything',
    })
      .then((evts: CalendarEvent[]) => {
        setEvents(evts || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [weekStart, viewMode]);

  // Dynamic hour height — observe the time grid itself so no manual offset math is needed
  useEffect(() => {
    if (!timeGridRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      const h = timeGridRef.current?.clientHeight ?? 0;
      if (h === 0) return;
      const { startHour, endHour } = computeTimeRange(events);
      const hourCount = endHour - startHour;
      const computed = Math.max(24, Math.floor(h / hourCount));
      setHourPx(computed);
    });

    resizeObserver.observe(timeGridRef.current);
    return () => resizeObserver.disconnect();
  }, [events]);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const handlePrev = () => {
    setWeekStart(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  };

  const handleNext = () => {
    setWeekStart(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  };

  const handleThisWeek = () => {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day;
    const sunday = new Date(today.setDate(diff));
    sunday.setHours(0, 0, 0, 0);
    setWeekStart(sunday);
  };

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const daysInWeek: Date[] = (() => {
    const allDays: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      allDays.push(d);
    }
    if (viewMode === '5') return allDays.slice(1, 6); // Mon–Fri
    if (viewMode === '3' || viewMode === 'agenda') {
      const anchor = new Date();
      anchor.setHours(0, 0, 0, 0);
      return [0, 1, 2].map(n => {
        const d = new Date(anchor);
        d.setDate(d.getDate() + n);
        return d;
      });
    }
    return allDays; // '7': Sun–Sat
  })();

  const dateRangeLabel = (() => {
    if (viewMode === '3' || viewMode === 'agenda') {
      const d0 = daysInWeek[0];
      const d2 = daysInWeek[2];
      return `${d0.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${d2.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    }
    const startStr = daysInWeek[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = daysInWeek[daysInWeek.length - 1].toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${startStr} – ${endStr}`;
  })();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const eventsByDay: Record<number, CalendarEvent[]> = {};
  daysInWeek.forEach((_, idx) => {
    eventsByDay[idx] = [];
  });

  const timedEvents: CalendarEvent[] = [];
  const blockEvents: CalendarEvent[] = [];
  const allDayEvents: CalendarEvent[] = [];

  events.forEach(event => {
    if (event.isAllDay && !event.isBlock) {
      allDayEvents.push(event);
    } else if (event.isBlock && !event.isAllDay) {
      blockEvents.push(event);
    } else if (!event.isAllDay && !event.isBlock) {
      timedEvents.push(event);
      const eventDate = new Date(event.startTime);
      eventDate.setHours(0, 0, 0, 0);
      const dayIdx = daysInWeek.findIndex(d => d.getTime() === eventDate.getTime());
      if (dayIdx !== -1) {
        eventsByDay[dayIdx].push(event);
      }
    }
  });

  // Track which days have all-day weekend blocks
  const weekendBlockDays = new Set<number>();
  blockEvents.forEach(block => {
    if (block.isAllDay && (block.blockKind === 'sat_out' || block.blockKind === 'sun_out')) {
      const blockDate = new Date(block.startTime);
      blockDate.setHours(0, 0, 0, 0);
      const dayIdx = daysInWeek.findIndex(d => d.getTime() === blockDate.getTime());
      if (dayIdx !== -1) {
        weekendBlockDays.add(dayIdx);
      }
    }
  });

  const computeOverlapGroups = (dayEvents: CalendarEvent[]): Map<string, CalendarEvent[]> => {
    const groups = new Map<string, CalendarEvent[]>();
    const sortedEvents = [...dayEvents].sort((a, b) =>
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

    for (const event of sortedEvents) {
      const eventStart = new Date(event.startTime).getTime();
      const eventEnd = new Date(event.endTime).getTime();
      let foundGroup = false;

      for (const [groupId, groupEvents] of groups) {
        const groupOverlaps = groupEvents.some(ge => {
          const geStart = new Date(ge.startTime).getTime();
          const geEnd = new Date(ge.endTime).getTime();
          return !(eventEnd <= geStart || eventStart >= geEnd);
        });
        if (groupOverlaps) {
          groupEvents.push(event);
          foundGroup = true;
          break;
        }
      }

      if (!foundGroup) {
        groups.set(`group-${Date.now()}-${Math.random()}`, [event]);
      }
    }

    return groups;
  };

  // Compute dynamic time range
  const { startHour, endHour } = computeTimeRange(events);
  const hourCount = endHour - startHour;
  const totalHeightPx = hourCount * hourPx;

  // Is the viewed week the current week?
  const isViewingCurrentWeek = (() => {
    const weekEndDate = new Date(weekStart);
    weekEndDate.setDate(weekEndDate.getDate() + 6);
    weekEndDate.setHours(23, 59, 59, 999);
    return currentTime >= weekStart && currentTime <= weekEndDate;
  })();

  return (
    <div style={{ borderRadius: 12, border: `1px solid ${v3.borderLight}`, background: 'transparent', overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%', fontFamily: v3.fontSans, width: '100%' }}>
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${v3.borderLight}`, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: v3.bg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {viewMode !== '3' && viewMode !== 'agenda' && (
            <button
              onClick={handlePrev}
              style={{ padding: 8, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              onMouseEnter={e => e.currentTarget.style.background = v3.surface}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <ChevronLeft size={20} color={v3.textMuted} />
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: v3.dark }}>{dateRangeLabel}</span>
            {viewMode !== '3' && viewMode !== 'agenda' && (
              <button
                onClick={handleThisWeek}
                style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: v3.textMuted, transition: 'background 0.2s' }}
                onMouseEnter={e => e.currentTarget.style.background = v3.surface}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                This Week
              </button>
            )}
          </div>
          {viewMode !== '3' && viewMode !== 'agenda' && (
            <button
              onClick={handleNext}
              style={{ padding: 8, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              onMouseEnter={e => e.currentTarget.style.background = v3.surface}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <ChevronRight size={20} color={v3.textMuted} />
            </button>
          )}
        </div>

        {/* View Mode Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 4, borderRadius: 999, background: v3.surface }}>
          {(['7', '5', '3', 'agenda'] as const).map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 999,
                border: 'none',
                cursor: 'pointer',
                background: viewMode === m ? v3.dark : 'transparent',
                color: viewMode === m ? v3.bg : v3.textMuted,
                transition: 'all 0.2s',
              }}
            >
              {m === '7' ? '7d' : m === '5' ? '5d' : m === '3' ? '3d' : 'Agenda'}
            </button>
          ))}
        </div>
      </div>

      {/* Agenda View */}
      {viewMode === 'agenda' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 28 }}>
          {[0, 1].map(dayOffset => {
            const date = daysInWeek[dayOffset];
            const isToday = dayOffset === 0;
            const dayLabel = isToday ? 'Today' : 'Tomorrow';
            const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            const dayEvts = events
              .filter(e => {
                if (e.isAllDay || e.isBlock) return false;
                const d = new Date(e.startTime);
                d.setHours(0, 0, 0, 0);
                return d.getTime() === date.getTime();
              })
              .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

            return (
              <div key={dayOffset}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: isToday ? v3.dark : v3.textMuted, letterSpacing: 0.1 }}>{dayLabel}</span>
                  <span style={{ fontSize: 11, color: v3.textMuted }}>{dateStr}</span>
                </div>
                {dayEvts.length === 0 ? (
                  <div style={{ fontSize: 13, color: v3.textMuted, fontStyle: 'italic' }}>No meetings</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {dayEvts.map(event => {
                      const bgColor = event.calendarKind === 'matria' ? '#B8AC97' : mutedColorFor(event.colorId, event.colorHex);
                      const isBanana = event.colorId === '5';
                      const titleLine = isBanana ? event.title : (event.attendeeContactName || event.title);
                      const isPast = isToday && new Date(event.endTime) < currentTime;
                      let displayedEventType = event.eventType;
                      if (event.calendarKind === 'scalable' && (!displayedEventType || displayedEventType === 'other')) {
                        const hasExternal = event.attendees.some((a: any) => !a.self);
                        if (hasExternal) displayedEventType = 'discovery';
                      }
                      const pillColors = (() => {
                        if (event.calendarKind === 'scalable') return { bg: '#7A9C70', fg: '#FFFFFF' };
                        if (event.calendarKind === 'matria')   return { bg: '#B8AC97', fg: '#1B1B1B' };
                        switch (displayedEventType) {
                          case 'appointment': return { bg: '#6F87B5', fg: '#FFFFFF' };
                          case 'school':      return { bg: '#BBB4D6', fg: '#1B1B1B' };
                          case 'task':        return { bg: '#C99B6E', fg: '#FFFFFF' };
                          case 'fun':         return { bg: '#B8625A', fg: '#FFFFFF' };
                          case 'fyi':         return { bg: '#D9C28A', fg: '#1B1B1B' };
                          default:            return { bg: '#9C9C9C', fg: '#FFFFFF' };
                        }
                      })();
                      const pillLabelMap = { demo: 'Demo', discovery: 'Disc', followup: 'Fup', appointment: 'Appt', school: 'School', task: 'Task', fun: 'Fun', fyi: 'FYI' } as const;
                      const pillLabel = displayedEventType && displayedEventType in pillLabelMap ? pillLabelMap[displayedEventType as keyof typeof pillLabelMap] : '';
                      const guestStatus = getGuestStatus(event);
                      const rsvpIcon = guestStatus !== 'none' ? RSVP_ICON[guestStatus] : '';

                      return (
                        <div
                          key={event.id}
                          onClick={() => onEventClick(event)}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 14,
                            padding: '10px 14px',
                            borderRadius: 10,
                            background: v3.surface,
                            cursor: 'pointer',
                            borderLeft: `3px solid ${bgColor}`,
                            opacity: isPast ? 0.45 : 1,
                            transition: 'opacity 0.3s',
                          }}
                        >
                          <div style={{ minWidth: 72, flexShrink: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, color: v3.dark }}>{formatTime(event.startTime)}</div>
                            <div style={{ fontSize: 11, color: v3.textMuted }}>{formatTime(event.endTime)}</div>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: v3.dark, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {rsvpIcon && <span>{rsvpIcon} </span>}
                              {titleLine}
                            </div>
                            {event.attendeeCompany && event.calendarKind !== 'family' && !isBanana && (
                              <div style={{ fontSize: 11, color: v3.textMuted, marginTop: 2 }}>{event.attendeeCompany}</div>
                            )}
                            {pillLabel && (
                              <div style={{ display: 'inline-block', marginTop: 5, padding: '1px 6px', borderRadius: 999, background: pillColors.bg, color: pillColors.fg, fontSize: 9, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                                {pillLabel}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Grid — Always Render Scaffold */}
      {viewMode !== 'agenda' && <div ref={gridContainerRef} style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative', width: '100%' }}>
          {/* Day Headers */}
          <div style={{ display: 'flex', alignItems: 'stretch', position: 'sticky', top: 0, zIndex: 10, background: 'transparent', borderBottom: `1px solid ${v3.borderLight}` }}>
            {/* Timezone Column Headers */}
            <div style={{ display: 'flex', flexShrink: 0 }}>
              {TZ_COLUMNS.map(({ label }) => (
                <div
                  key={label}
                  style={{
                    width: 36,
                    flexShrink: 0,
                    borderRight: `1px solid ${v3.borderLight}`,
                    background: v3.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                    color: v3.textMuted,
                    minHeight: 44,
                  }}
                >
                  {label}
                </div>
              ))}
            </div>
            {daysInWeek.map((dayDate, idx) => {
              const isToday = dayDate.getTime() === today.getTime();
              return (
                <div
                  key={idx}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    borderRight: `1px solid ${v3.borderLight}`,
                    fontSize: 12,
                    fontWeight: 500,
                    background: v3.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 44,
                  }}
                >
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      padding: isToday ? '3px 10px' : 0,
                      background: isToday ? v3.dark : 'transparent',
                      borderRadius: isToday ? 12 : 0,
                    }}
                  >
                    <span style={{ color: isToday ? v3.bg : v3.dark, fontWeight: isToday ? 600 : 400 }}>
                      {dayLabels[dayDate.getDay()]}
                    </span>
                    <span style={{ color: isToday ? `${v3.bg}99` : v3.textMuted, fontSize: 10 }}>|</span>
                    <span style={{ color: isToday ? v3.bg : v3.dark, fontWeight: isToday ? 600 : 400 }}>
                      {dayDate.getDate()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Time Grid */}
          <div ref={timeGridRef} style={{ display: 'flex', flex: 1, overflow: 'hidden', width: '100%' }}>
            {/* Timezone Columns (serve as time axis) */}
            <div style={{ display: 'flex', flexShrink: 0 }}>
              {TZ_COLUMNS.map(({ label, tz }) => (
                <div
                  key={label}
                  style={{
                    width: 36,
                    flexShrink: 0,
                    borderRight: `1px solid ${v3.borderLight}`,
                    background: v3.bg,
                  }}
                >
                  {Array.from({ length: hourCount }).map((_, idx) => (
                    <div
                      key={idx}
                      style={{
                        height: hourPx,
                        borderBottom: `1px solid ${v3.borderLight}`,
                        fontSize: 9,
                        color: v3.textMuted,
                        lineHeight: 1,
                        textAlign: 'right',
                        paddingRight: 4,
                        paddingTop: 2,
                      }}
                    >
                      {hourInTz(startHour + idx, tz, weekStart)}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Day Columns */}
            {daysInWeek.map((_, dayIdx) => {
              const dayEvents = eventsByDay[dayIdx] || [];
              const overlapGroups = computeOverlapGroups(dayEvents);

              return (
                <div
                  key={dayIdx}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    borderRight: `1px solid ${v3.borderLight}`,
                    position: 'relative',
                    minHeight: `${totalHeightPx}px`,
                    background: v3.bg,
                  }}
                >
                  {/* Weekend background tint for all-day blocks */}
                  {weekendBlockDays.has(dayIdx) && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'rgba(27,27,27,0.04)',
                        zIndex: 0,
                      }}
                    />
                  )}

                  {/* Hour Grid Lines */}
                  {Array.from({ length: hourCount }).map((_, idx) => (
                    <div
                      key={idx}
                      style={{
                        position: 'absolute',
                        width: '100%',
                        borderBottom: `1px solid ${v3.borderLight}`,
                        top: `${idx * hourPx}px`,
                        height: `${hourPx}px`,
                      }}
                    ></div>
                  ))}

                  {/* Events */}
                  {Array.from(overlapGroups.values()).map((groupEvents) => {
                    const groupSize = groupEvents.length;
                    return groupEvents.map((event, eventIdx) => {
                      const eventStartDate = new Date(event.startTime);
                      const eventEndDate = new Date(event.endTime);
                      const eventStartHour = eventStartDate.getHours();
                      const eventStartMinute = eventStartDate.getMinutes();
                      const durationMins = (eventEndDate.getTime() - eventStartDate.getTime()) / 60000;

                      const topPx = (eventStartHour - startHour) * hourPx + (eventStartMinute / 60) * hourPx;
                      const heightPx = Math.max((durationMins / 60) * hourPx, 22);
                      const guestStatus = getGuestStatus(event);
                      // Task E: Matria warm greige override
                      const bgColor = event.calendarKind === 'matria' ? '#B8AC97' : mutedColorFor(event.colorId, event.colorHex);

                      // New event card content
                      // Task C: Scalable fallback discovery for events with external attendees
                      let displayedEventType = event.eventType;
                      if (event.calendarKind === 'scalable' && (!displayedEventType || displayedEventType === 'other')) {
                        const hasExternalAttendees = event.attendees.some((a: any) => !a.self);
                        if (hasExternalAttendees) displayedEventType = 'discovery';
                      }

                      // Task D: Banana title rule
                      const isBanana = event.colorId === '5';
                      const titleLine = isBanana ? event.title : (event.attendeeContactName || event.title);
                      const companyLine = event.attendeeCompany;
                      const showPill = displayedEventType && displayedEventType !== 'other' && heightPx >= 36;
                      const showCompany = !isBanana && companyLine && event.calendarKind !== 'family' && heightPx >= 50;

                      const pillColors = (() => {
                        if (event.calendarKind === 'scalable') return { bg: '#7A9C70', fg: '#FFFFFF' };
                        if (event.calendarKind === 'matria')   return { bg: '#B8AC97', fg: '#1B1B1B' };
                        switch (displayedEventType) {
                          case 'appointment': return { bg: '#6F87B5', fg: '#FFFFFF' };
                          case 'school':      return { bg: '#BBB4D6', fg: '#1B1B1B' };
                          case 'task':        return { bg: '#C99B6E', fg: '#FFFFFF' };
                          case 'fun':         return { bg: '#B8625A', fg: '#FFFFFF' };
                          case 'fyi':         return { bg: '#D9C28A', fg: '#1B1B1B' };
                          default:            return { bg: '#9C9C9C', fg: '#FFFFFF' };
                        }
                      })();

                      const pillLabelMap = { demo: 'Demo', discovery: 'Disc', followup: 'Fup', appointment: 'Appt', school: 'School', task: 'Task', fun: 'Fun', fyi: 'FYI' } as const;
                      const pillLabel = displayedEventType && displayedEventType in pillLabelMap ? pillLabelMap[displayedEventType as keyof typeof pillLabelMap] : '';
                      const rsvpIcon = guestStatus !== 'none' ? RSVP_ICON[guestStatus] : '';

                      const isPast = isViewingCurrentWeek && new Date(event.endTime) < currentTime;

                      return (
                        <div
                          key={event.id}
                          onClick={() => onEventClick(event)}
                          style={{
                            position: 'absolute',
                            cursor: 'pointer',
                            top: `${topPx}px`,
                            height: `${heightPx}px`,
                            left: `${(eventIdx / groupSize) * 100}%`,
                            width: `${(1 / groupSize) * 100}%`,
                            padding: 0,
                            zIndex: 20,
                            opacity: isPast ? 0.35 : 1,
                            transition: 'opacity 0.3s',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: '100%',
                              overflow: 'hidden',
                              background: `${bgColor}30`,
                              borderLeft: `3px solid ${bgColor}`,
                              borderRadius: 6,
                              padding: '3px 6px',
                              fontFamily: v3.fontSans,
                              boxSizing: 'border-box',
                            }}
                          >
                            <div style={{ fontSize: 11, fontWeight: 600, color: v3.dark, lineHeight: 1.2, whiteSpace: 'normal', wordBreak: 'break-word', overflow: 'hidden' }}>
                              {rsvpIcon && <span>{rsvpIcon} </span>}
                              {titleLine}
                            </div>
                            {showCompany && (
                              <div style={{ fontSize: 10, color: v3.textMuted, lineHeight: 1.2, whiteSpace: 'normal', wordBreak: 'break-word', overflow: 'hidden' }}>
                                {companyLine}
                              </div>
                            )}
                            {showPill && (
                              <div style={{
                                display: 'inline-block',
                                marginTop: 2,
                                padding: '1px 6px',
                                borderRadius: 999,
                                background: pillColors.bg,
                                color: pillColors.fg,
                                fontSize: 9,
                                fontWeight: 700,
                                letterSpacing: 0.3,
                                textTransform: 'uppercase',
                                whiteSpace: 'nowrap',
                              }}>
                                {pillLabel}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })}

                  {/* Current Time Indicator — today's column only */}
                  {isViewingCurrentWeek && daysInWeek[dayIdx].getTime() === today.getTime() && (() => {
                    const nowFrac = currentTime.getHours() + currentTime.getMinutes() / 60;
                    if (nowFrac < startHour || nowFrac > endHour) return null;
                    const topPx = (nowFrac - startHour) * hourPx;
                    return (
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          top: `${topPx}px`,
                          zIndex: 25,
                          pointerEvents: 'none',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#E53E3E', flexShrink: 0, marginLeft: -4 }} />
                        <div style={{ flex: 1, height: 2, background: '#E53E3E' }} />
                      </div>
                    );
                  })()}

                  {/* Block Boundary Lines — weekdays (Mon-Fri) only */}
                  {daysInWeek[dayIdx].getDay() >= 1 && daysInWeek[dayIdx].getDay() <= 5 && blockEvents
                    .filter(block => {
                      if (block.blockKind !== 'am_out' && block.blockKind !== 'pm_out') return false;
                      const blockDate = new Date(block.startTime);
                      blockDate.setHours(0, 0, 0, 0);
                      return blockDate.getTime() === daysInWeek[dayIdx].getTime();
                    })
                    .map((block) => {
                      const blockStart = new Date(block.startTime);
                      const blockEnd = new Date(block.endTime);
                      const topPx = block.blockKind === 'am_out'
                        ? (blockEnd.getHours() - startHour) * hourPx + (blockEnd.getMinutes() / 60) * hourPx
                        : (blockStart.getHours() - startHour) * hourPx + (blockStart.getMinutes() / 60) * hourPx;

                      return (
                        <div
                          key={`block-${block.id}`}
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            top: `${topPx}px`,
                            height: 1,
                            background: 'rgba(27,27,27,0.4)',
                            zIndex: 5,
                          }}
                          title={block.title}
                        />
                      );
                    })}
                </div>
              );
            })}
          </div>

          {/* All-Day Events Bar */}
          {allDayEvents.length > 0 && (() => {
            const sortedAllDayEvents = [...allDayEvents].sort((a, b) =>
              new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
            );
            const maxStackedRows = Math.max(1, sortedAllDayEvents.length);
            const stripHeightPx = maxStackedRows * 20 + 4;

            return (
              <div style={{ borderTop: `1px solid ${v3.borderLight}`, position: 'relative', minHeight: `${stripHeightPx}px`, background: v3.bg }}>
                {/* Timezone spacer */}
                <div style={{ position: 'absolute', left: 0, width: 36 * 3, height: '100%', flexShrink: 0 }}></div>

                {/* All-day pills overlay (spans across grid width) */}
                <div style={{ position: 'absolute', left: `${36 * 3}px`, right: 0, top: 0, height: '100%', width: 'calc(100% - 108px)' }}>
                  {sortedAllDayEvents.map((event, eventIdx) => {
                    const eventStart = new Date(event.startTime);
                    const eventEnd = new Date(event.endTime);
                    eventStart.setHours(0, 0, 0, 0);
                    eventEnd.setHours(0, 0, 0, 0);

                    const dayOffset = Math.max(0, daysBetween(weekStart, eventStart));
                    const daySpan = Math.min(7 - dayOffset, Math.max(1, daysBetween(eventStart, eventEnd) + 1));

                    const bgColor = event.calendarKind === 'matria' ? '#B8AC97' : mutedColorFor(event.colorId, event.colorHex);
                    const isBanana = event.colorId === '5';
                    const titleLine = isBanana ? event.title : (event.attendeeContactName || event.title);

                    return (
                      <div
                        key={event.id}
                        onClick={() => onEventClick(event)}
                        style={{
                          position: 'absolute',
                          left: `${(dayOffset / 7) * 100}%`,
                          width: `${(daySpan / 7) * 100}%`,
                          top: `${eventIdx * 20 + 2}px`,
                          height: 18,
                          background: bgColor,
                          color: '#FFFFFF',
                          padding: '2px 4px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          cursor: 'pointer',
                        }}
                      >
                        {titleLine}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Empty State Overlay */}
          {timedEvents.length === 0 && allDayEvents.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: v3.textMuted, pointerEvents: 'none' }}>
              <span style={{ fontSize: 14 }}>No events this week</span>
            </div>
          )}
        </div>}
    </div>
  );
};

export default WeekView;
