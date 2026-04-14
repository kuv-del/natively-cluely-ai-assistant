import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText } from 'lucide-react';
import type { DealDetailsResponse, DealDetailsMeetingGroup } from '../../types/deal-details';

// ─── Props ────────────────────────────────────────────────────────────────────

type MeetingGroupArray = DealDetailsResponse['meetings_by_type']['discovery'];

interface DealCallTypeTabProps {
    meetings: MeetingGroupArray;
    callTypeLabel: string;
    onOpenMeeting?: (meetingId: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMeetingDate(startTime: string | undefined): string {
    if (!startTime) return 'Unknown date';
    return new Date(startTime).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

/** Sort a copy of the meetings array oldest-first by start_time. */
function sortedOldestFirst(meetings: MeetingGroupArray): MeetingGroupArray {
    return [...meetings].sort((a, b) => {
        const ta = a.meeting.start_time ?? '';
        const tb = b.meeting.start_time ?? '';
        return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
}

// ─── Empty state ──────────────────────────────────────────────────────────────

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
    <div className="flex flex-col items-center justify-center text-center py-16 space-y-3">
        <FileText className="w-8 h-8 text-text-tertiary opacity-60" />
        <div className="text-[13px] font-medium text-text-primary">{message}</div>
    </div>
);

// ─── Single meeting block ─────────────────────────────────────────────────────

interface MeetingBlockProps {
    group: DealDetailsMeetingGroup;
    onOpenMeeting?: (meetingId: string) => void;
}

const MeetingBlock: React.FC<MeetingBlockProps> = ({ group, onOpenMeeting }) => {
    const { meeting, summary, transcript } = group;

    const handleOpenClick = (e: React.MouseEvent) => {
        e.preventDefault();
        if (onOpenMeeting) onOpenMeeting(meeting.id);
    };

    return (
        <div className="space-y-6">
            {/* Header row: date + optional open link */}
            <div className="flex items-center justify-between">
                <span className="text-[12px] text-text-tertiary">
                    {formatMeetingDate(meeting.start_time)}
                </span>
                {onOpenMeeting && (
                    <button
                        onClick={handleOpenClick}
                        className="text-[12px] text-emerald-500 hover:text-emerald-400 hover:underline transition-colors cursor-pointer"
                    >
                        Open meeting →
                    </button>
                )}
            </div>

            {/* Summary section */}
            <div className="space-y-2">
                <h3 className="text-[11px] uppercase tracking-wider text-text-tertiary font-bold">
                    Summary
                </h3>
                {summary != null ? (
                    <div className="text-[13px] text-text-secondary prose prose-sm prose-invert max-w-none
                        [&>p]:mb-3 [&>ul]:mb-3 [&>ol]:mb-3 [&>h1]:text-text-primary [&>h2]:text-text-primary
                        [&>h3]:text-text-primary [&>strong]:text-text-primary [&>code]:text-emerald-400
                        [&>code]:bg-white/[0.06] [&>code]:px-1 [&>code]:rounded">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {summary}
                        </ReactMarkdown>
                    </div>
                ) : (
                    <div className="text-[13px] text-text-tertiary italic">
                        Summary generating… (check back in 15 min)
                    </div>
                )}
            </div>

            {/* Transcript section */}
            <div className="space-y-2">
                <h3 className="text-[11px] uppercase tracking-wider text-text-tertiary font-bold">
                    Transcript
                </h3>
                {transcript != null ? (
                    <pre
                        className="text-[12px] text-text-secondary font-mono leading-relaxed
                            overflow-y-auto max-h-[400px] whitespace-pre-wrap break-words
                            bg-black/20 rounded-lg p-4 custom-scrollbar"
                    >
                        {formatTranscript(transcript)}
                    </pre>
                ) : (
                    <div className="text-[13px] text-text-tertiary italic">
                        Transcript not available yet.
                    </div>
                )}
            </div>
        </div>
    );
};

/**
 * Formats the transcript for display.
 * Handles both the structured array shape (from DealDetailsMeetingGroup) and the
 * plain string shape (from DealDetailsMeetingRef.transcript which arrives as
 * Array<{speaker, text, timestamp?}> per the type, but backend may send raw string).
 */
function formatTranscript(
    transcript: DealDetailsMeetingGroup['transcript'],
): string {
    if (!transcript || transcript.length === 0) return '';
    return transcript
        .map((entry) => {
            const speaker = entry.speaker ?? 'Unknown';
            return `[${speaker}]: ${entry.text}`;
        })
        .join('\n\n');
}

// ─── Pill row (multi-meeting) ─────────────────────────────────────────────────

interface PillRowProps {
    count: number;
    activeIndex: number;
    onSelect: (index: number) => void;
}

const PillRow: React.FC<PillRowProps> = ({ count, activeIndex, onSelect }) => (
    <div className="flex items-center gap-2 mb-6">
        {Array.from({ length: count }, (_, i) => (
            <button
                key={i}
                onClick={() => onSelect(i)}
                className={`
                    px-3 py-1 text-[12px] font-medium rounded-full border transition-all duration-150
                    ${activeIndex === i
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                        : 'bg-transparent border-white/10 text-text-tertiary hover:border-white/20 hover:text-text-secondary'
                    }
                `}
            >
                Call {i + 1}
            </button>
        ))}
    </div>
);

// ─── Component ────────────────────────────────────────────────────────────────

const DealCallTypeTab: React.FC<DealCallTypeTabProps> = ({
    meetings,
    callTypeLabel,
    onOpenMeeting,
}) => {
    // Sort once — oldest first so pills are in chronological order (Call 1 = oldest).
    const sorted = sortedOldestFirst(meetings);

    // Default active pill = most recent meeting (last index after oldest-first sort).
    const [activeIndex, setActiveIndex] = useState<number>(
        sorted.length > 0 ? sorted.length - 1 : 0,
    );

    // ── Case 1: no meetings ────────────────────────────────────────────────────
    if (sorted.length === 0) {
        return <EmptyState message={`No ${callTypeLabel} calls yet for this prospect.`} />;
    }

    // ── Case 2: single meeting — no pill row ──────────────────────────────────
    if (sorted.length === 1) {
        return (
            <MeetingBlock
                group={sorted[0]}
                onOpenMeeting={onOpenMeeting}
            />
        );
    }

    // ── Case 3: multiple meetings — pill row above active meeting block ────────
    const activeGroup = sorted[activeIndex] ?? sorted[sorted.length - 1];

    return (
        <div>
            <PillRow
                count={sorted.length}
                activeIndex={activeIndex}
                onSelect={setActiveIndex}
            />
            <MeetingBlock
                group={activeGroup}
                onOpenMeeting={onOpenMeeting}
            />
        </div>
    );
};

export default DealCallTypeTab;
