# Natively Build Pipeline & Electron Lifecycle — Explore Agent Report

**Generated:** 2026-04-13
**Scope:** build config, scripts, native modules, electron-builder, boot sequence, window inventory, renderer build details
**Critical finding:** The renderer build break is almost certainly a **path resolution or CSP issue**, not a fundamental build problem.

---

## 1. `package.json` Scripts

| Script | Purpose |
|---|---|
| `clean` | Remove `dist/` and `dist-electron/` |
| `dev` | Vite dev server on port 5180 (renderer only) |
| `build` | `clean` → `tsc` type-check → `vite build` → `dist/` |
| `build:electron` | esbuild transpile `electron/` → `dist-electron/` (10-50x faster than tsc, ~80ms) |
| `build:electron:tsc` | Type-check electron code only (no emit) |
| `typecheck:electron` | Strict type-check electron |
| `preview` | Vite preview production build |
| `postinstall` | Rebuild sharp, download models, ensure sqlite-vec, patch electron plist |
| `electron:dev` | `build:electron` → launch Electron in dev mode (`NODE_ENV=development`) |
| `electron:build` | `build:electron` → launch Electron in production mode |
| `app:dev` | Concurrent Vite dev + electron dev (full dev setup) |
| `app:build` | Full production: `build` → `build:electron` → `build:native` → `electron-builder` |
| `watch` | tsc watch mode on electron/ |
| `start` | Alias for `app:dev` |
| `dist` | Alias for `app:build` |
| `build:native` | Rust NAPI build for current platform (or all Mac arches if `NATIVELY_BUILD_ALL_MAC_ARCHES=1`) |

---

## 2. Build Pipeline

```
npm run app:build
    │
    ├── npm run build                    # Renderer
    │     ├── clean (rm dist/, dist-electron/)
    │     ├── tsc --noEmit (type check)
    │     └── vite build
    │           └── dist/
    │               ├── index.html
    │               └── assets/
    │                   ├── index-[hash].js      (1.9 MB app bundle)
    │                   ├── vendor-[hash].js     (React + framer-motion)
    │                   ├── ui-[hash].js         (Radix + lucide-react)
    │                   ├── index-[hash].css     (Tailwind)
    │                   └── fonts, icons, images
    │
    ├── npm run build:electron           # Main process
    │     └── esbuild transpile
    │           └── dist-electron/
    │               ├── electron/**/*.js + .map  (preserves directory structure)
    │               └── premium/electron/**/*.js (if premium/ exists in source)
    │
    ├── npm run build:native             # Rust NAPI
    │     ├── cargo build for aarch64-apple-darwin + x86_64-apple-darwin
    │     ├── install_name_tool rewrites absolute dylib paths to @loader_path
    │     └── native-module/
    │           ├── index.darwin-arm64.node
    │           └── index.darwin-x64.node
    │
    └── electron-builder                  # Package
          ├── Files: dist/, dist-electron/, native-module/, node_modules/, package.json
          ├── asarUnpack: **/*.node, **/*.dylib
          ├── afterPack: scripts/ad-hoc-sign.js (self-sign, identity: null)
          └── release/
              ├── Natively-2.4.0-arm64.dmg
              ├── Natively-2.4.0-mac.zip
              └── latest-mac.yml (auto-update manifest)
```

### Key build details

- **Renderer:** TypeScript type-checked, then Vite bundled to `dist/` with hashed asset filenames and Rollup manual chunking
- **Electron:** esbuild **transpile-only** (no type check, no bundling — preserves `require()` and directory structure for Node.js runtime resolution)
- **Native:** Rust NAPI with `install_name_tool` dylib path rewriting for portability
- **Packaging:** electron-builder with `asarUnpack` for native binaries

---

## 3. Native Dependencies

