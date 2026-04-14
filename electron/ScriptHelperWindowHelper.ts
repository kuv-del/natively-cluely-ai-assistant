import { BrowserWindow, screen, app } from "electron"
import { WindowHelper } from "./WindowHelper"
import path from "node:path"
import fs from "node:fs"

const isDev = process.env.NODE_ENV === "development"

const startUrl = isDev
    ? "http://localhost:5180"
    : `file://${path.join(app.getAppPath(), "dist/index.html")}`

const WINDOW_WIDTH = 420
const WINDOW_HEIGHT = 760

// Dossier files dropped here are auto-loaded when Kate clicks Prepare on the
// matching calendar event. One file per event, keyed by calendar event id.
// External scripts (Claude Pro Max, etc.) write here.
export const PREP_DIR = path.join(app.getPath("userData"), "prep")

export interface ScriptHelperDossier {
    event_id?: string
    prospect?: {
        name?: string
        title?: string
        company?: string
        industry?: string
        revenue?: string
        headcount?: number | string
        deal_stage?: string
        deal_value?: string
        last_touchpoint?: string
    }
    pain_points?: string[]
    script?: Array<{ question: string; notes?: string }>
    talking_points?: string[]
    previous_meeting_summary?: string
    // Free-form extras — rendered if present, ignored otherwise
    [key: string]: any
}

/**
 * Floating panel that shows a prospect dossier + scripted questions + talking
 * points during the pre-call prep phase and through the live call. Opened via
 * the Prepare button in the Launcher; persists until Kate closes it manually.
 *
 * Unlike SettingsWindowHelper, this window does NOT close on blur — Kate will
 * click into Zoom / other apps during the call and the panel must stay visible.
 */
export class ScriptHelperWindowHelper {
    private scriptHelperWindow: BrowserWindow | null = null
    private windowHelper: WindowHelper | null = null
    private contentProtection: boolean = false
    private opacityTimeout: NodeJS.Timeout | null = null

    // Dossier state — held in main process so the renderer can fetch on mount
    // without having to reload the file on every reopen.
    private currentDossier: ScriptHelperDossier | null = null

    constructor() {
        // Ensure prep directory exists
        try {
            if (!fs.existsSync(PREP_DIR)) {
                fs.mkdirSync(PREP_DIR, { recursive: true })
                console.log(`[ScriptHelperWindowHelper] Created prep dir: ${PREP_DIR}`)
            }
        } catch (err) {
            console.error("[ScriptHelperWindowHelper] Failed to ensure prep dir:", err)
        }
    }

    public setWindowHelper(wh: WindowHelper): void {
        this.windowHelper = wh
    }

    public getWindow(): BrowserWindow | null {
        return this.scriptHelperWindow
    }

    public setContentProtection(enable: boolean): void {
        this.contentProtection = enable
        if (this.scriptHelperWindow && !this.scriptHelperWindow.isDestroyed()) {
            this.scriptHelperWindow.setContentProtection(enable)
        }
    }

    // =========================================================================
    // Dossier state
    // =========================================================================

    public getDossier(): ScriptHelperDossier | null {
        return this.currentDossier
    }

    public setDossier(dossier: ScriptHelperDossier | null): void {
        this.currentDossier = dossier
        // Push to the open window so the renderer can update without refetching
        if (this.scriptHelperWindow && !this.scriptHelperWindow.isDestroyed()) {
            this.scriptHelperWindow.webContents.send("script-helper:dossier-loaded", dossier)
        }
    }

    /**
     * Read the dossier file for a specific calendar event WITHOUT touching the
     * Script Helper's current state. Used by the Meeting Details Prep tab,
     * which needs to display a meeting's prep without affecting the live
     * Script Helper window's loaded dossier.
     */
    public readDossierForEvent(eventId: string): ScriptHelperDossier | null {
        if (!eventId) return null;
        try {
            const filePath = path.join(PREP_DIR, `${eventId}.json`);
            if (!fs.existsSync(filePath)) return null;
            const raw = fs.readFileSync(filePath, "utf8");
            return JSON.parse(raw) as ScriptHelperDossier;
        } catch (err) {
            console.error(`[ScriptHelperWindowHelper] readDossierForEvent ${eventId} failed:`, err);
            return null;
        }
    }

    /**
     * Load the dossier JSON file for a specific calendar event, if one exists.
     * Sets the dossier as the current one and broadcasts to the open window.
     * Returns the loaded dossier, or null if no file was found.
     */
    public loadDossierForEvent(eventId: string): ScriptHelperDossier | null {
        if (!eventId) return null
        try {
            const filePath = path.join(PREP_DIR, `${eventId}.json`)
            if (!fs.existsSync(filePath)) {
                console.log(`[ScriptHelperWindowHelper] No dossier file for event ${eventId}`)
                this.setDossier(null)
                return null
            }
            const raw = fs.readFileSync(filePath, "utf8")
            const parsed = JSON.parse(raw) as ScriptHelperDossier
            console.log(`[ScriptHelperWindowHelper] Loaded dossier for event ${eventId}`)
            this.setDossier(parsed)
            return parsed
        } catch (err) {
            console.error(`[ScriptHelperWindowHelper] Failed to load dossier for ${eventId}:`, err)
            this.setDossier(null)
            return null
        }
    }

