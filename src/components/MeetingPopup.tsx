import React, { useEffect, useState } from 'react';
import { Video, X } from 'lucide-react';

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
        return <div className="w-full h-full bg-transparent" />;
    }

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
        <div className="w-full h-full flex items-start justify-center bg-transparent select-none"
             style={{ WebkitAppRegion: 'drag' } as any}>
            <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl w-full mx-2 mt-2 overflow-hidden flex items-center px-4 py-3 gap-4"
                 style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)' }}>
                {/* Left: meeting info */}
                <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-gray-900 leading-tight truncate">
                        {event.title}
                    </p>
                    <p className="text-[12px] text-gray-500 mt-0.5">
                        {new Date(event.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – {new Date(event.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </p>
                </div>

                {/* Right: Join button + X */}
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={handleJoin}
                        className="bg-blue-500 hover:bg-blue-600 text-white px-5 py-2 rounded-full text-sm font-semibold transition-all active:scale-[0.97] flex items-center gap-2"
                        style={{ WebkitAppRegion: 'no-drag' } as any}
                    >
                        <Video size={15} />
                        Join Now
                    </button>
                    <button
                        onClick={handleDismiss}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                        style={{ WebkitAppRegion: 'no-drag' } as any}
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MeetingPopup;