| Module | Type | Purpose | Build | Unpack |
|---|---|---|---|---|
| **natively-audio** | Rust NAPI | Mic + system audio capture with VAD | `cargo build` via napi-rs | ✓ `.node` |
| **sharp** | npm | Image processing (screenshots) | `npm rebuild sharp` (SHARP_IGNORE_GLOBAL_LIBVIPS=1) | ✓ binaries |
| **better-sqlite3** | npm | Embedded SQL | auto-rebuild | ✓ `.node` |
| **sqlite-vec** | npm optional | Vector DB extension | optional deps (darwin-arm64 / darwin-x64 split) | ✓ `.node` |
| **ffmpeg-installer** | npm | FFmpeg binary | auto-rebuild | ✗ (used via PATH) |

### postinstall sequence
```bash
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm rebuild sharp
  → rebuilds sharp with vendored C libraries
node scripts/download-models.js
  → downloads Xenova transformers (~200-400 MB) to resources/models/
node scripts/ensure-sqlite-vec.js
  → copies platform-specific sqlite-vec .node files
node scripts/patch-electron-plist.js
  → patches node_modules/electron/.../Electron.app/Info.plist
  → adds NSScreenCaptureUsageDescription + NSMicrophoneUsageDescription
```

---

## 4. electron-builder Config

```json
{
  "appId": "com.electron.meeting-notes",
  "productName": "Natively",
  "afterPack": "./scripts/ad-hoc-sign.js",
  "files": [
    "dist", "dist-electron", "native-module",
    "package.json", "node_modules",
    "!**/native-module/target",
    "!**/native-module/src",
    "!**/native-module/.cargo"
  ],
  "asarUnpack": [
    "**/*.node",
    "**/*.dylib"
  ],
  "directories": { "output": "release", "buildResources": "assets" },
  "extraResources": [
    { "from": "assets/", "to": "assets/" },
    { "from": "assets/natively.icns", "to": "natively.icns" },
    { "from": "resources/models/", "to": "models/" }
  ],
  "mac": {
    "category": "public.app-category.productivity",
    "target": ["zip", "dmg"],
    "arch": ["x64", "arm64"],
    "identity": null,
    "hardenedRuntime": false,
    "extendInfo": {
      "NSScreenCaptureUsageDescription": "...",
      "NSMicrophoneUsageDescription": "..."
    }
  }
}
```

Key security:
- **No hardened runtime** (`hardenedRuntime: false`)
- **No code signing** (`identity: null`)
- **Content protection** enabled in undetectable mode
- **IPC security:** `nodeIntegration: false`, `contextIsolation: true`, preload script enforces sandboxing

---

## 5. Boot Sequence (20 steps)

1. **[Process init]** stdout/stderr error handlers — prevent EIO crash on Spotlight launch
2. **[Process init]** uncaught exception + unhandled rejection handlers → log to `~/Documents/natively_debug.log`
3. **[Console override]** `console.log/warn/error` patched → debug log with `[LOG]/[WARN]/[ERROR]` prefixes, rotated at 10MB
4. **[Module load]** dotenv loaded (dev only)
5. **[Main process]** `app.whenReady()` awaited
6. **[Pre-emptive dock hide]** `app.dock.hide()` if `isUndetectable=true` (macOS) — MUST happen BEFORE window creation
7. **[Managers]** `CredentialsManager.getInstance().init()` — load API keys from safeStorage
8. **[AppState]** `AppState.getInstance()` — constructor creates WindowHelper + SettingsWindowHelper + ModelSelectorWindowHelper + CropperWindowHelper, loads RAGManager + KnowledgeOrchestrator (if premium available), warms up intent classifier in background, sets up Ollama + auto-updater
9. **[IPC registration]** `initializeIpcHandlers(appState)` — 100+ ipcMain handlers
10. **[Disguise init]** `applyInitialDisguise()` — set process.title, app.setName, AUMID
11. **[Ollama lifecycle]** `OllamaManager.getInstance().init()` — detect/start daemon
12. **[Install ping]** anonymous telemetry (one-time, non-blocking)
13. **[Credentials]** GoogleServiceAccount path load
14. **[Window creation]** `appState.createWindow()` — launcher (1200×800, centered) + overlay (hidden). Loads `file:///.../dist/index.html?window=launcher`. Both windows `show: false` until `ready-to-show`.
15. **[Tray setup]** `appState.showTray()` (non-stealth mode)
16. **[Shortcuts registration]** `KeybindManager.registerGlobalShortcuts()` — Cmd+H, Cmd+B, Cmd+Enter, etc.
17. **[Settings preload]** `settingsWindowHelper.preloadWindow()` — offscreen (-10000, -10000) for instant first open
18. **[macOS TCC prompt]** `desktopCapturer.getSources()` once → trigger one-time Screen Recording permission dialog
19. **[Calendar manager]** `CalendarManager.getInstance().init()` — wire "start-meeting-requested" → startMeeting()
20. **[Recovery]** `getIntelligenceManager().recoverUnprocessedMeetings()` — resume crashed meetings

