import { BrowserWindow, Tray, screen, app } from 'electron';
import path from 'path';

export class CalendarMenuBarHelper {
    private static win: BrowserWindow | null = null;

    public static toggle(tray: Tray): void {
        if (this.win && !this.win.isDestroyed()) {
            this.close();
        } else {
            this.open(tray);
        }
    }

    public static open(tray: Tray): void {
        if (this.win && !this.win.isDestroyed()) return;

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

        this.win.once('ready-to-show', () => {
            this.win?.show();
        });

        this.win.on('blur', () => {
            this.close();
        });

        this.win.on('closed', () => {
            this.win = null;
        });
    }

    public static close(): void {
        if (this.win && !this.win.isDestroyed()) {
            this.win.close();
            this.win = null;
        }
    }

    public static getWindow(): BrowserWindow | null {
        return this.win && !this.win.isDestroyed() ? this.win : null;
    }
}
