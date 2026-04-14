# Natively Fork Source Architecture — Explore Agent Report

**Generated:** 2026-04-13
**Scope:** `src/` (React renderer) + `electron/` (main process), excluding `premium/`, `temp/`, `node_modules/`, `dist*/`
**Source of truth for:** component inventory, IPC surface, window helpers, LLM adapter surface, preload bridge, hotkeys, native modules, licensing seams

---

## 1. Top-level Shape

**Entry points:**
- **Renderer:** `src/main.tsx` → `ReactDOM.createRoot` → `src/App.tsx`. Vite dev server at `http://localhost:5180`; production loads from `file://{appPath}/dist/index.html`.
- **Main process:** `electron/main.ts`. Initializes logging, permission checks (macOS mic/screen recording), creates windows via helper classes, registers IPC handlers.

**Architecture overview:** Multi-window Electron overlay app. The window routing is driven by URL search params — `App.tsx` inspects the query string and renders one of: Launcher (dashboard), Overlay (live coaching assistant), Settings, ModelSelector, Cropper. Premium features are conditionally loaded via `require('../premium/...')` with try/catch fallback. Content protection (macOS) prevents screen capture; mouse passthrough supports undetectable operation during live calls.

---

## 2. Renderer (`src/`) — Component Inventory

### Pages (`src/_pages/`)
- `Debug.tsx` — dev UI for problem extraction
- `Queue.tsx` — screenshot/session queue view
- `Solutions.tsx` — legacy code copilot solution display

### Core app/layout (`src/`)
- `App.tsx` — window type router (launcher/overlay/settings/model-selector/cropper), analytics init, theme sync. React Query + Framer Motion. Calls `window.electronAPI.getThemeMode()`, `onThemeChanged`.
- `main.tsx` — React root bootstrap, sync platform attribute + theme from `window.electronAPI`
- `index.css` — global styles, theme CSS custom properties

### Components — primary UI (`src/components/`)
- **`NativelyInterface.tsx`** — main live-meeting overlay: chat, transcript, suggested answers, clarify, recap, follow-up questions, manual recording. **Heavy IPC consumer** — uses `useShortcuts` hook for keybinds, streams chat, handles screenshot attachment.
- **`Launcher.tsx`** — dashboard: meeting list, quick-start, settings toggle, calendar integration
- `SettingsPopup.tsx` — legacy settings modal (kept for back-compat)
- **`SettingsOverlay.tsx`** — modern settings UI, renders provider cards + API key inputs
- **`ModelSelectorWindow.tsx`** — dropdown UI for LLM model selection. IPC: `switchToOllama()`, `switchToGemini()`, `testLlmConnection()`, `getCurrentLlmConfig()`, `getAvailableOllamaModels()`
- **`Cropper.tsx`** — area selection overlay (React.lazy loaded). IPC: `setUndetectable()`, `toggleOverlayMousePassthrough()`
- `GlobalChatOverlay.tsx` — floating chat for non-call mode
- `MeetingChatOverlay.tsx` — chat during active meeting
- `FollowUpEmailModal.tsx` — compose follow-up email post-call (LLM-backed)
- `MeetingDetails.tsx` — call summary, transcript, action items display
- `NativelyQuotaBanner.tsx` — STT/AI quota usage display. IPC: `getNativelyUsage()`, `getTrialStatus()`
- `StartupSequence.tsx` — app init UI (permission checks)
- `UpdateBanner.tsx` / `UpdateModal.tsx` — electron-updater integration
- `WindowControls.tsx` — custom chrome min/max/close buttons
- `TopSearchPill.tsx`, `SupportToaster.tsx`, `FeatureSpotlight.tsx`, `ErrorBoundary.tsx`, `EditableTextBlock.tsx`, `SuggestionOverlay.tsx`, `AboutSection.tsx`, `NativelyLogoMark.tsx` — supporting UI