Then: `app.on("activate")` + `app.on("window-all-closed")` + `app.on("before-quit")` (scrub API keys from memory)

---

## 6. Window Inventory

| Window | Helper Class | Entry Point | Dimensions | Frame | Transparent | AlwaysOnTop | Notes |
|---|---|---|---|---|---|---|---|
| **Launcher** | `WindowHelper` | `file:///.../dist/index.html?window=launcher` | 1200×800 centered | macOS hiddenInset | macOS: yes | No | vibrancy: under-window; custom traffic lights at 14,14 |
| **Overlay** | `WindowHelper` | Same URL | 600×1 initially; resizable | macOS hiddenInset | macOS: yes | Yes | visibleOnAllWorkspaces, hidden in Mission Control |
| **Settings** | `SettingsWindowHelper` | Same URL, queries `?window=settings` | Dropdown, anchored to launcher | macOS hiddenInset | macOS: yes | No | Preloaded offscreen for instant first open |
| **ModelSelector** | `ModelSelectorWindowHelper` | Same URL | Dropdown | macOS hiddenInset | macOS: yes | Overlay-aware | Parent window set dynamically |
| **Cropper** | `CropperWindowHelper` | Same URL | Full-screen overlay | borderless | yes | Yes | Opacity shield on Windows (60ms → opacity=1) |

**All five windows load the SAME Vite bundle from the SAME `index.html`.** Window mode is distinguished purely by the `?window=` query param. React routing in `App.tsx` inspects `window.location.search` and renders the right component tree.

---

## 7. Renderer Build Details

### Vite config (`vite.config.mts`)
```typescript
export default defineConfig({
  plugins: [react()],
  base: './',                    // ⚠️ CRITICAL for file:// protocol
  resolve: { alias: { "@": "./src" } },
  server: { port: 5180 },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'framer-motion'],
          ui: ['lucide-react', '@radix-ui/react-dialog', '@radix-ui/react-toast']
        }
      }
    }
  }
})
```

### `dist/index.html`
```html
<head>
  <script type="module" crossorigin src="./assets/index-CwDzidES.js"></script>
  <link rel="modulepreload" crossorigin href="./assets/ui-BbFxKLIq.js">
  <link rel="modulepreload" crossorigin href="./assets/vendor-D9xj2CfN.js">
  <link rel="stylesheet" crossorigin href="./assets/index-fS7ZejjL.css">
</head>
<body style="background-color: transparent; margin: 0; overflow: hidden;">
  <div id="root"></div>
</body>
```

### Bundle structure
- Single HTML entry (1.6KB)
- Three manual chunks:
  - `vendor-[hash].js` — React, React-DOM, Framer-Motion
  - `ui-[hash].js` — Radix UI, Lucide icons
  - `index-[hash].js` — App code (1.9MB)
- Single CSS bundle (Tailwind + custom)
- Font/image assets with content hashes

