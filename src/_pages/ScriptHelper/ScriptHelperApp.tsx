import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, ClipboardPaste, FileText } from 'lucide-react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import {
    getOverlayAppearance,
    clampOverlayOpacity,
    OVERLAY_OPACITY_DEFAULT,
    getDefaultOverlayOpacity
} from '../../lib/overlayAppearance';
import DossierView, { Dossier } from '../../components/DossierView';

const ScriptHelperApp: React.FC = () => {
    const [dossier, setDossier] = useState<Dossier | null>(null);
    const [showPaste, setShowPaste] = useState(false);
    const [pasteText, setPasteText] = useState('');
    const [pasteError, setPasteError] = useState<string | null>(null);

    // Theme + opacity — mirror the same source-of-truth the main overlay uses
    // so this window respects the existing Theme + Interface Opacity settings.
    const resolvedTheme = useResolvedTheme();
    const isLight = resolvedTheme === 'light';

    const [overlayOpacity, setOverlayOpacity] = useState<number>(() => {
        const stored = localStorage.getItem('natively_overlay_opacity');
        const parsed = stored ? parseFloat(stored) : NaN;
        const isUserSet = Number.isFinite(parsed) && parsed !== OVERLAY_OPACITY_DEFAULT;
        return isUserSet ? clampOverlayOpacity(parsed) : getDefaultOverlayOpacity();
    });

    // Live-update opacity when changed in Settings
    useEffect(() => {
        const unsubscribe = window.electronAPI?.onOverlayOpacityChanged?.((next) => {
            setOverlayOpacity(clampOverlayOpacity(next));
        });
        return () => unsubscribe?.();
    }, []);

    const appearance = useMemo(
        () => getOverlayAppearance(overlayOpacity, isLight ? 'light' : 'dark'),
        [overlayOpacity, isLight]
    );

    // On mount, fetch any pre-loaded dossier (set in main process before window opened)
    useEffect(() => {
        let mounted = true;
        window.electronAPI?.scriptHelperGetDossier?.()
            .then((data) => {
                if (mounted && data) setDossier(data);
            })
            .catch(() => {});

        // Listen for dossier-loaded broadcasts (e.g., from a Prepare click while window is open)
        const unsubscribe = window.electronAPI?.onScriptHelperDossierLoaded?.((data) => {
            if (mounted) {
                setDossier(data);
                setShowPaste(false);
                setPasteText('');
                setPasteError(null);
            }
        });

        return () => {
            mounted = false;
            unsubscribe?.();
        };
    }, []);

    const handleClose = useCallback(() => {
        window.electronAPI?.scriptHelperClose?.();
    }, []);

    const handlePasteSubmit = useCallback(async () => {
        setPasteError(null);
        if (!pasteText.trim()) {
            setPasteError('Paste a JSON dossier first.');
            return;
        }
        const result = await window.electronAPI?.scriptHelperPasteDossier?.(pasteText);
        if (result?.success) {
            setShowPaste(false);
            setPasteText('');
        } else {
            setPasteError(result?.error || 'Could not parse JSON.');
        }
    }, [pasteText]);

    const hasContent =
        dossier &&
        (dossier.prospect ||
            dossier.pain_points?.length ||
            dossier.script?.length ||
            dossier.talking_points?.length ||
            dossier.previous_meeting_summary);

    return (
        <div
            className="h-screen w-screen flex flex-col overflow-hidden overlay-text-primary"
            style={{
                ...appearance.shellStyle,
                borderRadius: 14,
                borderWidth: 1,
                borderStyle: 'solid'
            }}
        >
            {/* Title bar — draggable */}
            <div
                className="flex items-center justify-between px-4 py-3"
                style={{
                    borderBottomWidth: 1,
                    borderBottomStyle: 'solid',
                    borderBottomColor: appearance.dividerStyle.borderColor as string,
                    ['-webkit-app-region' as any]: 'drag'
                }}
            >
                <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-[12px] font-semibold tracking-wide uppercase overlay-text-primary">
                        Script Helper
                    </span>
                </div>
                <div className="flex items-center gap-1" style={{ ['-webkit-app-region' as any]: 'no-drag' }}>
                    <button
                        onClick={() => setShowPaste((v) => !v)}
                        title="Paste a dossier JSON"
                        className="w-7 h-7 flex items-center justify-center rounded-md overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive interaction-base interaction-press"
                        style={appearance.iconStyle}
                    >
                        <ClipboardPaste className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={handleClose}
                        title="Close"
                        className="w-7 h-7 flex items-center justify-center rounded-md overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive interaction-base interaction-press"
                        style={appearance.iconStyle}
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {showPaste && (
                    <div
                        className="rounded-lg p-3 space-y-2 border"
                        style={appearance.subtleStyle}
                    >
                        <div className="text-[11px] uppercase tracking-wide overlay-text-muted">
                            Paste dossier JSON
                        </div>
                        <textarea
                            value={pasteText}
                            onChange={(e) => setPasteText(e.target.value)}
                            placeholder='{"prospect": {...}, "pain_points": [...], "script": [...]}'
                            className="w-full h-40 rounded p-2 text-[11px] font-mono overlay-input-text border focus:outline-none"
                            style={appearance.inputStyle}
                        />
                        {pasteError && (
                            <div className="text-[11px] text-red-400">{pasteError}</div>
                        )}
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => {
                                    setShowPaste(false);
                                    setPasteError(null);
                                }}
                                className="px-3 py-1.5 rounded text-[11px] overlay-text-muted hover:overlay-text-primary"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handlePasteSubmit}
                                className="px-3 py-1.5 rounded text-[11px] font-medium bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30"
                            >
                                Load
                            </button>
                        </div>
                    </div>
                )}

                {!hasContent && !showPaste && (
                    <div className="flex flex-col items-center justify-center text-center py-12 px-4 space-y-3">
                        <FileText className="w-8 h-8 overlay-text-muted opacity-60" />
                        <div className="text-[13px] font-medium overlay-text-primary">No dossier loaded</div>
                        <div className="text-[11px] overlay-text-muted leading-relaxed max-w-[280px]">
                            Drop a dossier JSON for this event into <code className="text-[10px] overlay-text-interactive">~/.../natively/prep/</code>
                            and click Prepare on the matching event in the Launcher — or paste one directly.
                        </div>
                        <button
                            onClick={() => setShowPaste(true)}
                            className="mt-2 px-4 py-2 rounded-md text-[11px] font-medium overlay-chip-surface overlay-text-interactive border interaction-base interaction-press"
                            style={appearance.chipStyle}
                        >
                            Paste Dossier
                        </button>
                    </div>
                )}

                {hasContent && dossier && (
                    <DossierView dossier={dossier} variant="overlay" />
                )}
            </div>
        </div>
    );
};

export default ScriptHelperApp;
