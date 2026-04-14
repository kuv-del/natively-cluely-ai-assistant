import React from 'react';
import { Briefcase, AlertTriangle, ListChecks, Lightbulb, History } from 'lucide-react';

export interface Dossier {
    event_id?: string;
    prospect?: {
        name?: string;
        title?: string;
        company?: string;
        industry?: string;
        revenue?: string;
        headcount?: number | string;
        deal_stage?: string;
        deal_value?: string;
        last_touchpoint?: string;
    };
    pain_points?: string[];
    script?: Array<{ question: string; notes?: string }>;
    talking_points?: string[];
    previous_meeting_summary?: string;
    [key: string]: any;
}

interface DossierViewProps {
    dossier: Dossier;
    /** Style variant: 'overlay' for the floating Script Helper window (uses overlay-* CSS classes),
     *  'page' for the in-app Meeting Details Prep tab (uses standard page text classes). */
    variant?: 'overlay' | 'page';
    /** When true, script questions are non-interactive (used in past-meeting Prep tab). */
    readOnly?: boolean;
    /** Optional callback when a script question is clicked (overlay variant only) */
    onScriptClick?: (index: number, question: string) => void;
}

/**
 * Shared dossier render component used by both the floating Script Helper window
 * and the Meeting Details Prep tab. Sections (Prospect, Pain Points, Script,
 * Talking Points, Last Meeting) are conditionally rendered based on what's present
 * in the dossier — missing fields are silently skipped.
 */
export const DossierView: React.FC<DossierViewProps> = ({
    dossier,
    variant = 'overlay',
    readOnly = false,
    onScriptClick
}) => {
    const isOverlay = variant === 'overlay';

    // Pick text color classes based on variant
    const cls = {
        primary: isOverlay ? 'overlay-text-primary' : 'text-text-primary',
        secondary: isOverlay ? 'overlay-text-secondary' : 'text-text-secondary',
        muted: isOverlay ? 'overlay-text-muted' : 'text-text-tertiary',
        sectionLabel: isOverlay
            ? 'overlay-text-muted'
            : 'text-text-tertiary',
        scriptButton: isOverlay
            ? 'overlay-chip-surface overlay-chip-surface-hover'
            : 'bg-bg-elevated hover:bg-bg-item-active'
    };

    return (
        <div className={isOverlay ? 'space-y-4' : 'space-y-6'}>
            {/* Prospect */}
            {dossier.prospect && (
                <Section icon={<Briefcase className="w-3 h-3" />} title="Prospect" labelClass={cls.sectionLabel}>
                    <div className="space-y-1 text-[12px]">
                        {dossier.prospect.name && (
                            <div className={`text-[15px] font-semibold ${cls.primary}`}>
                                {dossier.prospect.name}
                            </div>
                        )}
                        {(dossier.prospect.title || dossier.prospect.company) && (
                            <div className={cls.secondary}>
                                {[dossier.prospect.title, dossier.prospect.company].filter(Boolean).join(' · ')}
                            </div>
                        )}
                        {(dossier.prospect.industry || dossier.prospect.revenue || dossier.prospect.headcount) && (
                            <div className={`${cls.muted} text-[11px]`}>
                                {[
                                    dossier.prospect.industry,
                                    dossier.prospect.revenue && `${dossier.prospect.revenue} rev`,
                                    dossier.prospect.headcount && `${dossier.prospect.headcount} heads`
                                ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </div>
                        )}
                        {(dossier.prospect.deal_stage || dossier.prospect.deal_value) && (
                            <div className={`${cls.secondary} text-[11px] pt-1`}>
                                <span className="text-emerald-400">●</span>{' '}
                                {[dossier.prospect.deal_stage, dossier.prospect.deal_value].filter(Boolean).join(' · ')}
                            </div>
                        )}
                        {dossier.prospect.last_touchpoint && (
                            <div className={`${cls.muted} text-[10px] pt-1 italic`}>
                                Last touch: {dossier.prospect.last_touchpoint}
                            </div>
                        )}
                    </div>
                </Section>
            )}

            {/* Pain points */}
            {dossier.pain_points && dossier.pain_points.length > 0 && (
                <Section icon={<AlertTriangle className="w-3 h-3" />} title="Pain Points" labelClass={cls.sectionLabel}>
                    <ul className={`space-y-1.5 text-[12px] ${cls.secondary}`}>
                        {dossier.pain_points.map((pp, i) => (
                            <li key={i} className="flex gap-2">
                                <span className="text-red-400/80">•</span>
                                <span>{pp}</span>
                            </li>
                        ))}
                    </ul>
                </Section>
            )}

            {/* Script */}
            {dossier.script && dossier.script.length > 0 && (
                <Section
                    icon={<ListChecks className="w-3 h-3" />}
                    title={`Script (${dossier.script.length})`}
                    labelClass={cls.sectionLabel}
                >
                    <div className="space-y-1.5">
                        {dossier.script.map((q, i) => (
                            <button
                                key={i}
                                disabled={readOnly}
                                className={`w-full text-left p-2.5 rounded-md border border-white/5 ${readOnly ? 'cursor-default' : 'interaction-base interaction-press'} ${cls.scriptButton}`}
                                onClick={() => {
                                    if (!readOnly) {
                                        onScriptClick?.(i, q.question);
                                        console.log('[DossierView] question clicked:', i, q.question);
                                    }
                                }}
                            >
                                <div className="flex gap-2">
                                    <span className="text-[10px] font-bold text-emerald-400 mt-0.5 shrink-0">
                                        {i + 1}.
                                    </span>
                                    <div className="flex-1">
                                        <div className={`text-[12px] ${cls.primary} leading-snug`}>
                                            {q.question}
                                        </div>
                                        {q.notes && (
                                            <div className={`text-[10px] ${cls.muted} mt-1 italic`}>
                                                {q.notes}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </Section>
            )}

            {/* Talking points */}
            {dossier.talking_points && dossier.talking_points.length > 0 && (
                <Section icon={<Lightbulb className="w-3 h-3" />} title="Talking Points" labelClass={cls.sectionLabel}>
                    <ul className={`space-y-1.5 text-[12px] ${cls.secondary}`}>
                        {dossier.talking_points.map((tp, i) => (
                            <li key={i} className="flex gap-2">
                                <span className="text-yellow-400/80">→</span>
                                <span>{tp}</span>
                            </li>
                        ))}
                    </ul>
                </Section>
            )}

            {/* Previous meeting summary */}
            {dossier.previous_meeting_summary && (
                <Section icon={<History className="w-3 h-3" />} title="Last Meeting" labelClass={cls.sectionLabel}>
                    <div className={`text-[12px] ${cls.secondary} leading-relaxed`}>
                        {dossier.previous_meeting_summary}
                    </div>
                </Section>
            )}
        </div>
    );
};

interface SectionProps {
    icon: React.ReactNode;
    title: string;
    labelClass: string;
    children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ icon, title, labelClass, children }) => (
    <div className="space-y-2">
        <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold ${labelClass}`}>
            {icon}
            <span>{title}</span>
        </div>
        <div className="pl-0.5">{children}</div>
    </div>
);

export default DossierView;
