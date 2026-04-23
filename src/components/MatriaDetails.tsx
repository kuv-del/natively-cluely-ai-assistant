import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';

interface MatriaEventLite {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  attendeeContactName?: string | null;
  attendeeCompany?: string | null;
  eventType?: 'demo' | 'discovery' | 'followup' | 'other' | string;
  description?: string | null;
  location?: string | null;
  link?: string;
}

interface MatriaDetailsProps {
  event: MatriaEventLite;
  onBack: () => void;
}

type TabKey = 'summary' | 'profile' | 'grade' | 'meetings' | 'prep';

const TAB_LABELS: Record<TabKey, string> = {
  summary: 'Summary',
  profile: 'Profile',
  grade: 'Grade',
  meetings: 'Meetings',
  prep: 'Prep',
};

const AVAILABLE_TABS: TabKey[] = ['summary', 'profile', 'grade', 'meetings', 'prep'];

const v3 = {
  fontSans: '"Nunito Sans", -apple-system, sans-serif',
  fontSerif: '"Playfair Display", "Times New Roman", serif',
  bg: '#FFFFFF',
  surface: '#EEEDE9',
  surfaceHover: '#E5E3DD',
  dark: '#1B1B1B',
  textMuted: 'rgba(27,27,27,0.6)',
  border: '#BFBFBF',
  beige: '#D9C28A',
};

function formatTimeRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const dayFmt = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${dayFmt} • ${fmt(start)} – ${fmt(end)}`;
}

const MatriaDetails: React.FC<MatriaDetailsProps> = ({ event, onBack }) => {
  const [tab, setTab] = useState<TabKey>('summary');
  const contactName = event.attendeeContactName || event.title;
  const company = event.attendeeCompany || 'Matria';

  const eventTypePillLabel = (() => {
    switch (event.eventType) {
      case 'demo': return 'Demo Call';
      case 'discovery': return 'Discovery Call';
      case 'followup': return 'Follow Up Call';
      default: return null;
    }
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full overflow-hidden"
      style={{ background: v3.surface, fontFamily: v3.fontSans }}
    >
      {/* Header */}
      <div className="px-8 pt-6 pb-4" style={{ background: v3.surface }}>
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm hover:opacity-70 transition-opacity mb-4"
          style={{ color: v3.textMuted }}
        >
          <ArrowLeft size={14} /> Back
        </button>

        <div className="flex items-baseline gap-3 flex-wrap">
          <span
            style={{
              display: 'inline-block',
              padding: '4px 12px',
              borderRadius: 999,
              background: v3.beige,
              color: v3.dark,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
            }}
          >
            Matria
          </span>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: v3.dark, letterSpacing: '-0.02em', margin: 0, fontFamily: v3.fontSerif }}>
            {contactName} — {company}
          </h1>
        </div>

        <div className="mt-2 text-sm" style={{ color: v3.textMuted }}>
          {formatTimeRange(event.startTime, event.endTime)}
          {eventTypePillLabel && <span> • {eventTypePillLabel}</span>}
          {event.location && <span> • {event.location}</span>}
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex gap-2 px-8 py-3" style={{ background: v3.surface }}>
        {AVAILABLE_TABS.map(key => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              background: tab === key ? v3.dark : 'transparent',
              color: tab === key ? '#FFFFFF' : v3.textMuted,
              borderRadius: 999,
              padding: '6px 16px',
              fontWeight: tab === key ? 600 : 400,
              fontSize: 13,
              border: 'none',
              cursor: 'pointer',
              transition: 'background-color 0.2s, color 0.2s',
            }}
            onMouseEnter={(e) => {
              if (tab !== key) {
                (e.currentTarget as HTMLButtonElement).style.background = v3.surfaceHover;
              }
            }}
            onMouseLeave={(e) => {
              if (tab !== key) {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              }
            }}
          >
            {TAB_LABELS[key]}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-8 py-6" style={{ background: v3.surface }}>
        <div className="max-w-3xl mx-auto" style={{ background: v3.bg, borderRadius: 8, padding: 16 }}>
          {tab === 'summary' && (
            <div style={{ color: v3.dark }}>
              <p className="text-sm" style={{ color: v3.textMuted, fontStyle: 'italic', fontFamily: v3.fontSerif }}>
                Matria mode — placeholder. Customize what shows on this tab later.
              </p>
              {event.description && (
                <div className="mt-6 text-sm whitespace-pre-wrap" style={{ color: v3.dark }}>
                  {event.description}
                </div>
              )}
            </div>
          )}
          {tab !== 'summary' && (
            <div className="text-sm" style={{ color: v3.textMuted, fontStyle: 'italic', fontFamily: v3.fontSerif }}>
              {TAB_LABELS[tab]} tab — placeholder. Customize later.
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default MatriaDetails;
