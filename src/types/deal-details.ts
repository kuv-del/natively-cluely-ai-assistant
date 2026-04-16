/**
 * Shape returned by GET /natively/deal-details?contact_id=...
 * (Stage 1 Convex HTTP endpoint via convex-get-deal-details IPC)
 */

export interface DealDetailsContact {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    hubspot_contact_id?: string;
}

export interface DealDetailsCompany {
    company_name?: string;
    company_website?: string;
    company_revenue?: string;
    employee_count?: string;
    company_location?: string;
    industry?: string;
    hubspot_company_id?: string;
}

export interface DealDetailsDeal {
    hubspot_deal_id?: string;
    deal_stage?: string;
    offer_made?: boolean | string;
    expected_close_date?: string;
    close_date?: string;
    status?: string;
    sdr_owner_name?: string;
    sdr_owner?: string;
    sdr_email?: string;
    sdr_slack_id?: string;
}

export interface DealDetailsMeetingRef {
    id: string;
    calendar_event_id?: string;
    title?: string;
    meeting_type?: string;
    start_time?: string;
    end_time?: string;
    zoom_link?: string;
    source?: string;
    summary_markdown?: string | null;
    transcript?: Array<{ speaker: string; text: string; timestamp?: number }>;
}

export interface DealDetailsMeetingGroup {
    meeting: DealDetailsMeetingRef;
    transcript?: Array<{ speaker: string; text: string; timestamp?: number }>;
    summary?: string | null;
}

export interface DealDetailsUpcomingMeeting {
    meeting: DealDetailsMeetingRef;
    prep_dossier?: any | null;
}

export interface DealDetailsCumulativeSummary {
    _id?: string;
    _creationTime?: number;
    summary_markdown: string;
    generator_model?: string;
    summary_type?: string;
    contact_id?: string;
}

export interface DealDetailsResponse {
    contact: DealDetailsContact | null;
    company: DealDetailsCompany | null;
    deal: DealDetailsDeal | null;
    meetings_by_type: {
        discovery: DealDetailsMeetingGroup[];
        demo: DealDetailsMeetingGroup[];
        followup: DealDetailsMeetingGroup[];
        sdr_triage?: DealDetailsMeetingGroup[];
    };
    upcoming_meeting: DealDetailsUpcomingMeeting | null;
    sdr_notes?: Array<{
        full_note?: string;
        prospect_name?: string;
        company_name?: string;
        slack_ts?: string;
    }>;
    prospect_notes?: {
        notes_markdown?: string;
    } | null;
    /** Stage 4: cumulative deal narrative, most recent row. Null until first generation. */
    cumulative_summary: DealDetailsCumulativeSummary | null;
}
