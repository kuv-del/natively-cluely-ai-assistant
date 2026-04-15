import React, { useState, useEffect } from 'react';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { ArrowLeft, Link, FileText, ArrowUp } from 'lucide-react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    getDealStageLabel,
    hubspotContactUrl,
    hubspotDealUrl,
    slackDmUrl,
    formatPhone,
    normalizeUrl,
} from '../lib/hubspot-mapping';
import type { DealDetailsResponse, DealDetailsMeetingRef, DealDetailsMeetingGroup } from '../types/deal-details';
import DealPrepTab from './deal-tabs/DealPrepTab';
import MeetingChatOverlay from './MeetingChatOverlay';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DealDetailsProps {
    contactId: string;
    onBack: () => void;
    onOpenMeeting?: (meeting: DealDetailsMeetingRef) => void;
}

// ─── ProfileRow (mirrors MeetingDetails — DRY refactor is a later concern) ───

const ProfileRow: React.FC<{ label: string; value?: string | null; href?: string }> = ({ label, value, href }) => {
    const handleClick = (e: React.MouseEvent) => {
        if (!href) return;
        e.preventDefault();
        window.electronAPI?.openExternal?.(href);
    };

    return (
        <div className="flex items-baseline gap-4 text-[13px]">
            <div className="text-text-tertiary w-28 shrink-0">{label}</div>
            {value && href ? (
                <a
                    href={href}
                    onClick={handleClick}
                    className="text-emerald-500 hover:text-emerald-400 hover:underline transition-colors cursor-pointer"
                >
                    {value}
                </a>
            ) : (
                <div className={value ? 'text-text-primary' : 'text-text-tertiary italic'}>
                    {value || '—'}
                </div>
            )}
        </div>
    );
};

// ─── Tab definitions ──────────────────────────────────────────────────────────

type TabKey = 'summary' | 'profile' | 'grade' | 'past_meetings' | 'prep';

const TAB_LABELS: Record<TabKey, string> = {
    summary: 'Summary',
    profile: 'Profile',
    grade: 'Grade',
    past_meetings: 'Past Meetings',
    prep: 'Prep',
};

const AVAILABLE_TABS: TabKey[] = ['summary', 'profile', 'grade', 'past_meetings', 'prep'];

// ─── Meeting type pretty labels ───────────────────────────────────────────────

const MEETING_TYPE_PRETTY: Record<string, string> = {
    discovery: 'Discovery Call',
    demo: 'Demo Call',
    followup: 'Follow Up',
    sdr_triage: 'SDR Triage Call',
    sdr_discovery: 'SDR Triage Call', // legacy alias — Kate's rule: anyone but Kate took it = triage
    game_planning: 'Game Planning',
};

function getMeetingTypeLabel(type: string | undefined | null): string {
    if (!type) return 'Meeting';
    return MEETING_TYPE_PRETTY[type] || type;
}

// ─── Deal stage color coding ──────────────────────────────────────────────────

// Stages grouped by category:
// new/triaged: decisionmakerboughtin, "83755899" (Growth Session Scheduled / Held)
// active: "250536552" (Paid), "250536553" (Contract Sent)
// signed/won: "113267853"
// lost: "85094266"
function getStagePillStyle(stage: string | undefined | null): string {
    if (!stage) return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    switch (stage) {
        case 'decisionmakerboughtin':
        case '83755899':
            // new/triaged — orange
            return 'bg-orange-500/10 text-orange-400 border-orange-500/30';
        case '250536552':
        case '250536553':
            // active/working — blue
            return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
        case '113267853':
            // signed/won — green
            return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
        case '85094266':
            // lost — red
            return 'bg-red-500/10 text-red-400 border-red-500/30';
        default:
            // unknown
            return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    }
}

// ─── Empty state helper ───────────────────────────────────────────────────────

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
    <div className="flex flex-col items-center justify-center text-center py-16 space-y-3">
        <FileText className="w-8 h-8 text-text-tertiary opacity-60" />
        <div className="text-[13px] font-medium text-text-primary">{message}</div>
    </div>
);

// ─── Next/Last meeting indicator ──────────────────────────────────────────────