### Components — settings (`src/components/settings/`)
- `AIProvidersSettings.tsx` — LLM provider config (Gemini/Groq/OpenAI/Claude/Ollama). IPC: model switchers, API key setters, `testLlmConnection()`
- `NativelyApiSettings.tsx` — Natively API key + quota display
- `HelpSettings.tsx` — help/docs panel
- `ProviderCard.tsx` — reusable selection card
- `Sidebar.tsx` — settings nav

### Components — queue/solutions
- `Queue/ScreenshotQueue.tsx`, `ScreenshotItem.tsx`, `QueueCommands.tsx` — screenshot management
- `Solutions/SolutionCommands.tsx` — legacy solution actions

### Components — onboarding/trial
- `onboarding/PermissionsToaster.tsx` — permission prompt toasts
- `trial/FreeTrialBanner.tsx`, `FreeTrialModal.tsx`, `TrialPromoToaster.tsx` — trial UX. IPC: `startTrial()`, `getTrialStatus()`, `convertTrial()`, `endTrialByok()`

### UI primitives (`src/components/ui/`)
- `card.tsx`, `dialog.tsx`, `toast.tsx` (shadcn-style)
- `ConnectCalendarButton.tsx` — Google Calendar OAuth
- `KeyBadge.tsx`, `KeyRecorder.tsx` — keyboard shortcut UI
- `ModelSelector.tsx` — model dropdown (inline variant)
- `RollingTranscript.tsx` — live transcript display
- `TopPill.tsx` — floating top-of-screen UI

### Configuration (`src/config/`)
- `languages.ts` — STT + AI response language lists (RECOGNITION_LANGUAGES, AI_RESPONSE_LANGUAGES)
- `stt.constants.ts` — STT provider constants

### Hooks (`src/hooks/`)
- `useResolvedTheme.ts` — theme detection + localStorage sync
- `useShortcuts.ts` — keyboard shortcut detection/binding
- `useStreamBuffer.ts` — buffer streamed LLM text

### Services (`src/lib/`)
- `analytics/analytics.service.ts` — analytics singleton tracking app/session events
- `featureFlags.ts`, `overlayAppearance.ts`, `utils.ts`, `curl-validator.ts`, `keyboardUtils.ts`, `modelUtils.ts`, `pdfGenerator.ts`, `platformUtils.ts` — utilities

### Types (`src/types/`)
- `electron.d.ts` — **critical** — TypeScript declarations for entire `window.electronAPI` IPC surface
- `index.tsx`, `solutions.ts`, `audio.ts` — app-level types

### Premium optional (`src/premium/`)
- `index.tsx` — Conditional dynamic imports via Vite glob (`import.meta.glob`). Gracefully degrades to no-op when premium modules absent. Exports: `JDAwarenessToaster`, `ProfileFeatureToaster`, `PremiumPromoToaster`, `RemoteCampaignToaster`, `PremiumUpgradeModal`, `NativelyApiPromoToaster`, `MaxUltraUpgradeToaster`, `useAdCampaigns`. No premium-specific IPC from renderer side — premium logic lives in main process.

---

## 3. Main Process (`electron/`) — Module Inventory

### Entry point (`electron/main.ts`)
- **Purpose:** App lifecycle, window creation, logging, permissions, IPC init
- **Key exports:** `AppState` class (holds window helpers, processing state, knowledge orchestrator)
- **Notable:**
  - Lazy log-file init (avoids `app.getPath()` at module load time)
  - Process error handlers (`uncaughtException`, `unhandledRejection`)
  - macOS permission checks: `ensureMacMicrophoneAccess()`, `getMacScreenCaptureStatus()`
  - Premium module loading via `require('../premium/electron/knowledge/KnowledgeOrchestrator')` with try/catch fallback
  - Windows created: Launcher, Overlay, Settings, ModelSelector, Cropper (each via helper class)

