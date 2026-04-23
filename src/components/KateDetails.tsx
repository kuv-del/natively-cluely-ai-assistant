import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';

interface KateEventLite {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  eventType?: 'appointment' | 'school' | 'task' | 'fun' | 'fyi' | 'other' | string;
  description?: string | null;
  location?: string | null;
  link?: string;
}

interface KateDetailsProps {
  event: KateEventLite;
  onBack: () => void;
}

type TabKey = 'overview' | 'notes' | 'files' | 'history';

const TAB_LABELS: Record<TabKey, string> = {
  overview: 'Overview',
  notes: 'Notes',
  files: 'Files',
  history: 'History',
};

const AVAILABLE_TABS: TabKey[] = ['overview', 'notes', 'files', 'history'];

const v3 = {
  fontSans: '"Nunito Sans", -apple-system, sans-serif',
  fontSerif: '"Playfair Display", "Times New Roman", serif',
  bg: '#FFFFFF',
  surface: '#EEEDE9',
  surfaceHover: '#E5E3DD',
  dark: '#1B1B1B',
  textMuted: 'rgba(27,27,27,0.6)',
  border: '#BFBFBF',
};

function pillForType(eventType: string | undefined): { label: string; bg: string; fg: string } | null {
  switch (eventType) {
    case 'appointment': return { label: 'Appt', bg: '#6F87B5', fg: '#FFFFFF' };
    case 'school':      return { label: 'School', bg: '#BBB4D6', fg: '#1B1B1B' };
    case 'task':        return { label: 'Task', bg: '#C99B6E', fg: '#FFFFFF' };
    case 'fun':         return { label: 'Fun', bg: '#B8625A', fg: '#FFFFFF' };
    case 'fyi':         return { label: 'FYI', bg: '#D9C28A', fg: '#1B1B1B' };
    default: return null;
  }
}

function formatTimeRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const dayFmt = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${dayFmt} • ${fmt(start)} – ${fmt(end)}`;
}

const KateDetails: React.FC<KateDetailsProps> = ({ event, onBack }) => {
  const [tab, setTab] = useState<TabKey>('overview');
  const pill = pillForType(event.eventType);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full overflow-hidden"
      style={{ background: v3.bg, fontFamily: v3.fontSans }}
    >
      {/* Header */}
      <div className="px-8 pt-6 pb-4" style={{ borderBottom: `1px solid ${v3.border}` }}>
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
              background: v3.dark,
              color: v3.bg,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
            }}
          >
            Kate Mode
          </span>
          {pill && (
            <span
              style={{
                display: 'inline-block',
                padding: '3px 10px',
                borderRadius: 999,
                background: pill.bg,
                color: pill.fg,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
              }}
            >
              {pill.label}
            </span>
          )}
          <h1 style={{ fontSize: 28, fontWeight: 700, color: v3.dark, letterSpacing: '-0.02em', margin: 0 }}>
            {event.title}
          </h1>
        </div>

        <div className="mt-2 text-sm" style={{ color: v3.textMuted }}>
          {formatTimeRange(event.startTime, event.endTime)}
          {event.location && <span> • {event.location}</span>}
        </div>
      </div>

      {/* Tab strip */}
      <div className="px-8 flex gap-1" style={{ borderBottom: `1px solid ${v3.border}` }}>
        {AVAILABLE_TABS.map(key => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="py-3 px-4 text-sm transition-colors"
            style={{
              color: tab === key ? v3.dark : v3.textMuted,
              fontWeight: tab === key ? 700 : 500,
              borderBottom: tab === key ? `2px solid ${v3.dark}` : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {TAB_LABELS[key]}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-8 py-6" style={{ background: v3.surface }}>
        <div className="max-w-3xl mx-auto">
          {tab === 'overview' && (
            <div>
              <p className="text-sm" style={{ color: v3.textMuted, fontStyle: 'italic', fontFamily: v3.fontSerif }}>
                Kate Mode (family) — placeholder. Customize what shows on this tab later.
              </p>
              {event.description && (
                <div className="mt-6 text-sm whitespace-pre-wrap" style={{ color: v3.dark }}>
                  {event.description}
                </div>
              )}
            </div>
          )}
          {tab !== 'overview' && (
            <div className="text-sm" style={{ color: v3.textMuted, fontStyle: 'italic', fontFamily: v3.fontSerif }}>
              {TAB_LABELS[tab]} tab — placeholder. Customize later.
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default KateDetails;