### Renderer entry (`src/main.tsx`)
```typescript
// Platform detection BEFORE React render
document.documentElement.setAttribute('data-platform', window.electronAPI?.platform ?? '');

// Theme init (prevents flash)
const cachedTheme = localStorage.getItem('natively_resolved_theme');
document.documentElement.setAttribute('data-theme', cachedTheme ?? 'dark');

// React mount
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
```

### **NO multi-entry build**
- Not a multi-entry Vite build with separate launcher/overlay/settings HTML files
- Single bundle loads in all windows
- Window mode via URL query param (`?window=launcher` / `?window=overlay` / `?window=settings`)
- **Implication:** all JS is parsed and shipped to all windows (no per-window code splitting)

---

## 8. Native Module Deep Dive

### File structure
```
native-module/
├── Cargo.toml                  (Rust manifest)
├── Cargo.lock
├── package.json                (NAPI binaryName: "index")
├── index.d.ts                  (TypeScript bindings)
├── index.js                    (Node.js loader; requires platform .node)
├── src/
│   ├── lib.rs                  (Rust entry, #[napi] macros)
│   └── ...
├── index.darwin-x64.node       (Intel Mac binary)
└── index.darwin-arm64.node     (Apple Silicon binary)
```

### Exported APIs (from `index.d.ts`)
```typescript
class MicrophoneCapture {
  getSampleRate(): number
  start(callback, onSpeechEnded?): void
  stop(): void
}
class SystemAudioCapture {
  getSampleRate(): number
  start(callback, onSpeechEnded?): void
  stop(): void
}

getInputDevices(): AudioDeviceInfo[]
getOutputDevices(): AudioDeviceInfo[]

// License validation
verifyDodoKey(key, deviceLabel): Promise<string>
validateDodoKey(key): Promise<string>
deactivateDodoKey(key, instanceId): Promise<string>
verifyGumroadKey(key): Promise<string>

// Hardware ID
getHardwareId(): string
```

### Cargo dependencies
- `cpal` (0.15.2) — cross-platform audio I/O
- `ringbuf` (0.4) — lock-free ring buffer for audio chunks
- `webrtc-vad` (0.4) — voice activity detection
- `cidre` (0.11.10, macOS only) — Objective-C bindings, CoreAudio tap
- `wasapi` (0.13.0, Windows only) — Windows Audio Session API
- `reqwest` (0.12) — HTTP client for license validation
- `rubato` (0.16) — audio resampling
- `sha2` (0.10), `machine-uid` (0.5) — hardware ID fingerprint

### Why unpack from asar
- `.node` files are native binaries loaded via `dlopen()` — must be on filesystem
- asar is transparent to JavaScript but not to the OS
- electron-builder auto-unpacks via `asarUnpack: ["**/*.node"]`

---

## 9. Build Issues & Quirks

### ⭐ Broken renderer bundle (current state — likely fix target)

**Symptom:** raw JavaScript appears as text in overlay webview

**Root cause hypotheses (most → least likely):**

1. **index.html or assets not being found** (404s) — if WindowHelper loads a URL like `file:///.../dist/index.html?window=overlay` and the path doesn't exist, Chromium falls back to showing the file system directory listing OR the raw content of whatever file was attempted. Verify `dist/index.html` exists after `npm run build` and that `WindowHelper.startUrl` points to the correct absolute path in production mode.

2. **Relative path resolution breaking** — the `base: './'` in vite.config.mts is critical for `file://` protocol. If it were `base: '/'`, assets would be loaded from `file:///assets/...` (filesystem root), causing 404s. Our rebuild may have introduced a config drift here. Verify `base: './'` still present in vite.config.mts AND that the built index.html uses `./assets/...` paths.

3. **Content-Security-Policy blocking inline scripts or module imports** — Electron's default CSP may block `type="module"` scripts without proper headers. If an index.html in our rebuild lost its meta CSP tag, the scripts would be blocked and Chromium would display the raw file content.