function formatMeetingDate(isoStr: string | undefined): string {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        + ', '
        + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

interface MeetingIndicatorProps {
    data: DealDetailsResponse;
}

const MeetingIndicator: React.FC<MeetingIndicatorProps> = ({ data }) => {
    const upcoming = data.upcoming_meeting;

    if (upcoming) {
        const typeLabel = getMeetingTypeLabel(upcoming.meeting?.meeting_type);
        const dateStr = formatMeetingDate(upcoming.meeting?.start_time);
        return (
            <span className="text-[12px] text-text-secondary">
                <span className="text-text-tertiary mr-1">Next:</span>
                {typeLabel}
                {dateStr && <span className="text-text-tertiary"> · {dateStr}</span>}
            </span>
        );
    }

    // Find the most recent past meeting across all buckets
    const allGroups: DealDetailsMeetingGroup[] = [
        ...(data.meetings_by_type?.discovery ?? []),
        ...(data.meetings_by_type?.demo ?? []),
        ...(data.meetings_by_type?.followup ?? []),
        ...(data.meetings_by_type?.sdr_triage ?? []),
    ];

    const nowMs = Date.now();
    const pastMeetings = allGroups
        .filter((g) => g.meeting?.start_time && new Date(g.meeting.start_time).getTime() <= nowMs)
        .sort((a, b) => new Date(b.meeting!.start_time!).getTime() - new Date(a.meeting!.start_time!).getTime());

    if (pastMeetings.length > 0) {
        const last = pastMeetings[0];
        const typeLabel = getMeetingTypeLabel(last.meeting?.meeting_type);
        const dateStr = formatMeetingDate(last.meeting?.start_time);
        return (
            <span className="text-[12px] text-text-secondary">
                <span className="text-text-tertiary mr-1">Last met:</span>
                {typeLabel}
                {dateStr && <span className="text-text-tertiary"> · {dateStr}</span>}
            </span>
        );
    }

    return <span className="text-[12px] text-text-tertiary italic">No meetings yet</span>;
};

// ─── Component ────────────────────────────────────────────────────────────────

const DealDetails: React.FC<DealDetailsProps> = ({ contactId, onBack, onOpenMeeting }) => {
    const isLight = useResolvedTheme() === 'light';
    const [data, setData] = useState<DealDetailsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabKey>('summary');
    const [expandedTranscriptIdx, setExpandedTranscriptIdx] = useState<number | null>(null);

    // Chat widget state (mirrors MeetingDetails ask-bar pattern)
    const [query, setQuery] = useState('');
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [submittedQuery, setSubmittedQuery] = useState('');

    const handleSubmitQuestion = () => {
        if (query.trim()) {
            setSubmittedQuery(query);
            if (!isChatOpen) setIsChatOpen(true);
            setQuery('');
        }
    };

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && query.trim()) {
            e.preventDefault();
            handleSubmitQuestion();
        }
    };

    const load = () => {
        window.electronAPI?.convexGetDealDetails?.(contactId)
            .then((result) => {
                // If the response has an error field, treat it as no data
                if (result && 'error' in result) {
                    setData(null);
                } else {
                    setData(result as DealDetailsResponse);
                }
            })
            .catch(() => setData(null))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
        const onFocus = () => load();
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contactId]);

    // ─── Derived display values ───────────────────────────────────────────────

    const contact = data?.contact;
    const company = data?.company;
    const deal = data?.deal;

    const headerName = loading
        ? '…'
        : contact
        ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown Contact'
        : 'Unknown Contact';

    const headerCompany = company?.company_name || null;
    const headerTitle = headerCompany ? `${headerName} — ${headerCompany}` : headerName;

    // ─── Past Meetings: flatten + sort descending ─────────────────────────────

    const flatPastMeetings: (DealDetailsMeetingGroup & { _meetingType: string })[] = data
        ? [
            ...(data.meetings_by_type?.discovery ?? []).map((g) => ({ ...g, _meetingType: 'discovery' })),
            ...(data.meetings_by_type?.demo ?? []).map((g) => ({ ...g, _meetingType: 'demo' })),
            ...(data.meetings_by_type?.followup ?? []).map((g) => ({ ...g, _meetingType: 'followup' })),
            ...(data.meetings_by_type?.sdr_triage ?? []).map((g) => ({ ...g, _meetingType: 'sdr_triage' })),
          ].sort((a, b) => {
              const aMs = a.meeting?.start_time ? new Date(a.meeting.start_time).getTime() : 0;
              const bMs = b.meeting?.start_time ? new Date(b.meeting.start_time).getTime() : 0;
              return bMs - aMs; // descending
          })
        : [];

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="relative h-full w-full flex flex-col bg-bg-secondary text-text-secondary font-sans overflow-hidden">
            <main className="flex-1 overflow-y-auto custom-scrollbar">
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.3 }}
                    className="max-w-4xl mx-auto px-8 py-8 pb-32"
                >
                    {/* Back button + header */}
                    <div className="flex items-start justify-between mb-6">
                        <div className="w-full pr-4">
                            {/* Back button */}
                            <button
                                onClick={onBack}
                                className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-primary transition-colors mb-3"
                            >
                                <ArrowLeft size={14} />
                                Back
                            </button>

                            {/* Page title */}
                            <h1 className="text-3xl font-bold text-text-primary tracking-tight mb-2">
                                {loading ? (
                                    <span className="opacity-40">Loading…</span>
                                ) : (
                                    headerTitle
                                )}
                            </h1>

                            {/* Header meta row: stage pill + meeting indicator */}
                            {!loading && (
                                <div className="flex items-center gap-3 flex-wrap">
                                    {/* Stage pill */}
                                    <span
                                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${getStagePillStyle(deal?.deal_stage)}`}
                                    >
                                        {deal?.deal_stage ? getDealStageLabel(deal.deal_stage) : 'No deal stage'}
                                    </span>

                                    {/* Next/last meeting indicator */}
                                    {data && <MeetingIndicator data={data} />}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Tab strip */}
                    <div className="flex items-center justify-between mb-8">
                        <div className={`p-1 rounded-xl inline-flex items-center gap-0.5 ${isLight ? 'bg-[#E5E5EA] border border-black/[0.04]' : 'bg-[#121214] border border-white/[0.08]'}`}>
                            {AVAILABLE_TABS.map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`
                                        relative px-3 py-1 text-[13px] font-medium rounded-lg transition-all duration-200 z-10
                                        ${activeTab === tab ? (isLight ? 'text-black' : 'text-[#E9E9E9]') : `${isLight ? 'text-text-secondary' : 'text-text-tertiary'} hover:text-text-primary`}
                                    `}
                                >
                                    {activeTab === tab && (
                                        <motion.div
                                            layoutId="dealDetailsActiveTabBackground"
                                            className={`absolute inset-0 rounded-lg -z-10 shadow-sm ${isLight ? 'bg-white' : 'bg-[#3A3A3C]'}`}
                                            initial={false}
                                            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                        />
                                    )}
                                    {TAB_LABELS[tab]}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Tab content */}
                    <div className="space-y-8">
                        {/* ── Summary tab ────────────────────────────────────── */}
                        {activeTab === 'summary' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                {loading ? (
                                    <div className="text-text-tertiary text-sm py-8">Loading…</div>
                                ) : data?.cumulative_summary ? (
                                    <div className="space-y-3">
                                        {/* Meta line */}
                                        <div className="text-[11px] text-text-tertiary">
                                            Generated{' '}
                                            {data.cumulative_summary._creationTime
                                                ? new Date(data.cumulative_summary._creationTime).toLocaleString([], {
                                                      month: 'short',
                                                      day: 'numeric',
                                                      year: 'numeric',
                                                      hour: 'numeric',
                                                      minute: '2-digit',
                                                  })
                                                : 'recently'}{' '}
                                            · {data.cumulative_summary.generator_model ?? 'claude-sonnet-max'}
                                        </div>
                                        {/* Narrative */}
                                        <div className="prose prose-sm prose-invert max-w-none text-[13px] leading-relaxed [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-1 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1 [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                {data.cumulative_summary.summary_markdown}
                                            </ReactMarkdown>
                                        </div>
                                    </div>
                                ) : (
                                    <EmptyState message="No cumulative summary yet — will auto-generate once at least two per-meeting summaries exist for this prospect (runs every 30 min)." />
                                )}
                            </motion.div>
                        )}

                        {/* ── Profile tab ──────────────────────────────────── */}
                        {activeTab === 'profile' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                {loading ? (
                                    <div className="text-text-tertiary text-sm py-8">Loading profile…</div>
                                ) : data && contact ? (
                                    <div className="space-y-6 max-w-2xl">
                                        {/* Contact identity */}
                                        <div>
                                            <h3 className="text-[11px] uppercase tracking-wider text-text-tertiary font-bold mb-3">Contact</h3>
                                            <div className="space-y-2">
                                                <ProfileRow
                                                    label="Name"
                                                    value={[contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || undefined}
                                                />
                                                <ProfileRow
                                                    label="Email"
                                                    value={contact?.email}
                                                    href={contact?.email ? `mailto:${contact.email}` : undefined}
                                                />
                                                {(() => {
                                                    const phone = formatPhone(contact?.phone);
                                                    return (
                                                        <ProfileRow
                                                            label="Phone"
                                                            value={phone?.display}
                                                            href={phone?.href}
                                                        />
                                                    );
                                                })()}
                                            </div>
                                        </div>

                                        {/* Company */}
                                        {company && (
                                            <div>
                                                <h3 className="text-[11px] uppercase tracking-wider text-text-tertiary font-bold mb-3">Company</h3>
                                                <div className="space-y-2">
                                                    <ProfileRow
                                                        label="Company"
                                                        value={company?.company_name}
                                                        href={normalizeUrl(company?.company_website) || undefined}
                                                    />
                                                    <ProfileRow label="Location" value={company?.company_location} />
                                                    <ProfileRow label="Revenue" value={company?.company_revenue} />
                                                    <ProfileRow label="Team Size" value={company?.employee_count} />
                                                </div>
                                            </div>
                                        )}

                                        {/* Deal & SDR */}
                                        {deal ? (
                                            <div>
                                                <h3 className="text-[11px] uppercase tracking-wider text-text-tertiary font-bold mb-3">Deal</h3>
                                                <div className="space-y-2">
                                                    <ProfileRow
                                                        label="SDR Owner"
                                                        value={deal?.sdr_owner_name}
                                                        href={deal?.sdr_slack_id ? slackDmUrl(deal.sdr_slack_id) : undefined}
                                                    />
                                                    <ProfileRow label="Deal Stage" value={getDealStageLabel(deal?.deal_stage)} />
                                                </div>
                                            </div>
                                        ) : (
                                            <div>
                                                <h3 className="text-[11px] uppercase tracking-wider text-text-tertiary font-bold mb-3">Deal</h3>
                                                <div className="text-[13px] text-text-tertiary italic">No active deal for this contact in HubSpot.</div>
                                            </div>
                                        )}

                                        {/* HubSpot links */}
                                        {(contact?.hubspot_contact_id || deal?.hubspot_deal_id) && (
                                            <div>
                                                <h3 className="text-[11px] uppercase tracking-wider text-text-tertiary font-bold mb-3">HubSpot</h3>
                                                <div className="flex flex-wrap gap-2">
                                                    {contact?.hubspot_contact_id && (
                                                        <a
                                                            href={hubspotContactUrl(contact.hubspot_contact_id)}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                window.electronAPI?.openExternal?.(hubspotContactUrl(contact!.hubspot_contact_id!));
                                                            }}
                                                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] font-medium bg-orange-500/10 text-orange-500 border border-orange-500/30 hover:bg-orange-500/20 transition-colors"
                                                        >
                                                            <Link size={12} />
                                                            HubSpot Contact
                                                        </a>
                                                    )}
                                                    {deal?.hubspot_deal_id && (
                                                        <a
                                                            href={hubspotDealUrl(deal.hubspot_deal_id)}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                window.electronAPI?.openExternal?.(hubspotDealUrl(deal!.hubspot_deal_id!));
                                                            }}
                                                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] font-medium bg-orange-500/10 text-orange-500 border border-orange-500/30 hover:bg-orange-500/20 transition-colors"
                                                        >
                                                            <Link size={12} />
                                                            HubSpot Deal
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <EmptyState message="No profile data found for this contact." />
                                )}
                            </motion.div>
                        )}

                        {/* ── Grade tab ──────────────────────────────────────── */}
                        {activeTab === 'grade' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <EmptyState message="Deal grading coming in a future update (backlog 1.14)." />
                            </motion.div>
                        )}

                        {/* ── Past Meetings tab ──────────────────────────────── */}
                        {activeTab === 'past_meetings' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                {loading ? (
                                    <div className="text-text-tertiary text-sm py-8">Loading…</div>
                                ) : flatPastMeetings.length === 0 ? (
                                    <EmptyState message="No past meetings yet for this prospect." />
                                ) : (
                                    <div className="space-y-4">
                                        {flatPastMeetings.map((group, idx) => {
                                            const typeLabel = getMeetingTypeLabel(group._meetingType);
                                            const dateStr = formatMeetingDate(group.meeting?.start_time);
                                            const summary = group.summary ?? null;
                                            const transcript = group.transcript ?? null;
                                            const meetingRef = group.meeting;
                                            const expanded = expandedTranscriptIdx === idx;
                                            return (
                                                <div
                                                    key={`${group._meetingType}-${idx}`}
                                                    className={`rounded-lg border p-4 space-y-2 ${isLight ? 'bg-bg-elevated border-border-muted' : 'bg-white/[0.03] border-white/10'}`}
                                                >
                                                    {/* Header: type label + date + Open pill */}
                                                    <div className="flex items-baseline justify-between gap-3">
                                                        <div className="text-[14px] font-semibold text-text-primary leading-snug">
                                                            {typeLabel}
                                                            {dateStr && <span className="font-normal text-text-tertiary ml-2 text-[12px]">{dateStr}</span>}
                                                        </div>
                                                        {onOpenMeeting && meetingRef && (
                                                            <button
                                                                onClick={() => onOpenMeeting(meetingRef)}
                                                                className={`shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${isLight ? 'bg-bg-elevated text-text-secondary border-border-muted hover:bg-bg-item-active hover:text-text-primary' : 'bg-white/5 text-text-tertiary border-white/10 hover:bg-white/10 hover:text-text-primary'}`}
                                                            >
                                                                Open →
                                                            </button>
                                                        )}
                                                    </div>

                                                    {/* Summary content */}
                                                    {summary ? (
                                                        <div className="prose prose-sm prose-invert max-w-none text-[12.5px] leading-relaxed [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5">
                                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                                {summary}
                                                            </ReactMarkdown>
                                                        </div>
                                                    ) : (
                                                        <p className="text-[12.5px] text-text-tertiary italic">Summary generating…</p>
                                                    )}

                                                    {/* Show / hide full transcript */}
                                                    {transcript && (
                                                        <>
                                                            <button
                                                                onClick={() => setExpandedTranscriptIdx(expanded ? null : idx)}
                                                                className="text-[11px] text-emerald-500 hover:text-emerald-400 hover:underline transition-colors"
                                                            >
                                                                {expanded ? 'Hide full transcript' : 'Show full transcript'}
                                                            </button>
                                                            {expanded && (
                                                                <div className={`mt-2 p-3 rounded text-[11.5px] leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto custom-scrollbar ${isLight ? 'bg-bg-secondary text-text-secondary' : 'bg-black/30 text-text-secondary'}`}>
                                                                    {transcript}
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </motion.div>
                        )}

                        {/* ── Prep tab ───────────────────────────────────────── */}
                        {activeTab === 'prep' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                {loading ? (
                                    <div className="text-text-tertiary text-sm py-8">Loading…</div>
                                ) : (
                                    <DealPrepTab upcomingMeeting={data?.upcoming_meeting ?? null} />
                                )}
                            </motion.div>
                        )}
                    </div>
                </motion.div>
            </main>

            {/* ── Floating Ask Bar ────────────────────────────────────────── */}
            <div className={`absolute bottom-0 left-0 right-0 p-6 flex justify-center pointer-events-none ${isChatOpen ? 'z-50' : 'z-20'}`}>
                <div className="w-full max-w-[440px] relative group pointer-events-auto">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleInputKeyDown}
                        placeholder="Ask about this deal..."
                        className="w-full pl-5 pr-12 py-3 bg-transparent backdrop-blur-[24px] backdrop-saturate-[140%] shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-white/20 rounded-full text-sm text-text-primary placeholder-text-tertiary/70 focus:outline-none transition-shadow duration-200"
                    />
                    <button
                        onClick={handleSubmitQuestion}
                        className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full transition-all duration-200 border border-white/5 ${query.trim() ? 'bg-text-primary text-bg-primary hover:scale-105' : 'bg-bg-item-active text-text-primary hover:bg-bg-item-hover'}`}
                    >
                        <ArrowUp size={16} className="transform rotate-45" />
                    </button>
                </div>
            </div>

            {/* ── Chat Overlay (reuses MeetingChatOverlay with a full-deal context blob) ── */}
            <MeetingChatOverlay
                isOpen={isChatOpen}
                onClose={() => {
                    setIsChatOpen(false);
                    setQuery('');
                    setSubmittedQuery('');
                }}
                meetingContext={{
                    // No `id` → MeetingChatOverlay skips RAG and falls through to
                    // plain context-window chat using the `summary` blob below.
                    title: headerTitle,
                    summary: (() => {
                        // Pack the entire deal into one markdown blob. Routed
                        // through Claude Max (see useClaudeBackend below), so the
                        // context window is effectively unbounded for our purposes
                        // — no truncation, no per-transcript caps. Full transcripts,
                        // full summaries, full notes, full prep dossier.

                        const parts: string[] = [];
                        parts.push(`# ${headerTitle}`);

                        // Contact
                        if (contact) {
                            parts.push('\n## Contact');
                            if (contact.email) parts.push(`- Email: ${contact.email}`);
                            if (contact.phone) parts.push(`- Phone: ${contact.phone}`);
                            if (contact.hubspot_contact_id) parts.push(`- HubSpot Contact ID: ${contact.hubspot_contact_id}`);
                        }

                        // Company
                        if (company) {
                            parts.push('\n## Company');
                            if (company.company_name) parts.push(`- Name: ${company.company_name}`);
                            if (company.company_website) parts.push(`- Website: ${company.company_website}`);
                            if (company.company_revenue) parts.push(`- Revenue: ${company.company_revenue}`);
                            if (company.employee_count) parts.push(`- Team Size: ${company.employee_count}`);
                            if (company.company_location) parts.push(`- Location: ${company.company_location}`);
                            if ((company as any).company_description) parts.push(`- Description: ${(company as any).company_description}`);
                        }

                        // Deal
                        if (deal) {
                            parts.push('\n## Deal');
                            if (deal.deal_stage) parts.push(`- Stage: ${getDealStageLabel(deal.deal_stage)}`);
                            if (deal.sdr_owner_name) parts.push(`- SDR Owner: ${deal.sdr_owner_name}`);
                            if (deal.hubspot_deal_id) parts.push(`- HubSpot Deal ID: ${deal.hubspot_deal_id}`);
                        }

                        // Cumulative deal summary
                        if (data?.cumulative_summary?.summary_markdown) {
                            parts.push('\n## Cumulative Deal Summary');
                            parts.push(data.cumulative_summary.summary_markdown);
                        }

                        // Every past meeting — full summary AND full transcript.
                        if (flatPastMeetings.length > 0) {
                            parts.push('\n## Past Meetings');
                            for (const g of flatPastMeetings) {
                                const type = getMeetingTypeLabel(g._meetingType);
                                const date = g.meeting?.start_time
                                    ? new Date(g.meeting.start_time).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                                    : '';
                                parts.push(`\n### ${type}${date ? ` — ${date}` : ''}`);
                                if (g.summary) {
                                    parts.push(`\n**Summary:**\n${g.summary}`);
                                }
                                if (g.transcript) {
                                    parts.push(`\n**Full transcript:**\n${g.transcript}`);
                                }
                                if (!g.summary && !g.transcript) {
                                    parts.push('(no summary or transcript yet)');
                                }
                            }
                        }

                        // SDR triage notes (Slack)
                        if (data?.sdr_notes && data.sdr_notes.length > 0) {
                            parts.push('\n## SDR Triage Notes (from Slack)');
                            for (const n of data.sdr_notes) {
                                parts.push(`\n- ${n.full_note || ''}`);
                            }
                        }

                        // Upcoming meeting context
                        if (data?.upcoming_meeting) {
                            const u = data.upcoming_meeting;
                            parts.push('\n## Upcoming Meeting');
                            if (u.meeting?.meeting_type) parts.push(`- Type: ${getMeetingTypeLabel(u.meeting.meeting_type)}`);
                            if (u.meeting?.start_time) parts.push(`- When: ${new Date(u.meeting.start_time).toLocaleString()}`);
                            if (u.meeting?.zoom_link) parts.push(`- Zoom: ${u.meeting.zoom_link}`);
                            if (u.prep_dossier) {
                                parts.push('\n**Prep Dossier:**');
                                parts.push('```json');
                                parts.push(JSON.stringify(u.prep_dossier, null, 2));
                                parts.push('```');
                            }
                        }

                        return parts.join('\n');
                    })(),
                }}
                initialQuery={submittedQuery}
                onNewQuery={(newQuery) => setSubmittedQuery(newQuery)}
                useClaudeBackend={true}
                claudeSystemPreamble={`You are helping Kate Schnetzer prep for and understand her sales deal with ${headerTitle}. Use the deal context below — contact, company, cumulative summary, every past meeting with its full summary and transcript, SDR triage notes, and upcoming meeting prep — to answer her question. Cite specific evidence from the transcripts, summaries, or notes. Be concise (2-5 sentences) and direct. If the context doesn't contain an answer, say so rather than guessing.`}
            />
        </div>
    );
};

export default DealDetails;
