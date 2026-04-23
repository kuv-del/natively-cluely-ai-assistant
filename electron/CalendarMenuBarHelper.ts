import { BrowserWindow, Tray, screen, app } from 'electron';
import path from 'path';

export class CalendarMenuBarHelper {
    private static win: BrowserWindow | null = null;
    private static currentTray: Tray | null = null;

    // Called once at tray startup — creates the window hidden so it's ready instantly.
    public static prewarm(tray: Tray): void {
        this.currentTray = tray;
        if (this.win && !this.win.isDestroyed()) return;
        this.createWindow(tray, false);
    }

    public static toggle(tray: Tray): void {
        this.currentTray = tray;
        if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
            this.hide();
        } else {
            this.show(tray);
        }
    }

    public static show(tray: Tray): void {
        this.currentTray = tray;
        if (!this.win || this.win.isDestroyed()) {
            this.createWindow(tray, true);
            return;
        }
        this.reposition(tray);
        // Tell the component to refresh events (no loading spinner — data comes in silently)
        this.win.webContents.send('menubar:refresh');
        this.win.show();
        this.win.focus();
    }

    public static hide(): void {
        if (this.win && !this.win.isDestroyed()) {
            this.win.hide();
        }
    }

    // Kept for IPC callers that need to close the popup before navigating.
    public static close(): void {
        this.hide();
    }

    public static getWindow(): BrowserWindow | null {
        return this.win && !this.win.isDestroyed() ? this.win : null;
    }

    private static reposition(tray: Tray): void {
        if (!this.win || this.win.isDestroyed()) return;
        const trayBounds = tray.getBounds();
        const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
        const { width } = this.win.getBounds();
        const x = Math.min(
            Math.round(trayBounds.x + trayBounds.width / 2 - width / 2),
            display.workArea.x + display.workArea.width - width
        );
        const y = Math.round(trayBounds.y + trayBounds.height + 4);
        this.win.setPosition(x, y);
    }

    private static createWindow(tray: Tray, showWhenReady: boolean): void {
        const trayBounds = tray.getBounds();
        const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });

        const width = 380;
        const height = 600;

        const x = Math.min(
            Math.round(trayBounds.x + trayBounds.width / 2 - width / 2),
            display.workArea.x + display.workArea.width - width
        );
        const y = Math.round(trayBounds.y + trayBounds.height + 4);

        const preloadPath = app.isPackaged
            ? path.join(process.resourcesPath, 'app.asar', 'dist-electron', 'electron', 'preload.js')
            : path.join(app.getAppPath(), 'dist-electron', 'electron', 'preload.js');

        this.win = new BrowserWindow({
            width,
            height,
            x,
            y,
            frame: false,
            resizable: false,
            movable: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            show: false,
            vibrancy: 'menu',
            visualEffectState: 'active',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: preloadPath,
            },
        });

        const indexPath = app.isPackaged
            ? path.join(process.resourcesPath, 'app.asar', 'dist', 'index.html')
            : path.join(app.getAppPath(), 'dist', 'index.html');

        this.win.loadURL(`file://${indexPath}?window=calendar-menubar`);

        if (showWhenReady) {
            this.win.once('ready-to-show', () => {
                this.win?.show();
                this.win?.focus();
            });
        }

        this.win.on('blur', () => {
            this.hide();
        });

        // If window is closed externally, clear the reference so prewarm re-creates it.
        this.win.on('closed', () => {
            this.win = null;
        });
    }
}
