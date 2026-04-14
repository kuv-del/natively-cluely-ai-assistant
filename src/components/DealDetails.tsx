import React, { useState, useEffect } from 'react';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { ArrowLeft, Link, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import {
    getDealStageLabel,
    hubspotContactUrl,
    hubspotDealUrl,
    slackDmUrl,
    formatPhone,
    normalizeUrl,
} from '../lib/hubspot-mapping';
import type { DealDetailsResponse } from '../types/deal-details';
import DealPrepTab from './deal-tabs/DealPrepTab';
import DealCallTypeTab from './deal-tabs/DealCallTypeTab';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DealDetailsProps {
    contactId: string;
    onBack: () => void;
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

type TabKey = 'discovery' | 'demo' | 'followup' | 'summary' | 'prep' | 'profile' | 'grade';

const TAB_LABELS: Record<TabKey, string> = {
    discovery: 'Discovery Call',
    demo: 'Demo Call',
    followup: 'Follow Up',
    summary: 'Summary',
    prep: 'Prep',
    profile: 'Profile',
    grade: 'Grade',
};

const AVAILABLE_TABS: TabKey[] = ['discovery', 'demo', 'followup', 'summary', 'prep', 'profile', 'grade'];

// ─── Empty state helper ───────────────────────────────────────────────────────

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
    <div className="flex flex-col items-center justify-center text-center py-16 space-y-3">
        <FileText className="w-8 h-8 text-text-tertiary opacity-60" />
        <div className="text-[13px] font-medium text-text-primary">{message}</div>
    </div>
);

// ─── Component ────────────────────────────────────────────────────────────────

const DealDetails: React.FC<DealDetailsProps> = ({ contactId, onBack }) => {
    const isLight = useResolvedTheme() === 'light';
    const [data, setData] = useState<DealDetailsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabKey>('profile');

    const load = () => {
        window.electronAPI?.convexGetDealDetails?.(contactId)
            .then((result) => {
                // If the response has an error field, treat it as no data
                if (result && 'error' in result) {
                    setData(null);
                } else {
                    setData(result);
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
                            <h1 className="text-3xl font-bold text-text-primary tracking-tight">
                                {loading ? (
                                    <span className="opacity-40">Loading…</span>
                                ) : (
                                    headerTitle
                                )}
                            </h1>
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

                        {/* ── Discovery Call tab ────────────────────────────── */}
                        {activeTab === 'discovery' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                {loading ? (
                                    <div className="text-text-tertiary text-sm py-8">Loading…</div>
                                ) : (
                                    <DealCallTypeTab
                                        meetings={data?.meetings_by_type?.discovery ?? []}
                                        callTypeLabel="Discovery Call"
                                    />
                                )}
                            </motion.div>
                        )}

                        {/* ── Demo Call tab ──────────────────────────────────── */}
                        {activeTab === 'demo' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                {loading ? (
                                    <div className="text-text-tertiary text-sm py-8">Loading…</div>
                                ) : (
                                    <DealCallTypeTab
                                        meetings={data?.meetings_by_type?.demo ?? []}
                                        callTypeLabel="Demo Call"
                                    />
                                )}
                            </motion.div>
                        )}

                        {/* ── Follow Up tab ──────────────────────────────────── */}
                        {activeTab === 'followup' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                {loading ? (
                                    <div className="text-text-tertiary text-sm py-8">Loading…</div>
                                ) : (
                                    <DealCallTypeTab
                                        meetings={data?.meetings_by_type?.followup ?? []}
                                        callTypeLabel="Follow Up"
                                    />
                                )}
                            </motion.div>
                        )}

                        {/* ── Summary tab ────────────────────────────────────── */}
                        {activeTab === 'summary' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <EmptyState message="Cumulative summary will generate once call summaries are available (Stage 4)." />
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

                        {/* ── Grade tab ──────────────────────────────────────── */}
                        {activeTab === 'grade' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <EmptyState message="Deal grading coming in a future update (backlog 1.14)." />
                            </motion.div>
                        )}
                    </div>
                </motion.div>
            </main>
        </div>
    );
};

export default DealDetails;
