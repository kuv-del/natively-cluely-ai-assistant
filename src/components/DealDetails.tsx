import React, { useState, useEffect } from 'react';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { ArrowLeft, Link, FileText } from 'lucide-react';
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
    past_meetings: 'Meetings',
    prep: 'Prep',
};

const AVAILABLE_TABS: TabKey[] = ['summary', 'profile', 'grade', 'past_meetings', 'prep'];

// ─── Kate's Deal Stage — derived from HubSpot deal stage + meeting data ──────

type StageCategory = 'todo' | 'in_progress' | 'complete';

interface KateStage {
    label: string;
    category: StageCategory;
}

// Map HubSpot internal deal_stage values → Kate's stage labels
function deriveKateStage(
    dealStage: string | undefined,
    offerMade: boolean | string | undefined,
    meetings: { discovery: any[]; demo: any[]; followup: any[]; sdr_triage?: any[] },
    _upcomingMeeting?: any | null,
): KateStage {
    const hasDiscovery = meetings.discovery?.length > 0;
    const hasDemo = meetings.demo?.length > 0;
    const hasFollowup = meetings.followup?.length > 0;
    const offer = offerMade === true || offerMade === 'Yes' || offerMade === 'true';

    // Complete states
    if (dealStage === '113267853') return { label: 'Closed/Won', category: 'complete' };
    if (dealStage === '85094266') return { label: 'Closed/Lost', category: 'complete' };

    // In-progress states (offer made)
    if (offer) {
        if (hasFollowup) return { label: 'Offer Made - FUP Scheduled', category: 'in_progress' };
        return { label: 'Offer Made - No FUP Scheduled', category: 'in_progress' };
    }

    // To-do states
    if (dealStage === '83755899' && hasDemo && !offer) return { label: 'No Offer but Qed - 2nd Demo', category: 'todo' };
    if (hasDemo) return { label: 'Demo Scheduled', category: 'todo' };
    if (hasDiscovery && !hasDemo) return { label: 'Discovery Scheduled', category: 'todo' };

    // Default
    if (dealStage) return { label: 'Demo Scheduled', category: 'todo' };
    return { label: 'Discovery Scheduled', category: 'todo' };
}

function getStagePillStyle(stage: KateStage, isLight: boolean): string {
    if (stage.label === 'Closed/Won') {
        return 'bg-emerald-500 text-white border-emerald-600';
    }
    switch (stage.category) {
        case 'todo':
            return isLight
                ? 'bg-gray-500 text-white border-gray-600'
                : 'bg-gray-600 text-white border-gray-500';
        case 'in_progress':
            return isLight
                ? 'bg-pink-400 text-white border-pink-500'
                : 'bg-pink-500 text-white border-pink-400';
        case 'complete':
            return isLight
                ? 'bg-gray-700 text-white border-gray-800'
                : 'bg-gray-700 text-white border-gray-600';
    }
}

// ─── Meeting type pretty labels ───────────────────────────────────────────────