    /**
     * Accept a dossier JSON string pasted by Kate through the UI fallback.
     * Parses, validates loosely, and sets as current.
     */
    public pasteDossier(jsonText: string): { success: boolean; error?: string } {
        try {
            const parsed = JSON.parse(jsonText) as ScriptHelperDossier
            this.setDossier(parsed)
            // Persist to disk for future reopens, keyed by event_id if present
            if (parsed.event_id) {
                try {
                    const filePath = path.join(PREP_DIR, `${parsed.event_id}.json`)
                    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), "utf8")
                    console.log(`[ScriptHelperWindowHelper] Persisted pasted dossier to ${filePath}`)
                } catch (err) {
                    console.warn("[ScriptHelperWindowHelper] Could not persist pasted dossier:", err)
                }
            }
            return { success: true }
        } catch (err: any) {
            return { success: false, error: err?.message || "Invalid JSON" }
        }
    }

    // =========================================================================
    // Window lifecycle
    // =========================================================================

    public openWindow(): void {
        if (this.scriptHelperWindow && !this.scriptHelperWindow.isDestroyed()) {
            this.showWindow()
            return
        }
        this.createWindow()
    }

    public showWindow(): void {
        if (!this.scriptHelperWindow || this.scriptHelperWindow.isDestroyed()) {
            this.createWindow()
            return
        }

        if (process.platform === "win32" && this.contentProtection) {
            this.scriptHelperWindow.setOpacity(0)
            this.scriptHelperWindow.showInactive()
            this.scriptHelperWindow.setContentProtection(true)
            if (this.opacityTimeout) clearTimeout(this.opacityTimeout)
            this.opacityTimeout = setTimeout(() => {
                if (this.scriptHelperWindow && !this.scriptHelperWindow.isDestroyed()) {
                    this.scriptHelperWindow.setOpacity(1)
                }
            }, 60)
        } else {
            this.scriptHelperWindow.setContentProtection(this.contentProtection)
            this.scriptHelperWindow.showInactive()
        }
    }

    public closeWindow(): void {
        if (this.scriptHelperWindow && !this.scriptHelperWindow.isDestroyed()) {
            this.scriptHelperWindow.hide()
        }
    }

    public isVisible(): boolean {
        return !!(this.scriptHelperWindow && !this.scriptHelperWindow.isDestroyed() && this.scriptHelperWindow.isVisible())
    }

    private createWindow(): void {
        const primary = screen.getPrimaryDisplay()
        const { x: dx, y: dy, width: dw, height: dh } = primary.workArea
        const marginRight = 20
        const defaultX = dx + dw - WINDOW_WIDTH - marginRight
        const defaultY = dy + Math.max(0, Math.round((dh - WINDOW_HEIGHT) / 2))

        const windowSettings: Electron.BrowserWindowConstructorOptions = {
            width: WINDOW_WIDTH,
            height: WINDOW_HEIGHT,
            x: defaultX,
            y: defaultY,
            frame: false,
            transparent: true,
            resizable: true,
            minWidth: 340,
            minHeight: 400,
            fullscreenable: false,
            hasShadow: false,
            alwaysOnTop: true,
            backgroundColor: "#00000000",
            show: false,
            skipTaskbar: true,
            focusable: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, "preload.js"),
                backgroundThrottling: false
            }
        }

        this.scriptHelperWindow = new BrowserWindow(windowSettings)

        if (process.platform === "darwin") {
            this.scriptHelperWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
            this.scriptHelperWindow.setHiddenInMissionControl(true)
            this.scriptHelperWindow.setAlwaysOnTop(true, "floating")
        }

        console.log(`[ScriptHelperWindowHelper] Creating window with Content Protection: ${this.contentProtection}`)
        this.scriptHelperWindow.setContentProtection(this.contentProtection)

        const url = `${startUrl}?window=script-helper`
        this.scriptHelperWindow.loadURL(url).catch(e => {
            console.error("[ScriptHelperWindowHelper] Failed to load URL:", e)
        })

        this.scriptHelperWindow.once("ready-to-show", () => {
            this.showWindow()
            // If a dossier was staged before the window existed, push it now
            if (this.currentDossier) {
                this.scriptHelperWindow?.webContents.send("script-helper:dossier-loaded", this.currentDossier)
            }
        })

        // Deliberately NO blur handler — the Script Helper must stay open while
        // Kate interacts with Zoom and other apps during a live call.

        this.scriptHelperWindow.on("closed", () => {
            this.scriptHelperWindow = null
        })
    }
}