### Window helpers
| File | Creates | Dimensions/type | Key method |
|---|---|---|---|
| `WindowHelper.ts` | Launcher + Overlay | 1200×800 / 600×216 floating | `toggleOverlay()`, `moveWindow*()`, `setContentProtection()` |
| `SettingsWindowHelper.ts` | Settings | Docked or floating | `toggleWindow()`, `preloadWindow()` (off-screen preload at startup) |
| `CropperWindowHelper.ts` | Cropper | Toolbar, transparent, always-on-top | `showCropper()`, `captureSelection()`. Opacity shield for Windows DWM. Multi-monitor aware. |
| `ModelSelectorWindowHelper.ts` | ModelSelector | Positioned near settings | `showWindow()`, `preloadWindow()` |

Content protection (`window.setContentProtection(true)`) applied to launcher + overlay on macOS to block GPU-accelerated screen capture.

### IPC Handlers (`electron/ipcHandlers.ts`)

Major channel categories:

| Category | Sample channels |
|---|---|
| Window management | `update-content-dimensions`, `window-minimize/maximize/close`, `move-window-*` |
| Screenshots | `take-screenshot`, `take-selective-screenshot`, `get-screenshots`, `delete-screenshot`, `analyze-image-file` |
| LLM config | `switch-to-ollama`, `switch-to-gemini`, `test-llm-connection`, `get-current-llm-config`, `get-available-ollama-models` |
| API key setters | `set-gemini-api-key`, `set-groq-api-key`, `set-openai-api-key`, `set-claude-api-key`, `set-natively-api-key` |
| STT config | `set-stt-provider`, `get-stt-provider`, `set-{groq/openai/deepgram/elevenlabs/azure/ibmwatson/soniox}-api-key` |
| Language | `get-recognition-languages`, `set/get-stt-language`, `set/get-ai-response-language`, `get-ai-response-languages` |
| Calendar | `connect-calendar`, `get-connected-calendar`, `get-calendar-events`, `insert-calendar-event` |
| Knowledge (premium) | `knowledge:upload-document`, `knowledge:search`, `knowledge:enable/disable-knowledge-mode`, `knowledge:get-mode`, `knowledge:get-embeddings-model` |
| License (premium) | `license:activate`, `license:check-premium`, `license:get-details`, `license:deactivate`, `license:get-hardware-id` |
| Trial | `trial:start`, `trial:get-status`, `trial:get-local`, `trial:convert`, `trial:end-by-ok` |

**Premium integration seams:** wrapped in try/catch — `require('../premium/electron/services/LicenseManager')`, `require('../premium/electron/knowledge/types')` (for `DocType`). Gracefully degrades when premium files missing.

Rate limiting + credential validation built into handlers for free-tier API providers.

### LLM System (`electron/llm/`)

- **`LLMHelper.ts`** — main router. Supports Google Gemini (v1alpha), Groq, OpenAI, Anthropic Claude, Ollama (local), custom cURL providers. Methods: `sendMessage()`, `generateAnswer()`, `generateFollowUp()`, `analyzeImage()`, per-provider API key setters, `useOllama()`. Per-provider rate limiters. Can route requests to first-party Natively STT/LLM service if `nativelyKey` set.

**Mode-specific LLM classes** (one per inference task):
- `AnswerLLM.ts` — direct question answering
- `AssistLLM.ts` — general coaching
- `WhatToAnswerLLM.ts` — "what should I say next"
- `FollowUpLLM.ts` — post-call follow-up email
- `FollowUpQuestionsLLM.ts` — suggested prospect questions
- `RecapLLM.ts` — call summary + action items
- `ClarifyLLM.ts` — clarify/rephrase response
- `BrainstormLLM.ts` — brainstorm tactics
- `CodeHintLLM.ts` — legacy code analysis

Each exports a class with `generate()` or `generateStream()` method, uses `LLMHelper` internally.