4. **Query param parsing broken** — if `App.tsx` can't parse `?window=overlay` correctly (e.g., the `?` got URL-encoded as `%3F`), the routing falls through and nothing renders.

5. **Hashed asset name mismatch** — when we layered the fresh `dist/` onto the old asar, the new `index-[hash].js` hash might not have been referenced by a correctly-updated `index.html`. But since I used `rm -rf dist && cp -R dist` this should not have happened. Worth verifying.

**Investigation checklist:**
- [ ] Run `npm run build` and confirm `dist/index.html` exists
- [ ] Open `dist/index.html` in a text editor, confirm it has `<script type="module" src="./assets/index-[hash].js">` (with `./`, not `/`)
- [ ] Check `vite.config.mts` has `base: './'`
- [ ] Check the DevTools console in both launcher and overlay for CSP violations or 404 errors
- [ ] Verify `WindowHelper.startUrl` in `dist-electron/electron/WindowHelper.js` points to `file:///.../dist/index.html?window=X`

### Other quirks

- **esbuild vs tsc for electron code:** build script uses **esbuild** (transpile-only, no type check). Type checking must be run separately via `typecheck:electron`. Tradeoff: speed vs type safety.
- **Dylib patching (macOS):** Rust native deps link to absolute paths like `/usr/local/Cellar/...`. `build-native.js` fixes these to `@loader_path` via `install_name_tool`. Fails silently if tool not found → runtime crash.
- **Model download on postinstall:** ~200-400MB Xenova transformers download. If network fails, models won't be available.
- **Plist patching (dev only):** `patch-electron-plist.js` patches `node_modules/electron/.../Electron.app/Info.plist`. Only applies to dev Electron.app. For packaged app, `electron-builder`'s `mac.extendInfo` patches the final `.app`.
- **Single instance lock:** `app.requestSingleInstanceLock()` prevents duplicate dock icons during hot-reload.

---

## 10. Renderer vs Electron Versioning

| Layer | Version | Bundler | Target | Output |
|---|---|---|---|---|
| Renderer | React 18.3.1 | Vite 5.4.11 | ESNext | `dist/` (ES modules) |
| Electron | Electron 33.2.0 | esbuild | CommonJS for Node 20 | `dist-electron/` (CJS) |
| TypeScript | 5.6.3 | — | ESNext | Type-checked before build |

---

## 11. Async Bootstrap Race Hazards

1. **RAGManager init** — sync constructor but async DB access → renderer using RAG before DB ready = null ref
2. **Ollama bootstrap** (`_ollamaBootstrapPromise`) — fire-and-forget, renderer can request embeddings before models ready
3. **KnowledgeOrchestrator setup** — depends on RAGManager + Ollama
4. **Auto-updater check** (10s after app-ready) — non-blocking
5. **Calendar manager init** — async, silent failure if missing

**Mitigation:** each manager has `waitForReady()` or fallback paths; renderers check `.isReady()` before use.

---

## Summary artifacts

| Artifact | Location | Size | Built by | Purpose |
|---|---|---|---|---|
| Renderer bundle | `dist/index.html` + assets | ~2.5 MB | Vite | UI for all windows |
| Electron code | `dist-electron/electron/**/*.js` | ~3 MB | esbuild | Main process |
| Native module | `native-module/index.*.node` | ~5-10 MB per arch | Rust NAPI | Audio capture |
| Dependencies | `node_modules/` | ~500 MB | npm | Runtime deps |
| Models | `resources/models/` | ~400 MB | Xenova | ML embeddings |
| App.asar | `release/Natively-*.app/Contents/Resources/app.asar` | ~1+ GB | electron-builder | Packaged archive |

---

**Conclusion on rebuild vs debug:** this is a production-grade architecture with reasonable complexity. The broken renderer bundle is almost certainly a **path resolution or CSP issue**, not a fundamental build problem. Debugging it should take 10-30 minutes with the investigation checklist above.
