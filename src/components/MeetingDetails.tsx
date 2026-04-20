import React, { useState, useEffect } from 'react';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { ArrowLeft, Search, Mail, Link, ChevronDown, Play, ArrowUp, Copy, Check, MoreHorizontal, Settings, ArrowRight, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import MeetingChatOverlay from './MeetingChatOverlay';
import EditableTextBlock from './EditableTextBlock';
import NativelyLogo from './icon.png';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import DossierView, { Dossier } from './DossierView';
import {
    getDealStageLabel,
    hubspotContactUrl,
    hubspotDealUrl,
    getCallTypeLabel,
    slackDmUrl,
    formatPhone,
    normalizeUrl
} from '../lib/hubspot-mapping';

const formatTime = (ms: number) => {
    const date = new Date(ms);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase();
};

const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;
};

const cleanMarkdown = (content: string) => {
    if (!content) return '';
    // Ensure code blocks are on new lines to fix rendering issues
    return content.replace(/([^\n])```/g, '$1\n\n```');
};

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration: string;
    summary: string;
    calendarEventId?: string;
    isUpcoming?: boolean;
    detailedSummary?: {
        overview?: string;
        actionItems: string[];
        keyPoints: string[];
        actionItemsTitle?: string;
        keyPointsTitle?: string;
        sections?: Array<{ title: string; bullets: string[] }>;
    };
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
}

interface MeetingDetailsProps {
    meeting: Meeting;
    onBack: () => void;
    onOpenSettings: () => void;
    onOpenDealDetails?: (contactId: string) => void;
}