**Supporting modules:**
- `prompts.ts` — system prompts for each mode (`HARD_SYSTEM_PROMPT`, `ANSWER_MODE_PROMPT`, `ASSIST_MODE_PROMPT`, etc.)
- `types.ts` — `GenerationConfig`, `GeminiContent`, `LLMClient`, `MODE_CONFIGS`
- `postProcessor.ts` — response validation, token clamping
- `transcriptCleaner.ts` — transcript cleanup for LLM input
- `TemporalContextBuilder.ts` — time-of-day, call phase, sentiment context injection
- `IntentClassifier.ts` — classify user intent to route to correct mode

### Audio System (`electron/audio/`)

**Native capture wrappers:**
- `MicrophoneCapture.ts` — Rust/napi-rs `RustMicCapture` wrapper. Eager init in constructor. Emits `data` (Buffer chunks), `speech-ended` (Rust VAD), `error`. API: `start()`, `stop()`, `getSampleRate()`, `setAudioDevice()`.
- `SystemAudioCapture.ts` — same Rust module for loopback. **Lazy init in `start()`** (not constructor) to avoid 1-sec launch mute. Sample rate detection by polling native `getSampleRate()`.
- `nativeModuleLoader.ts` — dynamic `.node` binary loading with graceful fallback to null if missing.

**STT provider implementations:**
- `DeepgramStreamingSTT.ts` (WebSocket)
- `OpenAIStreamingSTT.ts` (chunked upload, Whisper)
- `GoogleSTT.ts` (Cloud Speech-to-Text, sync + streaming)
- `ElevenLabsStreamingSTT.ts`
- `SonioxStreamingSTT.ts`
- `NativelyProSTT.ts` (first-party)
- `RestSTT.ts` (generic REST wrapper base class)

- `AudioDevices.ts` — enumerate input/loopback devices via `desktopCapturer` + system APIs. Returns `[{id, name, type: 'input'|'loopback'}, ...]`

### Intelligence & Processing (`electron/`)

- **`IntelligenceEngine.ts`** — LLM mode router. Extends `EventEmitter`. Events: `assist_update`, `suggested_answer`, `suggested_answer_token`, `refined_answer`, `recap`, `clarify`, `follow_up_questions_update`, `mode_changed`, `error`. Modes: idle, assist, what_to_say, follow_up, recap, clarify, manual, follow_up_questions, code_hint, brainstorm.
- **`IntelligenceManager.ts`** — higher-level lifecycle: `startSession()`, `stopSession()`, `processTranscript()`, `refineAnswer()`, `generateRecap()`. Integrates IntelligenceEngine + audio + STT + SessionTracker + RAG + premium KnowledgeOrchestrator.
- **`SessionTracker.ts`** — transcript segments, suggestion triggers, context items.
- **`ProcessingHelper.ts`** — lazy initialization of heavy components (LLMHelper, IntelligenceManager).

### RAG System (`electron/rag/`)

- **`RAGManager.ts`** — orchestrator. Methods: `indexTranscript()`, `retrieve()`, `setEmbeddingProvider()`, `setKnowledgeMode()`
- **`EmbeddingPipeline.ts`** — supports OpenAI text-embedding-3-small, Gemini, Ollama (local), custom. Methods: `embed()`, `embedBatch()`
- **`VectorStore.ts`** — in-memory vector DB for transcript chunks
- **`RAGRetriever.ts`** — query builder, result ranking, context assembly
- **`SemanticChunker.ts`** — semantic-aware transcript chunking (not just word count)
- **`TranscriptPreprocessor.ts`** — cleanup + token estimation
- **`EmbeddingProviderResolver.ts`** — provider factory
- **Providers** (`providers/`): `OpenAIEmbeddingProvider`, `GeminiEmbeddingProvider`, `OllamaEmbeddingProvider`, `LocalEmbeddingProvider` (ONNX offline), `IEmbeddingProvider` (interface)
- **`LiveRAGIndexer.ts`** — continuous indexing during long calls
- **`OllamaBootstrap.ts`** — auto-download/start Ollama server, pull models
- `prompts.ts`, `vectorSearchWorker.ts`

