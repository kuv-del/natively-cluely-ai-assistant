/**
 * ZoomDetector — polls for Zoom's CptHost subprocess to detect
 * when Kate joins/leaves a Zoom call. Auto-starts/stops Natively sessions.
 *
 * CptHost is Zoom's audio/video processing host — it only runs during
 * an active call. When it appears, a call started. When it disappears,
 * the call ended.
 */
import { exec } from "child_process";
import { EventEmitter } from "events";

const POLL_INTERVAL_MS = 5000; // Check every 5 seconds

export class ZoomDetector extends EventEmitter {
    private pollTimer: NodeJS.Timeout | null = null;
    private wasInCall: boolean = false;
    private callStartedAt: number = 0;

    /**
     * Start polling for Zoom call state.
     * Emits 'call-started' when a Zoom call begins.
     * Emits 'call-ended' when a Zoom call ends.
     */
    public start(): void {
        if (this.pollTimer) return;

        console.log('[ZoomDetector] Starting Zoom call detection (polling every 5s)');

        // Check immediately
        this.checkZoomState();

        // Then poll
        this.pollTimer = setInterval(() => {
            this.checkZoomState();
        }, POLL_INTERVAL_MS);
    }

    public stop(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        console.log('[ZoomDetector] Stopped');
    }

    public isInCall(): boolean {
        return this.wasInCall;
    }

    private checkZoomState(): void {
        // pgrep -x "CptHost" returns 0 if found, 1 if not found
        exec('pgrep -x "CptHost"', (error, stdout) => {
            const inCall = !error && stdout.trim().length > 0;

            if (inCall && !this.wasInCall) {
                // Zoom call just started
                this.wasInCall = true;
                this.callStartedAt = Date.now();
                console.log('[ZoomDetector] Zoom call STARTED');
                this.emit('call-started', { startedAt: this.callStartedAt });
            } else if (!inCall && this.wasInCall) {
                // Zoom call just ended
                const duration = Date.now() - this.callStartedAt;
                this.wasInCall = false;
                console.log(`[ZoomDetector] Zoom call ENDED (duration: ${Math.round(duration / 1000)}s)`);
                this.emit('call-ended', { duration, startedAt: this.callStartedAt });
            }
        });
    }
}
