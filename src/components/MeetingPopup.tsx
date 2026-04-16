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
                {/* Header */}
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