### Database (`electron/db/`)
- `DatabaseManager.ts` — SQLite persistence (meetings, transcripts, suggestions, follow-ups). Uses `better-sqlite3`.
- `seedDemo.ts`, `test-db.ts` — dev helpers

### Services (`electron/services/`)
- **`SettingsManager.ts`** — non-sensitive settings persistence (undetectable, verbose logging, action button mode, knowledge mode). JSON file in userData.
- **`CredentialsManager.ts`** — secure API key storage via Electron `safeStorage`. One getter/setter per provider. Stores: Gemini/Groq/OpenAI/Claude/Natively API keys, STT provider keys, Google service account path, trial token + expiry, embedding provider key (Tavily).
- **`KeybindManager.ts`** — global hotkey registration (OS-level). Examples: Cmd+B (macOS) / Ctrl+Shift+B (Windows) toggle overlay, Cmd+Shift+S selective screenshot, voice activation via audio level detection.
- **`OllamaManager.ts`** — local Ollama server lifecycle, `startServer()`, `pullModel()`, `isRunning()`. Communicates with default `localhost:11434`.
- **`ModelVersionManager.ts`** — self-improving vision model version tracking.
- **`RateLimiter.ts`** — per-provider request rate limiting. Groq free: 30/min, OpenAI free: 3/min.
- **`CalendarManager.ts`** — Google Calendar OAuth 2.0 integration. Stores refresh token in `CredentialsManager`.
- **`InstallPingManager.ts`** — anonymous install telemetry (first run, version, platform).

### Update system (`electron/update/`)
- `ReleaseNotesManager.ts` — fetch/parse release notes from GitHub Releases. Disk cache.

### Utilities (`electron/utils/`)
- `curlUtils.ts` — parse/execute cURL for custom LLM providers (using `@bany/curl-to-json`)
- `emailUtils.ts` — follow-up email formatting
- `modelFetcher.ts` — fetch available models from each provider API

### Other root-level
- `verboseLog.ts` — gated logging
- `DonationManager.ts`, `MeetingPersistence.ts`, `ScreenshotHelper.ts`, `ThemeManager.ts`
- `preload.ts` — **critical** — exposes `window.electronAPI` to renderer

---

## 4. Cross-Cutting Concerns

### Preload script (`electron/preload.ts`) — `window.electronAPI` surface

**Window management:** `windowMinimize/Maximize/Close()`, `windowIsMaximized()`, `moveWindowLeft/Right/Up/Down()`, `toggleWindow()`, `showOverlay()`, `hideOverlay()`, `getMeetingActive()`, `onMeetingStateChanged(callback)`

**Screenshot/image:** `takeScreenshot()`, `takeSelectiveScreenshot()`, `getScreenshots()`, `deleteScreenshot(path)`, `onScreenshotTaken/Attached/CaptureAndProcess(callback)`, `analyzeImageFile(path)`

**LLM/model:** `getCurrentLlmConfig()`, `switchToOllama()`, `switchToGemini()`, `testLlmConnection()`, `getAvailableOllamaModels()`, `selectServiceAccount()`

**API keys:** per-provider setters + `getStoredCredentials()` (returns which keys stored, not keys themselves)

**STT:** `setSttProvider/getSttProvider()`, `setSttLanguage/getSttLanguage()`, `setAiResponseLanguage/getAiResponseLanguage()`, `getRecognitionLanguages()`, `getAiResponseLanguages()`

**Trial/license:** `startTrial()`, `getTrialStatus()`, `getLocalTrial()`, `convertTrial(choice)`, `endTrialByok()`, `onTrialEnded(callback)`, `license:activate/check-premium/get-details/deactivate/get-hardware-id`

**Knowledge (premium):** `knowledge:upload-document(type, path)`, `knowledge:search(query, limit)`, `knowledge:enable/disable-knowledge-mode()`, `knowledge:get-mode()`

**Natively API:** `getNativelyUsage()` (quota)