const MeetingDetails: React.FC<MeetingDetailsProps> = ({ meeting: initialMeeting, onOpenDealDetails }) => {
    const isLight = useResolvedTheme() === 'light';
    // We need local state for the meeting object to reflect optimistic updates
    const [meeting, setMeeting] = useState<Meeting>(initialMeeting);
    // Default tab: Prep first if this is an upcoming meeting (no recording yet),
    // otherwise Summary. The dossier-loaded effect below may auto-flip to Prep
    // if a dossier exists on a recorded meeting.
    const [activeTab, setActiveTab] = useState<'prep' | 'profile' | 'summary' | 'transcript' | 'usage'>(
        meeting.isUpcoming ? 'prep' : 'summary'
    );
    // Prep dossier — loaded async if this meeting has a calendarEventId
    const [prepDossier, setPrepDossier] = useState<Dossier | null>(null);
    const [prepChecked, setPrepChecked] = useState(false);

    // Profile data — loaded from Convex via calendar_event_id lookup
    const [profile, setProfile] = useState<{
        meeting: { id: string; calendar_event_id: string; contact_id?: string | null; title: string; meeting_type?: string; start_time: string; end_time?: string; zoom_link?: string; source?: string };
        contact: { first_name?: string; last_name?: string; email?: string; phone?: string; hubspot_contact_id?: string } | null;
        company: { company_name?: string; company_website?: string; company_revenue?: string; employee_count?: string; company_location?: string; industry?: string; hubspot_company_id?: string } | null;
        deal: { hubspot_deal_id?: string; deal_stage?: string; sdr_owner_name?: string; sdr_email?: string; sdr_slack_id?: string } | null;
    } | null>(null);
    const [profileChecked, setProfileChecked] = useState(false);

    // Fetch Convex profile (contact + company + deal) for this meeting.
    // Re-fetches on calendar event id change AND on window focus so deal-stage
    // updates from the HubSpot webhook propagate when Kate switches back.
    useEffect(() => {
        let cancelled = false;
        const eventId = meeting.calendarEventId;
        if (!eventId) {
            setProfileChecked(true);
            return;
        }

        const load = () => {
            window.electronAPI?.convexGetMeetingProfile?.(eventId)
                .then((data) => {
                    if (!cancelled) {
                        setProfile(data);
                        setProfileChecked(true);
                    }
                })
                .catch(() => {
                    if (!cancelled) setProfileChecked(true);
                });
        };

        load();
        const onFocus = () => load();
        window.addEventListener('focus', onFocus);

        return () => {
            cancelled = true;
            window.removeEventListener('focus', onFocus);
        };
    }, [meeting.calendarEventId]);

    // Fetch the dossier (if any) for this meeting's calendar event id.
    // Default the active tab to 'prep' if a dossier exists.
    useEffect(() => {
        let cancelled = false;
        const eventId = meeting.calendarEventId;
        if (!eventId) {
            setPrepChecked(true);
            return;
        }
        window.electronAPI?.scriptHelperReadDossier?.(eventId)
            .then((d) => {
                if (cancelled) return;
                if (d) {
                    setPrepDossier(d as Dossier);
                    // Only auto-switch on first load — don't fight a user's later tab clicks
                    setActiveTab((current) => (current === 'summary' ? 'prep' : current));
                }
                setPrepChecked(true);
            })
            .catch(() => {
                if (!cancelled) setPrepChecked(true);
            });
        return () => {
            cancelled = true;
        };
    }, [meeting.calendarEventId]);

    // Tab list — Prep + Profile always available on the meeting detail page.
    // Profile renders Convex-sourced contact/company/deal data when present,
    // falls back to an empty state otherwise.
    const availableTabs: Array<'prep' | 'profile' | 'summary' | 'transcript' | 'usage'> = [
        'prep', 'profile', 'summary', 'transcript', 'usage'
    ];
    const [query, setQuery] = useState('');
    const [isCopied, setIsCopied] = useState(false);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [submittedQuery, setSubmittedQuery] = useState('');

    const handleSubmitQuestion = () => {
        if (query.trim()) {
            setSubmittedQuery(query);
            if (!isChatOpen) {
                setIsChatOpen(true);
            }
            setQuery('');
        }
    };

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && query.trim()) {
            e.preventDefault();
            handleSubmitQuestion();
        }
    };

    const handleCopy = async () => {
        let textToCopy = '';

        if (activeTab === 'summary' && meeting.detailedSummary) {
            textToCopy = `
Meeting: ${meeting.title}
Date: ${new Date(meeting.date).toLocaleDateString()}

OVERVIEW:
${meeting.detailedSummary.overview || ''}

ACTION ITEMS:
${meeting.detailedSummary.actionItems?.map(item => `- ${item}`).join('\n') || 'None'}

KEY POINTS:
${meeting.detailedSummary.keyPoints?.map(item => `- ${item}`).join('\n') || 'None'}
            `.trim();
        } else if (activeTab === 'transcript' && meeting.transcript) {
            textToCopy = meeting.transcript.map(t => `[${formatTime(t.timestamp)}] ${t.speaker === 'user' ? 'Me' : 'Them'}: ${t.text}`).join('\n');
        } else if (activeTab === 'usage' && meeting.usage) {
            textToCopy = meeting.usage.map(u => `Q: ${u.question || ''}\nA: ${u.answer || ''}`).join('\n\n');
        }

        if (!textToCopy) return;

        try {
            await navigator.clipboard.writeText(textToCopy);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy content:', err);
        }
    };

    // UPDATE HANDLERS
    const handleTitleSave = async (newTitle: string) => {
        setMeeting(prev => ({ ...prev, title: newTitle }));
        if (window.electronAPI?.updateMeetingTitle) {
            await window.electronAPI.updateMeetingTitle(meeting.id, newTitle);
        }
    };

    const handleOverviewSave = async (newOverview: string) => {
        setMeeting(prev => ({
            ...prev,
            detailedSummary: {
                ...prev.detailedSummary!,
                overview: newOverview
            }
        }));
        if (window.electronAPI?.updateMeetingSummary) {
            await window.electronAPI.updateMeetingSummary(meeting.id, { overview: newOverview });
        }
    };

    const handleActionItemSave = async (index: number, newVal: string) => {
        const newItems = [...(meeting.detailedSummary?.actionItems || [])];
        if (!newVal.trim()) {
            // Optional: Remove empty items? For now just keep empty or update
        }
        newItems[index] = newVal;

        setMeeting(prev => ({
            ...prev,
            detailedSummary: {
                ...prev.detailedSummary!,
                actionItems: newItems
            }
        }));

        if (window.electronAPI?.updateMeetingSummary) {
            await window.electronAPI.updateMeetingSummary(meeting.id, { actionItems: newItems });
        }
    };

    const handleKeyPointSave = async (index: number, newVal: string) => {
        const newItems = [...(meeting.detailedSummary?.keyPoints || [])];
        newItems[index] = newVal;

        setMeeting(prev => ({
            ...prev,
            detailedSummary: {
                ...prev.detailedSummary!,
                keyPoints: newItems
            }
        }));

        if (window.electronAPI?.updateMeetingSummary) {
            await window.electronAPI.updateMeetingSummary(meeting.id, { keyPoints: newItems });
        }
    };


    return (
        <div className="h-full w-full flex flex-col bg-bg-secondary text-text-secondary font-sans overflow-hidden">
            {/* Main Content */}
            <main className="flex-1 overflow-y-auto custom-scrollbar">
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.3 }}
                    className="max-w-4xl mx-auto px-8 py-8 pb-32" // Added pb-32 for floating footer clearance
                >
                    {/* Meta Info & Actions Row */}
                    <div className="flex items-start justify-between mb-6">
                        <div className="w-full pr-4">
                            {/* Date · time range · pretty call type pill */}
                            <div className="text-xs text-text-tertiary font-medium mb-1 flex items-center gap-2 flex-wrap">
                                <span>
                                    {new Date(profile?.meeting?.start_time || meeting.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                                </span>
                                {profile?.meeting?.start_time && profile?.meeting?.end_time && (
                                    <>
                                        <span className="opacity-40">·</span>
                                        <span>
                                            {new Date(profile.meeting.start_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                            {' – '}
                                            {new Date(profile.meeting.end_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                        </span>
                                    </>
                                )}
                                {getCallTypeLabel(profile?.meeting?.meeting_type) && (
                                    <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
                                        {getCallTypeLabel(profile?.meeting?.meeting_type)}
                                    </span>
                                )}
                            </div>

                            {/* Editable Title */}
                            <EditableTextBlock
                                initialValue={meeting.title}
                                onSave={handleTitleSave}
                                tagName="h1"
                                className="text-3xl font-bold text-text-primary tracking-tight -ml-2 px-2 py-1 rounded-md transition-colors"
                                multiline={false}
                            />
                        </div>

                        {/* View Deal button — only when meeting has a linked contact_id */}
                        {onOpenDealDetails && profile?.meeting?.contact_id ? (
                            <div className="flex items-center shrink-0 mt-1">
                                <button
                                    onClick={() => onOpenDealDetails(profile!.meeting.contact_id!)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 transition-colors whitespace-nowrap"
                                >
                                    View Deal
                                </button>
                            </div>
                        ) : null}
                    </div>

                    {/* Tabs */}
                    {/* Designing Tabs to match reference 1:1 (Dark Pill Container) */}
                    <div className="flex items-center justify-between mb-8">
                        <div className={`p-1 rounded-xl inline-flex items-center gap-0.5 ${isLight ? 'bg-[#E5E5EA] border border-black/[0.04]' : 'bg-[#121214] border border-white/[0.08]'}`}>
                            {availableTabs.map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab as any)}
                                    className={`
                                        relative px-3 py-1 text-[13px] font-medium rounded-lg transition-all duration-200 z-10
                                        ${activeTab === tab ? (isLight ? 'text-black' : 'text-[#E9E9E9]') : `${isLight ? 'text-text-secondary' : 'text-text-tertiary'} hover:text-text-primary`}
                                    `}
                                >
                                    {activeTab === tab && (
                                        <motion.div
                                            layoutId="activeTabBackground"
                                            className={`absolute inset-0 rounded-lg -z-10 shadow-sm ${isLight ? 'bg-white' : 'bg-[#3A3A3C]'}`}
                                            initial={false}
                                            transition={{ type: "spring", stiffness: 400, damping: 30 }}
                                        />
                                    )}
                                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </button>
                            ))}
                        </div>

                        {/* Copy Button - Inline with Tabs (Always visible) */}
                        <button
                            onClick={handleCopy}
                            className="flex items-center gap-2 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
                        >
                            {isCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                            {isCopied ? 'Copied' : activeTab === 'summary' ? 'Copy full summary' : activeTab === 'transcript' ? 'Copy full transcript' : 'Copy usage'}
                        </button>
                    </div>

                    {/* Tab Content */}
                    <div className="space-y-8">
                        {activeTab === 'prep' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                {prepDossier ? (
                                    <DossierView dossier={prepDossier} variant="page" readOnly={!meeting.isUpcoming} />
                                ) : !prepChecked ? (
                                    <div className="text-text-tertiary text-sm py-8">Loading prep…</div>
                                ) : meeting.calendarEventId ? (
                                    <div className="flex flex-col items-center justify-center text-center py-16 space-y-3">
                                        <FileText className="w-8 h-8 text-text-tertiary opacity-60" />
                                        <div className="text-[13px] font-medium text-text-primary">No prep dossier for this meeting</div>
                                        <div className="text-[11px] text-text-tertiary leading-relaxed max-w-[360px]">
                                            Drop a dossier JSON at <code className="text-[10px] text-text-secondary">~/Library/Application Support/natively/prep/{meeting.calendarEventId}.json</code> and reopen this page.
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center text-center py-16 space-y-3">
                                        <FileText className="w-8 h-8 text-text-tertiary opacity-60" />
                                        <div className="text-[13px] font-medium text-text-primary">No prep available</div>
                                        <div className="text-[11px] text-text-tertiary leading-relaxed max-w-[360px]">
                                            This meeting wasn't started from a calendar event, so there's no event ID to look up a prep dossier. Future meetings started from your calendar will have prep notes here.
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        )}

                        {activeTab === 'profile' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                {!profileChecked ? (
                                    <div className="text-text-tertiary text-sm py-8">Loading profile…</div>
                                ) : profile ? (
                                    <div className="space-y-6 max-w-2xl">
                                        {/* Contact identity */}
                                        <div>
                                            <h3 className="text-[11px] uppercase tracking-wider text-text-tertiary font-bold mb-3">Contact</h3>
                                            <div className="space-y-2">
                                                <ProfileRow
                                                    label="Name"
                                                    value={[profile.contact?.first_name, profile.contact?.last_name].filter(Boolean).join(' ') || undefined}
                                                />
                                                <ProfileRow
                                                    label="Email"
                                                    value={profile.contact?.email}
                                                    href={profile.contact?.email ? `mailto:${profile.contact.email}` : undefined}
                                                />
                                                {(() => {
                                                    const phone = formatPhone(profile.contact?.phone);
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
                                        <div>
                                            <h3 className="text-[11px] uppercase tracking-wider text-text-tertiary font-bold mb-3">Company</h3>
                                            <div className="space-y-2">
                                                <ProfileRow
                                                    label="Company"
                                                    value={profile.company?.company_name}
                                                    href={normalizeUrl(profile.company?.company_website) || undefined}
                                                />
                                                <ProfileRow label="Location" value={profile.company?.company_location} />
                                                <ProfileRow label="Revenue" value={profile.company?.company_revenue} />
                                                <ProfileRow label="Team Size" value={profile.company?.employee_count} />
                                            </div>
                                        </div>
                                        {/* Deal & SDR */}
                                        <div>
                                            <h3 className="text-[11px] uppercase tracking-wider text-text-tertiary font-bold mb-3">Deal</h3>
                                            <div className="space-y-2">
                                                <ProfileRow
                                                    label="SDR Owner"
                                                    value={profile.deal?.sdr_owner_name}
                                                    href={profile.deal?.sdr_slack_id ? slackDmUrl(profile.deal.sdr_slack_id) : undefined}
                                                />
                                                <ProfileRow label="Deal Stage" value={getDealStageLabel(profile.deal?.deal_stage)} />
                                            </div>
                                        </div>
                                        {/* HubSpot links */}
                                        {(profile.contact?.hubspot_contact_id || profile.deal?.hubspot_deal_id) && (
                                            <div>
                                                <h3 className="text-[11px] uppercase tracking-wider text-text-tertiary font-bold mb-3">HubSpot</h3>
                                                <div className="flex flex-wrap gap-2">
                                                    {profile.contact?.hubspot_contact_id && (
                                                        <a
                                                            href={hubspotContactUrl(profile.contact.hubspot_contact_id)}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                window.electronAPI?.openExternal?.(hubspotContactUrl(profile.contact!.hubspot_contact_id!));
                                                            }}
                                                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] font-medium bg-orange-500/10 text-orange-500 border border-orange-500/30 hover:bg-orange-500/20 transition-colors"
                                                        >
                                                            <Link size={12} />
                                                            HubSpot Contact
                                                        </a>
                                                    )}
                                                    {profile.deal?.hubspot_deal_id && (
                                                        <a
                                                            href={hubspotDealUrl(profile.deal.hubspot_deal_id)}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                window.electronAPI?.openExternal?.(hubspotDealUrl(profile.deal!.hubspot_deal_id!));
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
                                    <div className="flex flex-col items-center justify-center text-center py-16 space-y-3">
                                        <FileText className="w-8 h-8 text-text-tertiary opacity-60" />
                                        <div className="text-[13px] font-medium text-text-primary">No profile available</div>
                                        <div className="text-[11px] text-text-tertiary leading-relaxed max-w-[360px]">
                                            This meeting isn't linked to a HubSpot deal in Convex, so we don't have prospect details to show. Sales meetings booked through your HubSpot workflow will have profile data here automatically.
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        )}
                        {/* Using standard divs for content, framer motion for layout */}
                        {activeTab === 'summary' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                {/* Overview - Rendered as Markdown */}
                                {meeting.detailedSummary?.overview && (
                                <div className="mb-6 pb-6 border-b border-border-subtle prose prose-sm max-w-none">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            h1: ({ node, ...props }) => <h1 className="text-xl font-bold text-text-primary mt-4 mb-2" {...props} />,
                                            h2: ({ node, ...props }) => <h2 className="text-lg font-semibold text-text-primary mt-4 mb-2" {...props} />,
                                            h3: ({ node, ...props }) => <h3 className="text-base font-semibold text-text-primary mt-3 mb-1" {...props} />,
                                            p: ({ node, ...props }) => <p className="text-sm text-text-secondary leading-relaxed mb-2" {...props} />,
                                            ul: ({ node, ...props }) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                                            ol: ({ node, ...props }) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                                            li: ({ node, ...props }) => <li className="text-sm text-text-secondary" {...props} />,
                                            strong: ({ node, ...props }) => <strong className="font-semibold text-text-primary" {...props} />,
                                            a: ({ node, ...props }) => <a className="text-blue-500 hover:underline" {...props} />,
                                        }}
                                    >
                                        {meeting.detailedSummary?.overview || ''}
                                    </ReactMarkdown>
                                </div>
                                )}

                                {/* Action Items - Only show if there are items */}
                                {meeting.detailedSummary?.actionItems && meeting.detailedSummary.actionItems.length > 0 && (
                                    <section className="mb-8">
                                        <div className="flex items-center justify-between mb-4">
                                            <EditableTextBlock
                                                initialValue={meeting.detailedSummary?.actionItemsTitle || 'Action Items'}
                                                onSave={(val) => {
                                                    setMeeting(prev => ({
                                                        ...prev,
                                                        detailedSummary: { ...prev.detailedSummary!, actionItemsTitle: val }
                                                    }));
                                                    window.electronAPI?.updateMeetingSummary(meeting.id, { actionItemsTitle: val });
                                                }}
                                                tagName="h2"
                                                className="text-lg font-semibold text-text-primary -ml-2 px-2 py-1 rounded-sm transition-colors"
                                                multiline={false}
                                            />
                                        </div>
                                        <ul className="space-y-3">
                                            {meeting.detailedSummary.actionItems.map((item, i) => (
                                                <li key={i} className="flex items-start gap-3 group">
                                                    <div className="mt-2 w-1.5 h-1.5 rounded-full bg-text-secondary group-hover:bg-blue-500 transition-colors shrink-0" />
                                                    <div className="flex-1">
                                                        <EditableTextBlock
                                                            initialValue={item}
                                                            onSave={(val) => handleActionItemSave(i, val)}
                                                            tagName="p"
                                                            className="text-sm text-text-secondary leading-relaxed -ml-2 px-2 rounded-sm transition-colors"
                                                            placeholder="Type an action item..."
                                                            onEnter={() => {
                                                                const newItems = [...(meeting.detailedSummary?.actionItems || [])];
                                                                newItems.splice(i + 1, 0, "");
                                                                setMeeting(prev => ({
                                                                    ...prev,
                                                                    detailedSummary: { ...prev.detailedSummary!, actionItems: newItems }
                                                                }));
                                                            }}
                                                        />
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {/* Key Points - Only show if there are items */}
                                {meeting.detailedSummary?.keyPoints && meeting.detailedSummary.keyPoints.length > 0 && (
                                    <section>
                                        <div className="flex items-center justify-between mb-4">
                                            <EditableTextBlock
                                                initialValue={meeting.detailedSummary?.keyPointsTitle || 'Key Points'}
                                                onSave={(val) => {
                                                    setMeeting(prev => ({
                                                        ...prev,
                                                        detailedSummary: { ...prev.detailedSummary!, keyPointsTitle: val }
                                                    }));
                                                    window.electronAPI?.updateMeetingSummary(meeting.id, { keyPointsTitle: val });
                                                }}
                                                tagName="h2"
                                                className="text-lg font-semibold text-text-primary -ml-2 px-2 py-1 rounded-sm transition-colors"
                                                multiline={false}
                                            />
                                        </div>
                                        <ul className="space-y-3">
                                            {meeting.detailedSummary.keyPoints.map((item, i) => (
                                                <li key={i} className="flex items-start gap-3 group">
                                                    <div className="mt-2 w-1.5 h-1.5 rounded-full bg-text-secondary group-hover:bg-purple-500 transition-colors shrink-0" />
                                                    <div className="flex-1">
                                                        <EditableTextBlock
                                                            initialValue={item}
                                                            onSave={(val) => handleKeyPointSave(i, val)}
                                                            tagName="p"
                                                            className="text-sm text-text-secondary leading-relaxed -ml-2 px-2 rounded-sm transition-colors"
                                                            placeholder="Type a key point..."
                                                            onEnter={() => {
                                                                const newItems = [...(meeting.detailedSummary?.keyPoints || [])];
                                                                newItems.splice(i + 1, 0, "");
                                                                setMeeting(prev => ({
                                                                    ...prev,
                                                                    detailedSummary: { ...prev.detailedSummary!, keyPoints: newItems }
                                                                }));
                                                            }}
                                                        />
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {/* Mode-specific sections (when active mode has a notes template) */}
                                {meeting.detailedSummary?.sections && meeting.detailedSummary.sections.length > 0 && (
                                    <div className="space-y-8">
                                        {meeting.detailedSummary.sections.map((section, si) => (
                                            section.bullets.length > 0 && (
                                                <section key={si}>
                                                    <div className="flex items-center justify-between mb-4">
                                                        <h2 className="text-lg font-semibold text-text-primary">{section.title}</h2>
                                                    </div>
                                                    <ul className="space-y-3">
                                                        {section.bullets.map((bullet, bi) => (
                                                            <li key={bi} className="flex items-start gap-3 group">
                                                                <div className="mt-2 w-1.5 h-1.5 rounded-full bg-text-secondary shrink-0" />
                                                                <p className="text-sm text-text-secondary leading-relaxed">{bullet}</p>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </section>
                                            )
                                        ))}
                                    </div>
                                )}
                            </motion.div>
                        )}

                        {activeTab === 'transcript' && (
                            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <div className="space-y-6">
                                    {(() => {
                                        console.log('Raw Transcript:', meeting.transcript);
                                        const filteredTranscript = meeting.transcript?.filter(entry => {
                                            const isHidden = ['system', 'ai', 'assistant', 'model'].includes(entry.speaker?.toLowerCase());
                                            if (isHidden) console.log('Filtered out:', entry);
                                            return !isHidden;
                                        }) || [];
                                        console.log('Filtered Transcript:', filteredTranscript);

                                        if (filteredTranscript.length === 0) {
                                            return <p className="text-text-tertiary">No transcript available.</p>;
                                        }

                                        return filteredTranscript.map((entry, i) => (
                                            <div key={i} className="group">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-xs font-semibold text-text-secondary">
                                                        {entry.speaker === 'user' ? 'Me' : 'Them'}
                                                    </span>
                                                    <span className="text-xs text-text-tertiary font-mono">{entry.timestamp ? formatTime(entry.timestamp) : '0:00'}</span>
                                                </div>
                                                <p className="text-text-secondary text-[15px] leading-relaxed transition-colors select-text cursor-text">{entry.text}</p>
                                            </div>
                                        ));
                                    })()}
                                </div>
                            </motion.section>
                        )}

                        {activeTab === 'usage' && (
                            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8 pb-10">
                                {meeting.usage?.map((interaction, i) => (
                                    <div key={i} className="space-y-4">
                                        {/* User Question */}
                                        {interaction.question && (
                                            <div className="flex justify-end">
                                                <div className="bg-accent-primary text-white px-5 py-2.5 rounded-2xl rounded-tr-sm max-w-[80%] text-[15px] leading-relaxed shadow-sm">
                                                    {interaction.question}
                                                </div>
                                            </div>
                                        )}

                                        {/* AI Answer */}
                                        {interaction.answer && (
                                            <div className="flex items-start gap-4">
                                                <div className="mt-1 w-6 h-6 rounded-full bg-bg-input flex items-center justify-center border border-border-subtle shrink-0">
                                                    <img src={NativelyLogo} alt="AI" className="w-4 h-4 opacity-50 object-contain force-black-icon" />
                                                </div>
                                                <div>
                                                    <div className="text-[11px] text-text-tertiary mb-1.5 font-medium">{formatTime(interaction.timestamp)}</div>
                                                    <div className="text-text-secondary text-[15px] leading-relaxed max-w-none">
                                                        <ReactMarkdown
                                                            remarkPlugins={[remarkGfm]}
                                                            components={{
                                                                h1: ({ node, ...props }) => <p className="text-[15px] text-text-secondary font-normal leading-relaxed mb-2 whitespace-pre-wrap" {...props} />,
                                                                h2: ({ node, ...props }) => <p className="text-[15px] text-text-secondary font-normal leading-relaxed mb-2 whitespace-pre-wrap" {...props} />,
                                                                h3: ({ node, ...props }) => <p className="text-[15px] text-text-secondary font-normal leading-relaxed mb-2 whitespace-pre-wrap" {...props} />,
                                                                p: ({ node, ...props }) => <p className="text-[15px] text-text-secondary font-normal leading-relaxed mb-2 whitespace-pre-wrap" {...props} />,
                                                                ul: ({ node, ...props }) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                                                                ol: ({ node, ...props }) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                                                                li: ({ node, ...props }) => <li className="text-[15px] text-text-secondary font-normal" {...props} />,
                                                                strong: ({ node, ...props }) => <span className="font-normal text-text-secondary" {...props} />,
                                                                a: ({ node, ...props }: any) => <a className="text-blue-500 hover:underline" {...props} />,
                                                                pre: ({ children }: any) => <div className="not-prose mb-4">{children}</div>,
                                                                code: ({ node, inline, className, children, ...props }: any) => {
                                                                    const match = /language-(\w+)/.exec(className || '');
                                                                    const isInline = inline ?? false;
                                                                    const lang = match ? match[1] : '';

                                                                    return !isInline ? (
                                                                        <div className="my-3 rounded-xl overflow-hidden border border-white/[0.08] shadow-lg bg-zinc-800/60 backdrop-blur-md">
                                                                            <div className="bg-white/[0.04] px-3 py-1.5 border-b border-white/[0.08]">
                                                                                <span className="text-[10px] uppercase tracking-widest font-semibold text-white/40 font-mono">
                                                                                    {lang || 'CODE'}
                                                                                </span>
                                                                            </div>
                                                                            <div className="bg-transparent">
                                                                                <SyntaxHighlighter
                                                                                    language={lang || 'text'}
                                                                                    style={vscDarkPlus}
                                                                                    customStyle={{
                                                                                        margin: 0,
                                                                                        borderRadius: 0,
                                                                                        fontSize: '13px',
                                                                                        lineHeight: '1.6',
                                                                                        background: 'transparent',
                                                                                        padding: '16px',
                                                                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                                                                                    }}
                                                                                    wrapLongLines={true}
                                                                                    showLineNumbers={true}
                                                                                    lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1.2em', color: 'rgba(255,255,255,0.2)', textAlign: 'right', fontSize: '11px' }}
                                                                                    {...props}
                                                                                >
                                                                                    {String(children).replace(/\n$/, '')}
                                                                                </SyntaxHighlighter>
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <code className="bg-bg-tertiary px-1.5 py-0.5 rounded text-[13px] font-mono text-text-primary border border-border-subtle whitespace-pre-wrap" {...props}>
                                                                            {children}
                                                                        </code>
                                                                    );
                                                                }
                                                            }}
                                                        >
                                                            {cleanMarkdown(interaction.answer || '')}
                                                        </ReactMarkdown>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {!meeting.usage?.length && <p className="text-text-tertiary">No usage history.</p>}
                            </motion.section>
                        )}
                    </div>
                </motion.div>
            </main>

            {/* Floating Footer (Ask Bar) */}
            <div className={`absolute bottom-0 left-0 right-0 p-6 flex justify-center pointer-events-none ${isChatOpen ? 'z-50' : 'z-20'}`}>
                <div className="w-full max-w-[440px] relative group pointer-events-auto">
                    {/* Dark Glass Effect Input (Matching Reference) */}
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleInputKeyDown}
                        placeholder="Ask about this meeting..."
                        className="w-full pl-5 pr-12 py-3 bg-transparent backdrop-blur-[24px] backdrop-saturate-[140%] shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-white/20 rounded-full text-sm text-text-primary placeholder-text-tertiary/70 focus:outline-none transition-shadow duration-200"
                    />
                    <button
                        onClick={handleSubmitQuestion}
                        className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full transition-all duration-200 border border-white/5 ${query.trim() ? 'bg-text-primary text-bg-primary hover:scale-105' : 'bg-bg-item-active text-text-primary hover:bg-bg-item-hover'
                            }`}
                    >
                        <ArrowUp size={16} className="transform rotate-45" />
                    </button>
                </div>
            </div>

            {/* Chat Overlay */}
            <MeetingChatOverlay
                isOpen={isChatOpen}
                onClose={() => {
                    setIsChatOpen(false);
                    setQuery('');
                    setSubmittedQuery('');
                }}
                meetingContext={{
                    id: meeting.id,  // Required for RAG queries
                    title: meeting.title,
                    summary: meeting.detailedSummary?.overview,
                    keyPoints: meeting.detailedSummary?.keyPoints,
                    actionItems: meeting.detailedSummary?.actionItems,
                    transcript: meeting.transcript
                }}
                initialQuery={submittedQuery}
                onNewQuery={(newQuery) => {
                    setSubmittedQuery(newQuery);
                }}
            />
        </div>
    );
};

// Two-column row used by the Profile tab. When `href` is provided, the value
// becomes a click-through link routed via Electron's openExternal so OS protocol
// schemes (mailto:, tel:, slack:, https:) open in the right handler.
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

export default MeetingDetails;
