import { app, safeStorage, shell, net } from 'electron';
import axios from 'axios';
import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';

// Load Google OAuth credentials from ~/gobot/.env at runtime.
// Packaged Electron does NOT auto-load dotenv, so we read + parse the file
// ourselves. Kate's fork shares credentials with her gobot project so a single
// OAuth consent covers both apps (see docs/rebuild-plan).
function loadGobotEnv(): Record<string, string> {
    try {
        const gobotEnvPath = path.join(os.homedir(), 'gobot', '.env');
        if (!fs.existsSync(gobotEnvPath)) return {};
        const content = fs.readFileSync(gobotEnvPath, 'utf8');
        const parsed: Record<string, string> = {};
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
            if (m) parsed[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
        return parsed;
    } catch {
        return {};
    }
}
const GOBOT_ENV = loadGobotEnv();

// Matria OAuth app credentials (kate@matriapartners.com, project: matria-natively)
const GOOGLE_CLIENT_ID = GOBOT_ENV.NATIVELY_CLIENT_ID || GOBOT_ENV.GOOGLE_CLIENT_ID || process.env.NATIVELY_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "YOUR_CLIENT_ID_HERE";
const GOOGLE_CLIENT_SECRET = GOBOT_ENV.NATIVELY_CLIENT_SECRET || GOBOT_ENV.GOOGLE_CLIENT_SECRET || process.env.NATIVELY_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "YOUR_CLIENT_SECRET_HERE";
const GOBOT_REFRESH_TOKEN = GOBOT_ENV.NATIVELY_REFRESH_TOKEN || GOBOT_ENV.GOOGLE_REFRESH_TOKEN || process.env.NATIVELY_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN || "";
const REDIRECT_URI = "http://localhost:11111/auth/callback";
// Full calendar scope (read + write). Gobot's refresh token was originally
// consented with this same scope, so token reuse is valid.
const SCOPES = ["https://www.googleapis.com/auth/calendar"];
const TOKEN_PATH = path.join(app.getPath('userData'), 'calendar_tokens.enc');

if (GOOGLE_CLIENT_ID === "YOUR_CLIENT_ID_HERE" || GOOGLE_CLIENT_SECRET === "YOUR_CLIENT_SECRET_HERE") {
    console.warn('[CalendarManager] Google OAuth credentials not found in ~/gobot/.env or process.env — calendar features will not work.');
} else {
    console.log('[CalendarManager] Google OAuth credentials loaded from gobot env. Refresh token present:', GOBOT_REFRESH_TOKEN ? 'yes' : 'no');
}

export interface EventAttendee {
    email: string;
    name: string | null;
    responseStatus: 'accepted' | 'declined' | 'tentative' | 'needsAction';
    self: boolean; // true = this is the authenticated user
}

export interface CalendarEvent {
    id: string;
    title: string;
    description: string | null;
    startTime: string; // ISO
    endTime: string; // ISO
    link?: string;             // resolved meeting link (Zoom / Meet / etc.)
    location: string | null;
    attendees: EventAttendee[];
    colorId: string | null;    // Google Calendar color id ("1"–"11"), null = calendar default
    colorHex: string | null;   // Resolved hex color for UI rendering
    source: 'google';
    calendarId: string;        // the calendar this event was fetched from
    calendarSummary: string;   // display name from calendarList
    calendarKind: 'scalable' | 'matria' | 'family' | 'other';
    eventType: 'demo' | 'discovery' | 'followup' | 'appointment' | 'school' | 'task' | 'fun' | 'fyi' | 'other';
    attendeeContactName: string | null;  // first non-self attendee's parsed name
    attendeeCompany: string | null;      // first non-self attendee's email-domain-derived company
    isAllDay: boolean;         // true when start.date is set instead of start.dateTime
    isBlock: boolean;          // true if this is a block (AM out, PM out, etc.)
    blockKind: 'am_out' | 'pm_out' | 'sat_out' | 'sun_out' | 'other_block' | null;
}

// Google Calendar event color palette (from /calendar/v3/colors API).
// Mirror of plugin-smart-calendar's GCAL_COLOR_MAP for cross-tool consistency.
// 1=Lavender 2=Sage 3=Grape 4=Flamingo 5=Banana
// 6=Tangerine 7=Peacock 8=Graphite 9=Blueberry 10=Basil 11=Tomato
export const GCAL_COLOR_MAP: Record<string, string> = {
    "1": "#a4bdfc",
    "2": "#7ae7bf",
    "3": "#dbadff",
    "4": "#ff887c",
    "5": "#fbd75b",
    "6": "#ffb878",
    "7": "#46d6db",
    "8": "#e1e1e1",
    "9": "#5484ed",
    "10": "#51b749",
    "11": "#dc2127",
};

export class CalendarManager extends EventEmitter {
    private static instance: CalendarManager;
    private static readonly BLOCKED_PHRASES = [
        'am out', 'pm out', 'sat out', 'sun out',
        'do not book', 'no booking', 'no bookings',
        'morning meeting block',
    ];

    private static detectCalendarKind(summary: string, calendarId: string): CalendarEvent['calendarKind'] {
        const s = (summary + ' ' + calendarId).toLowerCase();
        if (s.includes('matria')) return 'matria';
        if (s.includes('family') || s.includes('schnetzerfamily')) return 'family';
        if (s.includes('scalable') || s.includes('kate.schnetzer')) return 'scalable';
        return 'other';
    }

    private static detectEventType(title: string): CalendarEvent['eventType'] {
        const t = title.toLowerCase();
        if (/\bdemo\b/.test(t)) return 'demo';
        if (/\b(discovery|disc)\b/.test(t)) return 'discovery';
        if (/\b(follow.?up|fup|f\.?u\.?)\b/.test(t)) return 'followup';
        if (/\b(appointment|appt)\b/.test(t)) return 'appointment';
        if (/\bschool\b/.test(t)) return 'school';
        if (/\btask\b/.test(t)) return 'task';
        if (/\bfun\b/.test(t)) return 'fun';
        if (/\bfyi\b/.test(t)) return 'fyi';
        return 'other';
    }

    private static detectBlockKind(title: string): { isBlock: boolean; blockKind: 'am_out' | 'pm_out' | 'sat_out' | 'sun_out' | 'other_block' | null } {
        const t = title.toLowerCase();
        if (/\bam out\b/.test(t)) return { isBlock: true, blockKind: 'am_out' };
        if (/\bmorning meeting block\b/.test(t)) return { isBlock: true, blockKind: 'other_block' };
        if (/\bpm out\b/.test(t)) return { isBlock: true, blockKind: 'pm_out' };
        if (/\bsat out\b/.test(t)) return { isBlock: true, blockKind: 'sat_out' };
        if (/\bsun out\b/.test(t)) return { isBlock: true, blockKind: 'sun_out' };
        if (/\b(do not book|no booking|no bookings)\b/.test(t)) return { isBlock: true, blockKind: 'other_block' };
        return { isBlock: false, blockKind: null };
    }

    private static parseAttendeeContact(attendees: EventAttendee[]): { name: string | null; company: string | null } {
        const guest = attendees.find(a => !a.self && a.email);
        if (!guest) return { name: null, company: null };
        const name = guest.name || (guest.email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
        const domain = guest.email.split('@')[1] || '';
        const tld = domain.split('.').slice(-2)[0] || '';
        const company = tld ? tld.charAt(0).toUpperCase() + tld.slice(1) : null;
        return { name, company };
    }
    private accessToken: string | null = null;
    private refreshToken: string | null = null;
    private expiryDate: number | null = null;
    private isConnected: boolean = false;
    private updateInterval: NodeJS.Timeout | null = null;
    private remindedEventIds: Set<string> = new Set();
    private calendarColorMap: Map<string, { hex: string; summary: string }> = new Map(); // calendarId → { hex, summary }

    private lastFetchTime: number = 0;
    private cachedEvents: CalendarEvent[] = [];
    private readonly CACHE_TTL_MS = 30000; // 30-second cache

    private constructor() {
        super();
        // Tokens loaded in init() to ensure safeStorage is ready
    }

    public static getInstance(): CalendarManager {
        if (!CalendarManager.instance) {
            CalendarManager.instance = new CalendarManager();
        }
        return CalendarManager.instance;
    }

    public init() {
        this.loadTokens();

        // Bootstrap from gobot's refresh token on first run.
        // If we have no stored refresh token but gobot's .env has one, inject it
        // and derive an access token. This skips the browser consent flow entirely
        // because Natively and gobot share the same Google Cloud OAuth client.
        if (!this.refreshToken && GOBOT_REFRESH_TOKEN) {
            console.log('[CalendarManager] No local refresh token — bootstrapping from gobot');
            this.refreshToken = GOBOT_REFRESH_TOKEN;
            this.saveTokens();
            // Fire-and-forget: mirrors the existing loadTokens() expiry-refresh pattern
            this.refreshAccessToken().catch(err => {
                console.error('[CalendarManager] Bootstrap token refresh failed:', err);
            });
        }

        // ── Main-process calendar polling ───────────────────────────────────
        // Ensures reminders fire even when the Launcher component isn't mounted
        // (overlay mode, minimized, etc.). The renderer still polls too — that's
        // fine, getUpcomingEvents() is idempotent and re-schedules reminders.

        // Initial fetch after a short delay (let token refresh settle)
        setTimeout(() => {
            if (this.isConnected) {
                console.log('[CalendarManager] Initial main-process fetch (5s after init)');
                this.getUpcomingEvents(true).catch(err => {
                    console.error('[CalendarManager] Initial fetch failed:', err);
                });
            }
        }, 5000);

        // Recurring 60-second poll
        if (this.updateInterval) clearInterval(this.updateInterval);
        this.updateInterval = setInterval(() => {
            if (this.isConnected) {
                console.log('[CalendarManager] Polling calendar (60s interval)');
                this.getUpcomingEvents(true).catch(err => {
                    console.error('[CalendarManager] Poll fetch failed:', err);
                });
            }
        }, 60_000);
    }

    // =========================================================================
    // Auth Flow
    // =========================================================================

    public async startAuthFlow(): Promise<void> {
        return new Promise((resolve, reject) => {
            // 1. Create Loopback Server
            const server = http.createServer(async (req, res) => {
                try {
                    if (req.url?.startsWith('/auth/callback')) {
                        const qs = new url.URL(req.url, 'http://localhost:11111').searchParams;
                        const code = qs.get('code');
                        const error = qs.get('error');

                        if (error) {
                            res.end('Authentication failed! You can close this window.');
                            server.close();
                            reject(new Error(error));
                            return;
                        }

                        if (code) {
                            res.end('Authentication successful! You can close this window and return to Natively.');
                            server.close();

                            // 2. Exchange code for tokens
                            await this.exchangeCodeForToken(code);
                            resolve();
                        }
                    }
                } catch (err) {
                    res.end('Authentication error.');
                    server.close();
                    reject(err);
                }
            });

            server.listen(11111, () => {
                // 3. Open Browser
                const authUrl = this.getAuthUrl();
                shell.openExternal(authUrl);
            });

            server.on('error', (err) => {
                reject(err);
            });
        });
    }

    public async disconnect(): Promise<void> {
        this.accessToken = null;
        this.refreshToken = null;
        this.expiryDate = null;
        this.isConnected = false;

        if (fs.existsSync(TOKEN_PATH)) {
            fs.unlinkSync(TOKEN_PATH);
        }

        this.emit('connection-changed', false);
    }

    public getConnectionStatus(): { connected: boolean; email?: string, lastSync?: number } {
        // We don't store email in tokens usually, but we could fetch it.
        // For now, simpler boolean.
        return { connected: this.isConnected };
    }

    private getAuthUrl(): string {
        const params = new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: 'code',
            scope: SCOPES.join(' '),
            access_type: 'offline', // For refresh token
            prompt: 'consent' // Force prompts to ensure we get refresh token
        });
        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    private async exchangeCodeForToken(code: string) {
        try {
            const response = await axios.post('https://oauth2.googleapis.com/token',
                new URLSearchParams({
                    code,
                    client_id: GOOGLE_CLIENT_ID,
                    client_secret: GOOGLE_CLIENT_SECRET,
                    redirect_uri: REDIRECT_URI,
                    grant_type: 'authorization_code',
                }).toString(),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            this.handleTokenResponse(response.data);
        } catch (error) {
            console.error('[CalendarManager] Token exchange failed:', error);
            throw error;
        }
    }

    // =========================================================================
    // Refresh Logic (NEW)
    // =========================================================================

    public async refreshState(): Promise<void> {
        console.log('[CalendarManager] Refreshing state (Reality Reconciliation)...');

        // 1. Reset Soft Heuristics
        // Clear existing reminder timeouts to prevent double scheduling or stale alerts
        this.reminderTimeouts.forEach(t => clearTimeout(t));
        this.reminderTimeouts = [];

        // 2. Calendar Re-sync & Temporal Re-evaluation
        if (this.isConnected) {
            // Force fetch will also re-schedule reminders based on NEW time
            await this.getUpcomingEvents(true);
        } else {
            console.log('[CalendarManager] Calendar not connected, skipping fetch.');
        }

        // 3. Emit update to UI
        // We emit 'updated' so the frontend knows to re-fetch via getUpcomingEvents
        // or we could push the data. usually ipcHandlers just call getUpcomingEvents.
        this.emit('events-updated');
    }

    private handleTokenResponse(data: any) {
        this.accessToken = data.access_token;
        if (data.refresh_token) {
            this.refreshToken = data.refresh_token; // Only returned on first consent
        }
        this.expiryDate = Date.now() + (data.expires_in * 1000);
        this.isConnected = true;
        this.saveTokens();
        this.emit('connection-changed', true);

        // Initial fetch
        this.fetchUpcomingEvents();
    }

    private async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('No refresh token available');
        }

        try {
            const response = await axios.post('https://oauth2.googleapis.com/token',
                new URLSearchParams({
                    client_id: GOOGLE_CLIENT_ID,
                    client_secret: GOOGLE_CLIENT_SECRET,
                    refresh_token: this.refreshToken,
                    grant_type: 'refresh_token',
                }).toString(),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            this.handleTokenResponse(response.data);
        } catch (error) {
            console.error('[CalendarManager] Token refresh failed:', error);
            // If refresh fails (e.g. revoked), disconnect
            this.disconnect();
        }
    }

    // =========================================================================
    // Token Storage (Encrypted)
    // =========================================================================

    private saveTokens() {
        if (!safeStorage.isEncryptionAvailable()) {
            console.warn('[CalendarManager] Encryption not available, skipping token save');
            return;
        }

        const data = JSON.stringify({
            accessToken: this.accessToken,
            refreshToken: this.refreshToken,
            expiryDate: this.expiryDate
        });

        const encrypted = safeStorage.encryptString(data);
        const tmpPath = TOKEN_PATH + '.tmp';
        fs.writeFileSync(tmpPath, encrypted);
        fs.renameSync(tmpPath, TOKEN_PATH);
    }

    private loadTokens() {
        if (!fs.existsSync(TOKEN_PATH)) return;

        try {
            if (!safeStorage.isEncryptionAvailable()) return;

            const encrypted = fs.readFileSync(TOKEN_PATH);
            const decrypted = safeStorage.decryptString(encrypted);
            const data = JSON.parse(decrypted);

            this.accessToken = data.accessToken;
            this.refreshToken = data.refreshToken;
            this.expiryDate = data.expiryDate;

            if (this.accessToken && this.refreshToken) {
                this.isConnected = true;
                if (this.expiryDate && Date.now() >= this.expiryDate) {
                    this.refreshAccessToken();
                } else {
                    // Token valid — notify listeners so tray updates immediately on launch
                    // (avoids waiting for the 30s poll interval to show the first title)
                    setImmediate(() => this.emit('connection-changed', true));
                }
            }
        } catch (error) {
            console.error('[CalendarManager] Failed to load tokens:', error);
        }
    }

    // =========================================================================
    // Reminders
    // =========================================================================

    private reminderTimeouts: NodeJS.Timeout[] = [];

    private scheduleReminders(events: CalendarEvent[]) {
        // Clear existing timers
        this.reminderTimeouts.forEach(t => clearTimeout(t));
        this.reminderTimeouts = [];

        const now = Date.now();

        events.forEach(event => {
            if (!event.startTime) return;
            // Skip if already reminded for this event
            if (this.remindedEventIds.has(event.id)) return;

            const startTime = new Date(event.startTime).getTime();
            const reminderTime = startTime - (2 * 60 * 1000); // T-2 minutes

            if (reminderTime > now) {
                const delay = reminderTime - now;
                if (delay < 24 * 60 * 60 * 1000) {
                    const timeout = setTimeout(() => {
                        this.remindedEventIds.add(event.id);
                        this.showNotification(event);
                    }, delay);
                    this.reminderTimeouts.push(timeout);
                }
            }
        });

        // Clean up old reminded IDs (events older than 1 hour ago)
        const oneHourAgo = now - 60 * 60 * 1000;
        for (const id of this.remindedEventIds) {
            const evt = events.find(e => e.id === id);
            if (evt && new Date(evt.startTime).getTime() < oneHourAgo) {
                this.remindedEventIds.delete(id);
            }
        }
    }

    private showNotification(event: CalendarEvent) {
        console.log(`[CalendarManager] Meeting reminder: "${event.title}" in 2 minutes`);
        this.emit('meeting-reminder', event);
    }

    // =========================================================================
    // Fetch Logic
    // =========================================================================

    public async getUpcomingEvents(force: boolean = false): Promise<CalendarEvent[]> {
        if (!this.isConnected || !this.accessToken) return [];

        // Return cached events if available and not forced
        const now = Date.now();
        if (!force && now - this.lastFetchTime < this.CACHE_TTL_MS) {
            console.log(`[CalendarManager] getUpcomingEvents: using cache (${now - this.lastFetchTime}ms old)`);
            return this.cachedEvents;
        }

        // Check expiry
        if (this.expiryDate && Date.now() >= this.expiryDate - 60000) {
            await this.refreshAccessToken();
        }

        const events = await this.fetchEventsInternal();
        this.cachedEvents = events;
        this.lastFetchTime = Date.now();
        console.log(`[CalendarManager] getUpcomingEvents: ${events.length} events returned (fresh fetch)`);
        if (events.length > 0) {
            const next = events.find(e => new Date(e.startTime).getTime() > Date.now());
            console.log(`[CalendarManager] Next upcoming: ${next ? `${next.title} at ${next.startTime}` : 'none'}`);
        }
        this.scheduleReminders(events);
        return events;
    }

    public async getEventsInRange(opts: { startTime: Date; endTime: Date; filterBlocked?: boolean }): Promise<CalendarEvent[]> {
        if (!this.isConnected || !this.accessToken) return [];
        if (this.expiryDate && Date.now() >= this.expiryDate - 60000) {
            await this.refreshAccessToken();
        }
        return this.fetchEventsInternal(opts);
    }

    private async fetchCalendarList(): Promise<void> {
        if (!this.accessToken) return;
        try {
            const response = await axios.get('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
                headers: { Authorization: `Bearer ${this.accessToken}` },
                params: { maxResults: 50 }
            });
            this.calendarColorMap.clear();
            for (const cal of (response.data.items || [])) {
                // Only include calendars Kate owns — excludes shared/teammates calendars.
                if (cal.accessRole !== 'owner' && !cal.primary) continue;
                const hex = cal.backgroundColor || (cal.colorId && GCAL_COLOR_MAP[cal.colorId]) || null;
                this.calendarColorMap.set(cal.id, { hex: hex ?? '#4A90D9', summary: cal.summary || cal.id });
            }
            console.log(`[CalendarManager] Loaded ${this.calendarColorMap.size} calendars`);
        } catch (e) {
            console.warn('[CalendarManager] Failed to fetch calendar list:', e);
        }
    }

    private async fetchEventsInternal(opts: { startTime?: Date; endTime?: Date; filterBlocked?: boolean } = {}): Promise<CalendarEvent[]> {
        if (!this.accessToken) return [];

        // Range: defaults to now → 7 days from now (flat 7-day window for menu bar).
        const startTime = opts.startTime || new Date();
        const endTime = opts.endTime || (() => {
            const end = new Date(startTime);
            end.setDate(end.getDate() + 7);
            end.setHours(23, 59, 59, 999);
            return end;
        })();
        const filterBlocked = opts.filterBlocked !== false; // default true

        // Fetch calendar list first time (so we have calendar-level colors).
        if (this.calendarColorMap.size === 0) {
            await this.fetchCalendarList();
        }

        const params = {
            timeMin: startTime.toISOString(),
            timeMax: endTime.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        };

        // Query all calendars in the list (deduped by event ID at the end).
        const calendarIds = this.calendarColorMap.size > 0
            ? Array.from(this.calendarColorMap.keys())
            : ['primary'];

        const allEvents: CalendarEvent[] = [];
        const seen = new Set<string>();

        for (const calendarId of calendarIds) {
            try {
                const response = await axios.get(
                    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
                    { headers: { Authorization: `Bearer ${this.accessToken}` }, params }
                );
                const calendarInfo = this.calendarColorMap.get(calendarId) || { hex: '#4A90D9', summary: calendarId };
                const calendarSummary = calendarInfo.summary;
                const calendarFallbackColor = calendarInfo.hex;
                const calendarKind = CalendarManager.detectCalendarKind(calendarSummary, calendarId);

                const items = response.data.items || [];
                for (const item of items) {
                    if (seen.has(item.id)) continue;

                    // Determine if all-day or timed event
                    const isAllDay = !item.start?.dateTime;
                    let startTime: string;
                    let endTime: string;
                    let durationMins = 0;

                    if (isAllDay) {
                        // All-day event: use date field and convert to ISO
                        startTime = item.start.date + 'T00:00:00Z';
                        endTime = item.end.date + 'T00:00:00Z';
                    } else {
                        // Timed event: use dateTime
                        if (!item.start?.dateTime || !item.end?.dateTime) continue;
                        startTime = item.start.dateTime;
                        endTime = item.end.dateTime;
                        durationMins = (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000;
                        // Skip very short timed events (< 5 mins), but allow all-day events
                        if (durationMins < 5) continue;
                    }

                    const link = this.resolveMeetingLink(item);
                    const { isBlock, blockKind } = CalendarManager.detectBlockKind(item.summary || '');

                    // Event-level color overrides calendar color.
                    const colorId: string | null = item.colorId ?? null;
                    const colorHex = (colorId && GCAL_COLOR_MAP[colorId]) || calendarFallbackColor || null;

                    const attendees: EventAttendee[] = Array.isArray(item.attendees)
                        ? item.attendees.map((a: any) => ({
                            email: a.email || '',
                            name: a.displayName || null,
                            responseStatus: (a.responseStatus || 'needsAction') as EventAttendee['responseStatus'],
                            self: a.self === true,
                        }))
                        : [];

                    const eventType = CalendarManager.detectEventType(item.summary || '');
                    const { name: attendeeContactName, company: attendeeCompany } = CalendarManager.parseAttendeeContact(attendees);

                    seen.add(item.id);
                    allEvents.push({
                        id: item.id,
                        title: item.summary || '(No Title)',
                        description: item.description || null,
                        startTime,
                        endTime,
                        link,
                        location: item.location || null,
                        attendees,
                        colorId,
                        colorHex,
                        source: 'google',
                        calendarId,
                        calendarSummary,
                        calendarKind,
                        eventType,
                        attendeeContactName,
                        attendeeCompany,
                        isAllDay,
                        isBlock,
                        blockKind,
                    });
                }
            } catch (error) {
                console.warn(`[CalendarManager] Failed to fetch events for calendar ${calendarId}:`, error);
            }
        }

        return allEvents.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }

    // ── Two-way sync: write helpers ──────────────────────────────────────────
    // Generic PATCH for any subset of event fields. Caller provides the partial
    // body in Google Calendar API shape (e.g. { colorId: "9" }, { summary: "..." },
    // { start: { dateTime: "..." }, end: { dateTime: "..." } }).
    public async updateEvent(eventId: string, partial: Record<string, any>, calendarId: string = 'primary'): Promise<{ success: boolean; error?: string }> {
        if (!this.isConnected || !this.accessToken) {
            return { success: false, error: 'Calendar not connected' };
        }
        // Refresh token if expired
        if (this.expiryDate && Date.now() >= this.expiryDate - 60000) {
            await this.refreshAccessToken();
        }
        try {
            await axios.patch(
                `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
                partial,
                { headers: { Authorization: `Bearer ${this.accessToken}` } }
            );
            return { success: true };
        } catch (error: any) {
            console.error(`[CalendarManager] Failed to update event ${eventId} on ${calendarId}:`, error?.response?.data || error);
            return { success: false, error: error?.message || 'Update failed' };
        }
    }

    // Convenience wrapper for the most common 2-way op: set the event color.
    public async updateEventColor(eventId: string, colorId: string, calendarId: string = 'primary'): Promise<{ success: boolean; error?: string }> {
        return this.updateEvent(eventId, { colorId }, calendarId);
    }

    public async deleteEvent(eventId: string, calendarId: string = 'primary'): Promise<{ success: boolean; error?: string }> {
        if (!this.isConnected || !this.accessToken) {
            return { success: false, error: 'Calendar not connected' };
        }
        if (this.expiryDate && Date.now() >= this.expiryDate - 60000) {
            await this.refreshAccessToken();
        }
        try {
            await axios.delete(
                `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
                { headers: { Authorization: `Bearer ${this.accessToken}` } }
            );
            return { success: true };
        } catch (error: any) {
            console.error(`[CalendarManager] Failed to delete event ${eventId}:`, error?.response?.data || error);
            return { success: false, error: error?.message || 'Delete failed' };
        }
    }

    // Intelligent Link Extraction
    private resolveMeetingLink(item: any): string | undefined {
        // 1. Prefer explicit Hangout link (Google Meet) if present
        if (item.hangoutLink) return item.hangoutLink;

        // 2. Parse the location field — Zoom links often live here
        if (item.location) {
            const fromLocation = this.extractMeetingLink(item.location);
            if (fromLocation) return fromLocation;
        }

        // 3. Parse description for any provider
        if (item.description) {
            const fromDescription = this.extractMeetingLink(item.description);
            if (fromDescription) return fromDescription;
        }

        return undefined;
    }

    private extractMeetingLink(description: string): string | undefined {
        // Regex for common meeting providers
        // Matches zoom.us, teams.microsoft.com, meet.google.com, webex.com
        const providerRegex = /(https?:\/\/(?:[a-z0-9-]+\.)?(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com)\/[^\s<>"']+)/gi;

        const matches = description.match(providerRegex);
        if (matches && matches.length > 0) {
            // Deduplicate
            const unique = [...new Set(matches)];
            // Return the first valid provider link
            return unique[0];
        }

        // Fallback: Generic URL (less strict, but riskier)
        // const genericUrlRegex = /(https?:\/\/[^\s<>"']+)/g;
        // ... avoided to prevent picking up random links like "docs.google.com"

        return undefined;
    }

    // Background fetcher could go here if needed
    public async fetchUpcomingEvents() {
        // wrapper to just cache or trigger updates
        return this.getUpcomingEvents();
    }
}
