import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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
}

interface WeekViewProps {
  isLight: boolean;
  onEventClick: (event: CalendarEvent) => void;
}

// v3 Design System
const v3 = {
  fontSans: '"Nunito Sans", -apple-system, BlinkMacSystemFont, sans-serif',
  fontSerif: '"Playfair Display", "Times New Roman", serif',
  bg: '#FFFFFF',
  surface: '#EEEDE9',
  surfaceHover: '#E5E3DD',
  dark: '#1B1B1B',
  textMuted: 'rgba(27,27,27,0.6)',
  border: '#BFBFBF',
  borderLight: 'rgba(27,27,27,0.08)',
};

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
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day;
    const sunday = new Date(today.setDate(diff));
    sunday.setHours(0, 0, 0, 0);
    return sunday;
  });

  const [mode, setMode] = useState<'clean' | 'everything'>('clean');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (window as any).electronAPI?.weekviewGetEvents?.({
      weekStartIso: weekStart.toISOString(),
      mode,
    })
      .then((evts: CalendarEvent[]) => {
        setEvents(evts || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [weekStart, mode]);

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

  const dateRangeLabel = (() => {
    const startStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${startStr} – ${endStr}`;
  })();

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const daysInWeek: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(weekStart);
    dayDate.setDate(dayDate.getDate() + i);
    daysInWeek.push(dayDate);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const eventsByDay: Record<number, CalendarEvent[]> = {};
  daysInWeek.forEach((_, idx) => {
    eventsByDay[idx] = [];
  });

  const timedEvents: CalendarEvent[] = [];
  const allDayEvents: CalendarEvent[] = [];

  events.forEach(event => {
    if (event.isAllDay) {
      allDayEvents.push(event);
    } else {
      timedEvents.push(event);
      const eventDate = new Date(event.startTime);
      eventDate.setHours(0, 0, 0, 0);
      const dayIdx = daysInWeek.findIndex(d => d.getTime() === eventDate.getTime());
      if (dayIdx !== -1) {
        eventsByDay[dayIdx].push(event);
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

  return (
    <div style={{ borderRadius: 12, border: `1px solid ${v3.borderLight}`, background: v3.surface, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%', fontFamily: v3.fontSans }}>
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${v3.borderLight}`, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: v3.bg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={handlePrev}
            style={{ padding: 8, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => e.currentTarget.style.background = v3.surface}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <ChevronLeft size={20} color={v3.textMuted} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: v3.dark }}>{dateRangeLabel}</span>
            <button
              onClick={handleThisWeek}
              style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: v3.textMuted, transition: 'background 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.background = v3.surface}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              This Week
            </button>
          </div>
          <button
            onClick={handleNext}
            style={{ padding: 8, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => e.currentTarget.style.background = v3.surface}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <ChevronRight size={20} color={v3.textMuted} />
          </button>
        </div>

        {/* Mode Toggle - Pill Style */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 4, borderRadius: 999, background: v3.surface }}>
          {(['clean', 'everything'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 999,
                border: 'none',
                cursor: 'pointer',
                background: mode === m ? v3.dark : 'transparent',
                color: mode === m ? v3.bg : v3.textMuted,
                transition: 'all 0.2s',
              }}
            >
              {m === 'clean' ? 'Clean' : 'Everything'}
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: v3.textMuted }}>
          <span style={{ fontSize: 14 }}>Loading…</span>
        </div>
      )}

      {/* Grid */}
      {!loading && (
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {/* Day Headers */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10 }}>
            <div style={{ width: 50, flexShrink: 0, background: v3.bg }}></div>
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
                    padding: 8,
                    textAlign: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                    color: v3.textMuted,
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
                    padding: 8,
                    borderRight: `1px solid ${v3.borderLight}`,
                    textAlign: 'center',
                    fontSize: 12,
                    fontWeight: 500,
                    background: v3.bg,
                  }}
                >
                  <div style={{ color: v3.dark }}>{dayLabels[dayDate.getDay()]}</div>
                  <div
                    style={{
                      marginTop: 4,
                      padding: isToday ? '4px 8px' : 0,
                      background: isToday ? v3.dark : 'transparent',
                      color: isToday ? v3.bg : v3.dark,
                      borderRadius: isToday ? 12 : 0,
                      fontWeight: isToday ? 600 : 400,
                    }}
                  >
                    {dayDate.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Time Grid */}
          <div style={{ display: 'flex', flex: 1 }}>
            {/* Time Axis */}
            <div style={{ width: 50, flexShrink: 0, borderRight: `1px solid ${v3.borderLight}`, background: v3.bg }}>
              {Array.from({ length: 15 }).map((_, idx) => (
                <div
                  key={idx}
                  style={{
                    height: 48,
                    borderBottom: `1px solid ${v3.borderLight}`,
                    textAlign: 'right',
                    paddingRight: 8,
                    fontSize: 10,
                    color: v3.textMuted,
                    lineHeight: 1,
                    paddingTop: 2,
                  }}
                >
                  {format12HourTime(idx + 7)}
                </div>
              ))}
            </div>

            {/* Timezone Columns */}
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
                  {Array.from({ length: 15 }).map((_, idx) => (
                    <div
                      key={idx}
                      style={{
                        height: 48,
                        borderBottom: `1px solid ${v3.borderLight}`,
                        fontSize: 9,
                        color: v3.textMuted,
                        lineHeight: 1,
                        textAlign: 'right',
                        paddingRight: 4,
                        paddingTop: 2,
                      }}
                    >
                      {hourInTz(idx + 7, tz, weekStart)}
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
                    borderRight: `1px solid ${v3.borderLight}`,
                    position: 'relative',
                    minHeight: '672px',
                    background: v3.bg,
                  }}
                >
                  {/* Hour Grid Lines */}
                  {Array.from({ length: 15 }).map((_, idx) => (
                    <div
                      key={idx}
                      style={{
                        position: 'absolute',
                        width: '100%',
                        borderBottom: `1px solid ${v3.borderLight}`,
                        top: `${idx * 48}px`,
                        height: '48px',
                      }}
                    ></div>
                  ))}

                  {/* Events */}
                  {Array.from(overlapGroups.values()).map((groupEvents) => {
                    const groupSize = groupEvents.length;
                    return groupEvents.map((event, eventIdx) => {
                      const startDate = new Date(event.startTime);
                      const endDate = new Date(event.endTime);
                      const startHour = startDate.getHours();
                      const startMinute = startDate.getMinutes();
                      const durationMins = (endDate.getTime() - startDate.getTime()) / 60000;

                      const topPx = (startHour - 7) * 48 + (startMinute / 60) * 48;
                      const heightPx = Math.max((durationMins / 60) * 48, 22);
                      const guestStatus = getGuestStatus(event);
                      const bgColor = mutedColorFor(event.colorId, event.colorHex);

                      // New event card content
                      const titleLine = event.attendeeContactName || event.title;
                      const companyLine = event.attendeeCompany;
                      const showPill = event.eventType && event.eventType !== 'other' && heightPx >= 36;
                      const showCompany = companyLine && event.calendarKind !== 'family' && heightPx >= 50;

                      const pillColors = (() => {
                        if (event.calendarKind === 'scalable') return { bg: '#7A9C70', fg: '#FFFFFF' };
                        if (event.calendarKind === 'matria')   return { bg: '#D9C28A', fg: '#1B1B1B' };
                        switch (event.eventType) {
                          case 'appointment': return { bg: '#6F87B5', fg: '#FFFFFF' };
                          case 'school':      return { bg: '#BBB4D6', fg: '#1B1B1B' };
                          case 'task':        return { bg: '#C99B6E', fg: '#FFFFFF' };
                          case 'fun':         return { bg: '#B8625A', fg: '#FFFFFF' };
                          case 'fyi':         return { bg: '#D9C28A', fg: '#1B1B1B' };
                          default:            return { bg: '#9C9C9C', fg: '#FFFFFF' };
                        }
                      })();

                      const pillLabelMap = { demo: 'Demo', discovery: 'Disc', followup: 'Fup', appointment: 'Appt', school: 'School', task: 'Task', fun: 'Fun', fyi: 'FYI' } as const;
                      const pillLabel = event.eventType && event.eventType in pillLabelMap ? pillLabelMap[event.eventType as keyof typeof pillLabelMap] : '';
                      const rsvpIcon = guestStatus !== 'none' ? RSVP_ICON[guestStatus] : '';

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
                            <div style={{ fontSize: 11, fontWeight: 600, color: v3.dark, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {rsvpIcon && <span>{rsvpIcon} </span>}
                              {titleLine}
                            </div>
                            {showCompany && (
                              <div style={{ fontSize: 10, color: v3.textMuted, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                              }}>
                                {pillLabel}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })}
                </div>
              );
            })}
          </div>

          {/* All-Day Events Bar */}
          {allDayEvents.length > 0 && (
            <div style={{ borderTop: `1px solid ${v3.borderLight}`, padding: 6, maxHeight: 'auto', background: v3.bg }}>
              <div style={{ display: 'flex' }}>
                <div style={{ width: 50, flexShrink: 0, fontSize: 10, color: v3.textMuted, paddingRight: 6, textAlign: 'right' }}>
                  All day
                </div>
                {/* Timezone columns spacer */}
                <div style={{ width: 36 * 3, flexShrink: 0 }}></div>
                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                  {daysInWeek.map((_, dayIdx) => (
                    <div key={dayIdx} style={{ position: 'relative', minHeight: 54 }}>
                      {allDayEvents.map((event, eventIdx) => {
                        const eventStart = new Date(event.startTime);
                        const eventEnd = new Date(event.endTime);
                        eventStart.setHours(0, 0, 0, 0);
                        eventEnd.setHours(0, 0, 0, 0);

                        const dayOffset = Math.max(0, daysBetween(weekStart, eventStart));
                        const daySpan = Math.min(7 - dayOffset, Math.max(1, daysBetween(eventStart, eventEnd) + 1));

                        if (dayOffset !== dayIdx) return null;

                        const bgColor = mutedColorFor(event.colorId, event.colorHex);
                        const titleLine = event.attendeeContactName || event.title;

                        return (
                          <div
                            key={event.id}
                            onClick={() => onEventClick(event)}
                            style={{
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              top: `${eventIdx * 18 + 2}px`,
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
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!loading && timedEvents.length === 0 && allDayEvents.length === 0 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: v3.textMuted }}>
          <span style={{ fontSize: 14 }}>No events this week</span>
        </div>
      )}
    </div>
  );
};

export default WeekView;
