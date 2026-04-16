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

const GOOGLE_CLIENT_ID = GOBOT_ENV.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "YOUR_CLIENT_ID_HERE";
const GOOGLE_CLIENT_SECRET = GOBOT_ENV.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "YOUR_CLIENT_SECRET_HERE";
const GOBOT_REFRESH_TOKEN = GOBOT_ENV.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN || "";
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

// Returns the date object for the next business day after the given date.
// Skips Saturday (6) and Sunday (0).
function nextBusinessDay(from: Date): Date {
    const d = new Date(from);
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) {
        d.setDate(d.getDate() + 1);
    }
    return d;
}

export class CalendarManager extends EventEmitter {
    private static instance: CalendarManager;
    private accessToken: string | null = null;
    private refreshToken: string | null = null;
    private expiryDate: number | null = null;
    private isConnected: boolean = false;
    private updateInterval: NodeJS.Timeout | null = null;

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
            const response = await axios.post('https://oauth2.googleapis.com/token', {
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code'
            });

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
            const response = await axios.post('https://oauth2.googleapis.com/token', {
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                refresh_token: this.refreshToken,
                grant_type: 'refresh_token'
            });

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
                // Check expiry
                if (this.expiryDate && Date.now() >= this.expiryDate) {
                    this.refreshAccessToken();
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
        // Clear existing
        this.reminderTimeouts.forEach(t => clearTimeout(t));
        this.reminderTimeouts = [];

        const now = Date.now();

        events.forEach(event => {
            const startStr = event.startTime;
            if (!startStr) return;

            const startTime = new Date(startStr).getTime();
            // Reminder time: 2 minutes before
            const reminderTime = startTime - (2 * 60 * 1000);

            if (reminderTime > now) {
                const delay = reminderTime - now;
                // Only schedule if within next 24h (which fetch already limits)
                if (delay < 24 * 60 * 60 * 1000) {
                    const timeout = setTimeout(() => {
                        this.showNotification(event);
                    }, delay);
                    this.reminderTimeouts.push(timeout);
                }
            }
        });
    }

    private showNotification(event: CalendarEvent) {
        const { Notification } = require('electron');
        const notif = new Notification({
            title: 'Meeting starting soon',
            body: `"${event.title}" starts in 2 minutes. Start Natively?`,
            actions: [
                { type: 'button', text: 'Start Meeting' },
                { type: 'button', text: 'Dismiss' }
            ],
            sound: true
        });

        notif.on('action', (event_unused: any, index: number) => {
            if (index === 0) {
                // Start Meeting
                // We need to tell the main process to open window and start meeting
                // Ideally we emit an event that AppState listens to
                this.emit('start-meeting-requested', event);
            }
        });

        notif.on('click', () => {
            // Just open window
            this.emit('open-requested');
        });

        notif.show();
    }

    // =========================================================================
    // Fetch Logic
    // =========================================================================

    public async getUpcomingEvents(force: boolean = false): Promise<CalendarEvent[]> {
        if (!this.isConnected || !this.accessToken) return [];

        // Check expiry
        if (this.expiryDate && Date.now() >= this.expiryDate - 60000) {
            await this.refreshAccessToken();
        }

        const events = await this.fetchEventsInternal();
        this.scheduleReminders(events);
        return events;
    }

    private async fetchEventsInternal(): Promise<CalendarEvent[]> {
        if (!this.accessToken) return [];

        // Range: now → end of next business day (so 2 business days total).
        // Friday → today + Monday. Saturday → Monday + Tuesday.
        const now = new Date();
        const next = nextBusinessDay(now);
        const endOfNext = new Date(next);
        endOfNext.setHours(23, 59, 59, 999);

        try {
            const response = await axios.get('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                headers: {
                    Authorization: `Bearer ${this.accessToken}`
                },
                params: {
                    timeMin: now.toISOString(),
                    timeMax: endOfNext.toISOString(),
                    singleEvents: true,
                    orderBy: 'startTime'
                }
            });

            const items = response.data.items || [];

            return items
                .filter((item: any) => {
                    // Filter: >= 5 mins, no all-day
                    if (!item.start?.dateTime || !item.end?.dateTime) return false; // All-day events have .date instead of .dateTime

                    const start = new Date(item.start.dateTime).getTime();
                    const end = new Date(item.end.dateTime).getTime();
                    const durationMins = (end - start) / 60000;

                    return durationMins >= 5;
                })
                .map((item: any): CalendarEvent | null => {
                    const link = this.resolveMeetingLink(item);
                    // Only include events that have a meeting link (Zoom / Meet / etc).
                    // Personal / non-meeting calendar events without a join link are
                    // skipped — Natively only cares about callable meetings.
                    if (!link) return null;

                    const colorId: string | null = item.colorId ?? null;
                    const colorHex = colorId && GCAL_COLOR_MAP[colorId] ? GCAL_COLOR_MAP[colorId] : null;
                    const attendees: EventAttendee[] = Array.isArray(item.attendees)
                        ? item.attendees.map((a: any) => ({
                            email: a.email || '',
                            name: a.displayName || null,
                            responseStatus: (a.responseStatus || 'needsAction') as EventAttendee['responseStatus'],
                        }))
                        : [];
                    return {
                        id: item.id,
                        title: item.summary || '(No Title)',
                        description: item.description || null,
                        startTime: item.start.dateTime,
                        endTime: item.end.dateTime,
                        link,
                        location: item.location || null,
                        attendees,
                        colorId,
                        colorHex,
                        source: 'google',
                    };
                })
                .filter((e: CalendarEvent | null): e is CalendarEvent => e !== null);

        } catch (error) {
            console.error('[CalendarManager] Failed to fetch events:', error);
            return [];
        }
    }

    // ── Two-way sync: write helpers ──────────────────────────────────────────
    // Generic PATCH for any subset of event fields. Caller provides the partial
    // body in Google Calendar API shape (e.g. { colorId: "9" }, { summary: "..." },
    // { start: { dateTime: "..." }, end: { dateTime: "..." } }).
    public async updateEvent(eventId: string, partial: Record<string, any>): Promise<{ success: boolean; error?: string }> {
        if (!this.isConnected || !this.accessToken) {
            return { success: false, error: 'Calendar not connected' };
        }
        // Refresh token if expired
        if (this.expiryDate && Date.now() >= this.expiryDate - 60000) {
            await this.refreshAccessToken();
        }
        try {
            await axios.patch(
                `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
                partial,
                { headers: { Authorization: `Bearer ${this.accessToken}` } }
            );
            return { success: true };
        } catch (error: any) {
            console.error(`[CalendarManager] Failed to update event ${eventId}:`, error?.response?.data || error);
            return { success: false, error: error?.message || 'Update failed' };
        }
    }

    // Convenience wrapper for the most common 2-way op: set the event color.
    public async updateEventColor(eventId: string, colorId: string): Promise<{ success: boolean; error?: string }> {
        return this.updateEvent(eventId, { colorId });
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
