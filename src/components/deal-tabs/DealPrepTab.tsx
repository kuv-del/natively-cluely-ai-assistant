import React from 'react';
import { FileText } from 'lucide-react';
import DossierView, { type Dossier } from '../DossierView';
import type { DealDetailsResponse } from '../../types/deal-details';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DealPrepTabProps {
    upcomingMeeting: DealDetailsResponse['upcoming_meeting'];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMeetingDateTime(startTime: string): string {
    return new Date(startTime).toLocaleString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

// ─── Component ────────────────────────────────────────────────────────────────

const DealPrepTab: React.FC<DealPrepTabProps> = ({ upcomingMeeting }) => {
    // No upcoming meeting at all
    if (!upcomingMeeting) {
        return (
            <div className="flex flex-col items-center justify-center text-center py-16 space-y-3">
                <FileText className="w-8 h-8 text-text-tertiary opacity-60" />
                <div className="text-[13px] font-medium text-text-primary">
                    No upcoming meetings with this prospect.
                </div>
            </div>
        );
    }

    const { meeting, prep_dossier } = upcomingMeeting;
    const meetingTitle = meeting.title || 'Upcoming Meeting';
    const formattedTime = meeting.start_time ? formatMeetingDateTime(meeting.start_time) : null;

    // Meeting exists but no dossier yet
    if (!prep_dossier) {
        return (
            <div className="space-y-3">
                <div className="text-[13px] text-text-secondary">
                    <span className="font-medium text-text-primary">{meetingTitle}</span>
                    {formattedTime && (
                        <span className="ml-2 text-text-tertiary">on {formattedTime}</span>
                    )}
                    <span className="ml-2 text-text-tertiary italic">— no prep dossier generated yet.</span>
                </div>
            </div>
        );
    }

    // Meeting + dossier present
    return (
        <div className="space-y-4">
            {/* Meeting header row */}
            <div className="text-[13px] text-text-secondary">
                <span className="font-medium text-text-primary">Next: {meetingTitle}</span>
                {formattedTime && (
                    <span className="ml-2 text-text-tertiary">· {formattedTime}</span>
                )}
            </div>

            {/* Dossier content */}
            <DossierView
                dossier={prep_dossier as Dossier}
                variant="page"
                readOnly={false}
            />
        </div>
    );
};

export default DealPrepTab;
