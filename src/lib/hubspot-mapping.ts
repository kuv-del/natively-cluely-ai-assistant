/**
 * HubSpot property mapping for The Scalable Co.
 *
 * Mirror of gobot's src/lib/sales/hubspot-config.ts. Keep in sync when
 * gobot's mapping changes. Internal HubSpot values → user-facing labels.
 */

// Production HubSpot portal id for Kate's account.
// Used to build app.hubspot.com URLs.
export const HUBSPOT_PORTAL_ID = "21182745";

// ─── Deal Stages (dealstage) ────────────────────────────────────────────────
// Internal name → display label
export const DEAL_STAGE_MAP: Record<string, string> = {
    decisionmakerboughtin: "Growth Session Scheduled",
    "83755899": "Growth Session Held",
    "250536552": "Paid",
    "250536553": "Contract Sent",
    "85094266": "Closed Lost",
    "113267853": "Signed (Won)",
};

/** Resolve an internal dealstage value to its display label. Falls back to the
 *  raw value if unknown. */
export function getDealStageLabel(internal: string | undefined | null): string {
    if (!internal) return "—";
    return DEAL_STAGE_MAP[internal] || internal;
}

/** Build the URL to a HubSpot contact in Kate's portal. */
export function hubspotContactUrl(contactId: string): string {
    return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/contact/${contactId}`;
}

/** Build the URL to a HubSpot deal in Kate's portal. */
export function hubspotDealUrl(dealId: string): string {
    return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${dealId}`;
}

// ─── Call Type ──────────────────────────────────────────────────────────────
// Internal slug (stored on Convex meetings.meeting_type) → user-facing label
export const CALL_TYPE_PRETTY: Record<string, string> = {
    discovery: "Discovery Call",
    demo: "Demo Call",
    followup: "Follow Up Call",
    game_planning: "Game Planning",
    unknown: "Meeting",
};

export function getCallTypeLabel(internal: string | undefined | null): string | null {
    if (!internal) return null;
    return CALL_TYPE_PRETTY[internal] || internal;
}

// ─── Slack DM helper ────────────────────────────────────────────────────────
// Slack workspace: thescalableco.slack.com (team id T0EG5HJ21)
export const SLACK_TEAM_ID = "T0EG5HJ21";

/** Build a slack:// URL that opens a DM with the given user id in Slack desktop. */
export function slackDmUrl(slackUserId: string): string {
    return `slack://user?team=${SLACK_TEAM_ID}&id=${slackUserId}`;
}

// ─── Phone formatter ────────────────────────────────────────────────────────
// Light formatter that handles US numbers and falls back to the raw value
// for anything else. Returns an object with the formatted display string and
// a tel: URL for click-to-call.
export interface FormattedPhone {
    display: string;
    href: string; // tel:+1xxxx or tel:raw
}

export function formatPhone(raw: string | undefined | null): FormattedPhone | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // Strip everything but digits and a leading + sign
    const cleaned = trimmed.replace(/[^\d+]/g, "");

    // US numbers: 10 digits, or 11 digits starting with 1, or +1 followed by 10
    if (/^\+?1?\d{10}$/.test(cleaned)) {
        const digits = cleaned.replace(/^\+?1/, "");
        if (digits.length === 10) {
            const display = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
            return { display, href: `tel:+1${digits}` };
        }
    }

    // E.164-style international: +CCNNNNN... — pass through with light spacing
    if (cleaned.startsWith("+")) {
        return { display: cleaned, href: `tel:${cleaned}` };
    }

    // Unknown format — display as-is, best-effort tel link
    return { display: trimmed, href: `tel:${cleaned || trimmed}` };
}

// ─── URL normalizer ─────────────────────────────────────────────────────────
/** Ensure a URL has a protocol so it opens correctly in the OS browser. */
export function normalizeUrl(url: string | undefined | null): string | null {
    if (!url) return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
}
