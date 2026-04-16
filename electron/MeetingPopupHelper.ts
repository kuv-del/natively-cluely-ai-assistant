import { BrowserWindow, screen, app } from "electron"
import path from "node:path"

const isDev = process.env.NODE_ENV === "development"
const startUrl = isDev
    ? "http://localhost:5180"
    : `file://${path.join(app.getAppPath(), "dist/index.html")}`

const POPUP_WIDTH = 380
const POPUP_HEIGHT = 200

export interface PopupMeetingEvent {
    id: string
    title: string
    startTime: string
    endTime: string
    link?: string
    attendeeCount: number
}

export class MeetingPopupHelper {
    private popupWindow: BrowserWindow | null = null
    private pendingEvent: PopupMeetingEvent | null = null

    public show(event: PopupMeetingEvent): void {
        this.pendingEvent = event

        if (this.popupWindow && !this.popupWindow.isDestroyed()) {
            this.popupWindow.webContents.send("meeting-popup:event", event)
            this.popupWindow.show()
            return
        }

        this.createWindow()
    }

    public close(): void {
        if (this.popupWindow && !this.popupWindow.isDestroyed()) {
            this.popupWindow.close()
        }
        this.popupWindow = null
        this.pendingEvent = null
    }

    public getPendingEvent(): PopupMeetingEvent | null {
        return this.pendingEvent
    }

    private createWindow(): void {
        const primary = screen.getPrimaryDisplay()
        const { x: dx, y: dy, width: dw } = primary.workArea
        // Center horizontally, near the top
        const marginTop = 20
        const defaultX = dx + Math.round((dw - POPUP_WIDTH) / 2)
        const defaultY = dy + marginTop

        this.popupWindow = new BrowserWindow({
            width: POPUP_WIDTH,
            height: POPUP_HEIGHT,
            x: defaultX,
            y: defaultY,
            frame: false,
            transparent: true,
            resizable: false,
            fullscreenable: false,
            hasShadow: true,
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
        })

        if (process.platform === "darwin") {
            this.popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
            this.popupWindow.setAlwaysOnTop(true, "floating")
        }

        const url = `${startUrl}?window=meeting-popup`
        this.popupWindow.loadURL(url).catch(e => {
            console.error("[MeetingPopupHelper] Failed to load URL:", e)
        })

        this.popupWindow.once("ready-to-show", () => {
            this.popupWindow?.show()
            if (this.pendingEvent) {
                this.popupWindow?.webContents.send("meeting-popup:event", this.pendingEvent)
            }
        })

        this.popupWindow.on("closed", () => {
            this.popupWindow = null
        })
    }
}
