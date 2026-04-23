import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  colorHex: string | null;
  attendees: Array<{ email: string; responseStatus: string; self: boolean }>;
}

interface WeekViewProps {
  isLight: boolean;
  onEventClick: (event: CalendarEvent) => void;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function getGuestStatus(event: CalendarEvent): 'declined' | 'needsAction' | 'accepted' | 'none' {
  const guests = event.attendees.filter(a => !a.self);
  if (guests.length === 0) return 'none';
  if (guests.some(a => a.responseStatus === 'declined')) return 'declined';
  if (guests.some(a => a.responseStatus === 'needsAction')) return 'needsAction';
  return 'accepted';
}

const RSVP_ICON: Record<string, string> = {
  declined: '⚠️',
  needsAction: '□',
  accepted: '☑',
};

export const WeekView: React.FC<WeekViewProps> = ({ isLight, onEventClick }) => {
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

  events.forEach(event => {
    const eventDate = new Date(event.startTime);
    eventDate.setHours(0, 0, 0, 0);
    const dayIdx = daysInWeek.findIndex(d => d.getTime() === eventDate.getTime());
    if (dayIdx !== -1) {
      eventsByDay[dayIdx].push(event);
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
    <div className={`rounded-xl border ${isLight ? 'border-border-subtle bg-bg-elevated' : 'border-border-subtle bg-bg-elevated'} overflow-hidden flex flex-col h-full`}>
      {/* Header */}
      <div className={`border-b ${isLight ? 'border-border-subtle' : 'border-border-subtle'} p-4 flex items-center justify-between`}>
        <div className="flex items-center gap-4">
          <button
            onClick={handlePrev}
            className={`p-1 rounded transition-colors ${isLight ? 'hover:bg-black/8' : 'hover:bg-white/10'}`}
          >
            <ChevronLeft size={20} className="text-text-secondary" />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{dateRangeLabel}</span>
            <button
              onClick={handleThisWeek}
              className={`text-xs px-3 py-1 rounded transition-colors ${isLight ? 'hover:bg-black/8 text-text-secondary' : 'hover:bg-white/10 text-text-secondary'}`}
            >
              This Week
            </button>
          </div>
          <button
            onClick={handleNext}
            className={`p-1 rounded transition-colors ${isLight ? 'hover:bg-black/8' : 'hover:bg-white/10'}`}
          >
            <ChevronRight size={20} className="text-text-secondary" />
          </button>
        </div>

        {/* Mode Toggle */}
        <div className={`flex items-center gap-2 p-1 rounded-full ${isLight ? 'bg-bg-secondary' : 'bg-bg-secondary'}`}>
          {(['clean', 'everything'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                mode === m
                  ? 'bg-accent-primary text-white'
                  : `text-text-secondary ${isLight ? 'hover:bg-black/8' : 'hover:bg-white/10'}`
              }`}
            >
              {m === 'clean' ? 'Clean' : 'Everything'}
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className={`flex-1 flex items-center justify-center text-text-secondary`}>
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {/* Grid */}
      {!loading && (
        <div className="flex-1 overflow-auto flex flex-col">
          {/* Day Headers */}
          <div className="flex sticky top-0 z-10">
            <div className="w-[50px] flex-shrink-0 bg-bg-primary"></div>
            {daysInWeek.map((dayDate, idx) => {
              const isToday = dayDate.getTime() === today.getTime();
              return (
                <div
                  key={idx}
                  className={`flex-1 p-2 border-r border-border-subtle text-center text-xs font-medium transition-colors ${
                    isToday
                      ? `text-accent-primary ${isLight ? 'bg-blue-50' : 'bg-blue-950/20'}`
                      : 'text-text-secondary'
                  }`}
                >
                  <div>{dayLabels[dayDate.getDay()]}</div>
                  <div className={isToday ? 'font-bold' : ''}>{dayDate.getDate()}</div>
                </div>
              );
            })}
          </div>

          {/* Time Grid */}
          <div className="flex flex-1">
            {/* Time Axis */}
            <div className="w-[50px] flex-shrink-0 border-r border-border-subtle">
              {Array.from({ length: 15 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-12 border-b border-border-subtle/50 text-right pr-2 text-[10px] text-text-tertiary leading-none pt-0.5"
                >
                  {idx + 7}:00
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
                  className={`flex-1 border-r border-border-subtle relative ${dayIdx === daysInWeek.length - 1 ? 'border-r-0' : ''}`}
                  style={{ minHeight: '672px' }}
                >
                  {/* Hour Grid Lines */}
                  {Array.from({ length: 15 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="absolute w-full border-b border-border-subtle/50"
                      style={{ top: `${idx * 48}px`, height: '48px' }}
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
                      const bgColor = event.colorHex || '#4A90D9';

                      return (
                        <div
                          key={event.id}
                          onClick={() => onEventClick(event)}
                          className="absolute cursor-pointer z-20 group transition-all"
                          style={{
                            top: `${topPx}px`,
                            height: `${heightPx}px`,
                            left: `${(eventIdx / groupSize) * 100}%`,
                            width: `${(1 / groupSize) * 100}%`,
                            padding: '2px',
                          }}
                        >
                          <div
                            className="h-full w-full rounded-md p-1 text-xs text-text-primary overflow-hidden border-l-4 transition-colors group-hover:brightness-110"
                            style={{
                              backgroundColor: `${bgColor}22`,
                              borderLeftColor: bgColor,
                            }}
                          >
                            <div className="flex items-start gap-1 h-full">
                              {guestStatus !== 'none' && (
                                <span className="text-[8px] flex-shrink-0 leading-tight">
                                  {RSVP_ICON[guestStatus]}
                                </span>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-[9px] font-medium leading-tight whitespace-nowrap">
                                  {formatTime(event.startTime)}
                                </div>
                                <div className="text-[8px] leading-tight truncate text-text-secondary group-hover:text-text-primary">
                                  {event.title}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && events.length === 0 && (
        <div className={`flex-1 flex items-center justify-center text-text-secondary`}>
          <span className="text-sm">No events this week</span>
        </div>
      )}
    </div>
  );
};

export default WeekView;