const MEETING_TYPE_PRETTY: Record<string, string> = {
    discovery: 'Discovery Call',
    demo: 'Demo Call',
    followup: 'Follow Up',
    sdr_triage: 'SDR Triage Call',
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
// Old HubSpot stage pill style — kept for Profile tab
function getHubspotStagePillStyle(stage: string | undefined | null): string {
    if (!stage) return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    switch (stage) {
        case 'decisionmakerboughtin':
        case '83755899':
            return 'bg-orange-500/10 text-orange-400 border-orange-500/30';
        case '250536552':
        case '250536553':
            return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
        case '113267853':
            return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
        case '85094266':
            return 'bg-red-500/10 text-red-400 border-red-500/30';
        default:
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

// Parse a markdown summary into section blocks by H2/H3 headings.
// If no headings, returns a single section with the whole body (caller then falls back to normal rendering).
function parseSummaryIntoSections(md: string): Array<{ title: string; body: string }> {
    const lines = md.split(/\r?\n/);
    const sections: Array<{ title: string; body: string }> = [];
    let current: { title: string; body: string } | null = null;
    const headingRx = /^\s{0,3}(#{2,3})\s+(.+?)\s*#*\s*$/;
    const boldHeadingRx = /^\s{0,3}\*\*(.+?)\*\*\s*:?\s*$/;
    for (const line of lines) {
        const h = line.match(headingRx) || line.match(boldHeadingRx);
        if (h) {
            if (current) sections.push({ title: current.title, body: current.body.trim() });
            const title = (h[2] ?? h[1]).trim();
            current = { title, body: '' };
        } else if (current) {
            current.body += line + '\n';
        } else {
            current = { title: '', body: line + '\n' };
        }
    }
    if (current) sections.push({ title: current.title, body: current.body.trim() });
    return sections.filter(s => s.title || s.body);
}

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

const DealDetails: React.FC<DealDetailsProps> = ({ contactId, onBack }) => {
    const isLight = useResolvedTheme() === 'light';
    const [data, setData] = useState<DealDetailsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabKey>('summary');
    const [expandedTranscripts, setExpandedTranscripts] = useState<Record<string, boolean>>({});

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
        <div className="h-full w-full flex flex-col bg-bg-secondary text-text-secondary font-sans overflow-hidden">
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
                            <h1
                                className="text-3xl font-bold text-text-primary tracking-tight mb-2"
                                style={{ fontFamily: '"Playfair Display", "Times New Roman", serif', fontWeight: 600, letterSpacing: '-0.02em' }}
                            >
                                {loading ? (
                                    <span className="opacity-40">Loading…</span>
                                ) : (
                                    headerTitle
                                )}
                            </h1>

                            {/* Header meta row: Kate's deal stage + dates */}
                            {!loading && data && (() => {
                                const kateStage = deriveKateStage(
                                    deal?.deal_stage,
                                    deal?.offer_made,
                                    data.meetings_by_type || { discovery: [], demo: [], followup: [], sdr_triage: [] },
                                    data.upcoming_meeting
                                );
                                // Find demo date from first demo meeting
                                const demoMeeting = (data.meetings_by_type?.demo ?? [])[0]?.meeting;
                                const demoDate = demoMeeting?.start_time;
                                // Expected close date from deal
                                const expectedClose = (deal as any)?.expected_close_date;
                                // Next meeting from upcoming
                                const nextMeeting = data.upcoming_meeting?.meeting;
                                const nextMeetingDate = nextMeeting?.start_time;

                                const formatDate = (iso: string | undefined) => {
                                    if (!iso) return '—';
                                    const d = new Date(iso);
                                    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                };
                                const formatDateTime = (iso: string | undefined) => {
                                    if (!iso) return '—';
                                    const d = new Date(iso);
                                    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                        + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                                };

                                return (
                                    <div className="flex items-center gap-3 flex-wrap">
                                        {/* Kate's stage pill */}
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${getStagePillStyle(kateStage, isLight)}`}>
                                            {kateStage.label}
                                        </span>
                                        {/* Dates row */}
                                        <div className="flex items-center gap-4 text-[11px] text-text-tertiary">
                                            {demoDate && <span>Demo: <span className="text-text-secondary">{formatDateTime(demoDate)}</span></span>}
                                            {expectedClose && <span>Close: <span className="text-text-secondary">{formatDate(expectedClose)}</span></span>}
                                            {nextMeetingDate && <span>Next: <span className="text-text-secondary">{formatDateTime(nextMeetingDate)}</span></span>}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Tab strip */}
                    <div className="flex items-center justify-between mb-8 -mx-8 px-8 py-3" style={{ background: '#EEEDE9' }}>
                        <div className="flex gap-2">
                            {AVAILABLE_TABS.map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    style={{
                                        background: activeTab === tab ? '#1B1B1B' : 'transparent',
                                        color: activeTab === tab ? '#FFFFFF' : 'rgba(27,27,27,0.6)',
                                        borderRadius: 999,
                                        padding: '6px 16px',
                                        fontWeight: activeTab === tab ? 600 : 400,
                                        fontSize: 13,
                                        border: 'none',
                                        cursor: 'pointer',
                                        transition: 'background-color 0.2s, color 0.2s',
                                    }}
                                    onMouseEnter={(e) => {
                                        if (activeTab !== tab) {
                                            (e.currentTarget as HTMLButtonElement).style.background = '#E5E3DD';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (activeTab !== tab) {
                                            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                                        }
                                    }}
                                >
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
                                                        value={(deal as any)?.sdr_owner || deal?.sdr_owner_name}
                                                        href={deal?.sdr_slack_id ? slackDmUrl(deal.sdr_slack_id) : undefined}
                                                    />
                                                    <ProfileRow label="Deal Stage" value={getDealStageLabel(deal?.deal_stage)} />
                                                    <ProfileRow label="Demo Outcome" value={(deal as any)?.decision_call_outcome || 'None Selected'} />
                                                    <ProfileRow label="Offer Made" value={deal?.offer_made === true ? 'Yes' : deal?.offer_made === false ? 'No' : 'None Selected'} />
                                                    <ProfileRow label="Expected Close Date" value={deal?.expected_close_date || 'None Selected'} />
                                                    <ProfileRow label="Next Steps" value={(deal as any)?.next_steps || 'None Selected'} />
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
                                    <div className="space-y-8">
                                        {flatPastMeetings.map((group, idx) => {
                                            const typeLabel = getMeetingTypeLabel(group._meetingType);
                                            const dateStr = formatMeetingDate(group.meeting?.start_time);
                                            const summary = group.summary ?? null;
                                            const meetingRef = group.meeting;
                                            return (
                                                <div key={`${group._meetingType}-${idx}`} className="space-y-2">
                                                    {/* Meeting heading */}
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h3 className="text-[14px] font-semibold text-text-primary leading-snug">
                                                            {typeLabel}
                                                            {dateStr && (
                                                                <span className="font-normal text-text-tertiary ml-2 text-[13px]">on {dateStr}</span>
                                                            )}
                                                        </h3>
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                                            meetingRef?.hs_activity_type
                                                                ? isLight ? 'bg-blue-50 text-blue-600 border border-blue-200' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                                                : isLight ? 'bg-gray-100 text-gray-500 border border-gray-200' : 'bg-white/5 text-text-tertiary border border-white/10'
                                                        }`}>
                                                            {meetingRef?.hs_activity_type || 'None Selected'}
                                                        </span>
                                                    </div>

                                                    {/* Summary content — if headings present, render as structured Section cards */}
                                                    {summary ? (() => {
                                                        const sections = parseSummaryIntoSections(summary);
                                                        if (sections.length > 1) {
                                                            return (
                                                                <div className="space-y-2 pl-1">
                                                                    {sections.map((sec, i) => (
                                                                        <div key={i} className={`rounded-md border ${isLight ? 'border-gray-200 bg-white/60' : 'border-white/10 bg-white/5'} px-3 py-2`}>
                                                                            {sec.title && (
                                                                                <div className={`text-[12px] font-semibold mb-1 ${isLight ? 'text-blue-700' : 'text-blue-300'}`}>{sec.title}</div>
                                                                            )}
                                                                            <div className="prose prose-sm prose-invert max-w-none text-[13px] leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5">
                                                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{sec.body}</ReactMarkdown>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            );
                                                        }
                                                        return (
                                                            <div className="prose prose-sm prose-invert max-w-none text-[13px] leading-relaxed [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5 pl-1">
                                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
                                                            </div>
                                                        );
                                                    })() : (
                                                        <p className="text-[13px] text-text-tertiary italic pl-1">Summary generating…</p>
                                                    )}

                                                    {/* Expandable transcript */}
                                                    {group.transcript && (() => {
                                                        // Transcript can be an array of segments or a plain string (Zoom/Gong)
                                                        const rawTx: any = group.transcript;
                                                        const segments: Array<{speaker: string; text: string}> = Array.isArray(rawTx)
                                                            ? rawTx
                                                            : typeof rawTx === 'string' && rawTx.length > 0
                                                                ? rawTx.split('\n').filter((l: string) => l.trim()).map((line: string) => {
                                                                    const match = line.match(/^([^:]+):\s*(.+)/);
                                                                    return match
                                                                        ? { speaker: match[1].trim(), text: match[2].trim() }
                                                                        : { speaker: 'Transcript', text: line.trim() };
                                                                })
                                                                : [];
                                                        if (segments.length === 0) return null;
                                                        const PREVIEW_COUNT = 4;
                                                        const txKey = `${group._meetingType}-${idx}`;
                                                        const isExpanded = expandedTranscripts[txKey];
                                                        const visibleSegments = isExpanded ? segments : segments.slice(0, PREVIEW_COUNT);
                                                        const hasMore = segments.length > PREVIEW_COUNT;
                                                        return (
                                                            <div className="mt-3">
                                                                <button
                                                                    onClick={() => setExpandedTranscripts(prev => ({
                                                                        ...prev,
                                                                        [txKey]: !isExpanded
                                                                    }))}
                                                                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${isLight ? 'bg-bg-elevated text-text-secondary border-border-muted hover:bg-bg-item-active hover:text-text-primary' : 'bg-white/5 text-text-tertiary border-white/10 hover:bg-white/10 hover:text-text-primary'}`}
                                                                >
                                                                    {isExpanded ? 'Hide Transcript ▴' : 'Transcript →'}
                                                                </button>
                                                                {isExpanded && (
                                                                    <div className={`mt-2 rounded-lg border ${isLight ? 'bg-bg-elevated/50 border-border-muted' : 'bg-white/3 border-white/6'} p-3 space-y-2`}>
                                                                        {segments.map((seg, si) => (
                                                                            <div key={si} className="flex gap-2 text-[12px] leading-relaxed">
                                                                                <span className={`shrink-0 font-medium ${seg.speaker === 'Kate Schnetzer' || seg.speaker === 'user' || seg.speaker === 'Me' ? 'text-blue-400' : 'text-emerald-400'}`}>
                                                                                    {seg.speaker === 'user' ? 'Me' : seg.speaker === 'interviewer' ? 'Them' : seg.speaker}:
                                                                                </span>
                                                                                <span className="text-text-secondary">{seg.text}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })()}

                                                    {/* Divider between entries */}
                                                    {idx < flatPastMeetings.length - 1 && (
                                                        <div className={`mt-6 border-t ${isLight ? 'border-black/8' : 'border-white/6'}`} />
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
        </div>
    );
};

export default DealDetails;