**Calendar:** `connectCalendar()`, `getConnectedCalendar()`, `getCalendarEvents(start, end)`, `insertCalendarEvent(summary, start, end, desc)`

**Overlay/UI:** `updateContentDimensions({w, h})`, `onToggleExpand(cb)`, `setUndetectable(state)`, `getUndetectable()`, `onUndetectableChanged(cb)`, `setOverlayMousePassthrough(enabled)`, `toggleOverlayMousePassthrough()`, `getOverlayMousePassthrough()`, `onOverlayMousePassthroughChanged(cb)`, `openExternal(url)`

**Misc:** `quitApp()`, `onWindowMaximizedChanged(cb)`, `onEnsureExpanded(cb)`, `platform`, `getThemeMode()`, `onThemeChanged(cb)`

### Hotkey / keybind infrastructure
- Global OS-level hotkeys via `electron.globalShortcut` (or native hooks for low-latency)
- Examples: Cmd+B (macOS) / Ctrl+Shift+B (Windows) — toggle overlay; Cmd+Shift+S — selective screenshot; voice activation via audio level detection
- `KeybindManager` in `electron/services/`, bindings applied in `main.ts` at startup
- Renderer-side `useShortcuts` hook for display via `KeyBadge` component

### Content protection & undetectable mode
- `window.setContentProtection(true)` on launcher + overlay (macOS only)
- **Undetectable/disguise mode:** hides window from screen recording software (OBS, Zoom share detection). Techniques: toolbar window type, z-order manipulation, transparent chrome, optional GDI/CGWindow API bypass. Setting in `SettingsManager.isUndetectable`, synced via `getUndetectable()` + `onUndetectableChanged()`. UI in `SettingsOverlay` dropdown: options [None, Terminal, Settings, Activity].

### Window layering tricks
- Launcher — standard dockable
- Overlay — `alwaysOnTop: true`, transparent to clicks when passthrough enabled (`setIgnoreMouseEvents(true)`). Floats above Zoom/Meet.
- Cropper — toolbar-type, full-screen overlay
- Settings/ModelSelector — parented to main window

### Native module dependencies
- **Custom Rust/napi-rs** at `native-module/` — low-latency PCM audio capture with built-in VAD. Compiled for macOS arm64 + x86_64 and Windows x64. Loaded via `nativeModuleLoader.ts`.
- **System audio capture** — same Rust module, uses macOS CoreAudio or Windows WASAPI. May require Audio Loopback Adapter on Windows.

### Licensing & premium seams
- `electron/premium/featureGate.ts` — `isPremiumAvailable()` probes for premium modules at runtime
- Pattern: `try { require('../premium/...') } catch { /* null fallback */ }`
- Flow: renderer → `license:check-premium` IPC → `CredentialsManager` + premium `LicenseManager`
- Trial: `CredentialsManager.getTrialToken()` + expiry date
- Async check: `license:check-premium-async` — Dodo server revocation check with cached fallback

### Analytics
- `analytics.service.ts` (singleton). Events: appOpen, appClose, assistantStart/Stop, solutionRequested/Succeeded/Failed, provider detected. No PII. Disabled in dev.

### Logging
- **Main:** log file at `~/Documents/natively_debug.log`, rotated at 10MB. Process-level error handlers.
- **Renderer:** `ErrorBoundary` catches React errors. DevTools in dev, main-process forwarding in prod.

---

## Summary

Well-structured multi-window Electron overlay app with:
- 9 specialized LLM classes for different coaching modes
- 4+ LLM providers (Gemini/Groq/OpenAI/Claude) + local Ollama + custom cURL
- Native Rust audio capture with VAD
- 7+ STT provider integrations
- RAG layer for transcript-aware retrieval
- Graceful optional premium module loading
- Electron `safeStorage` for secrets
- macOS content protection + disguise mode
- 50+ IPC channels

Clear separation of concerns, well-isolated premium seams, extensive logging. **Rebuild-friendly.**
