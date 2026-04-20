import React, { useEffect, useState, useCallback } from 'react';
import { X, Plus, Trash2, Check, FileText, Upload } from 'lucide-react';

type TemplateType = 'general' | 'technical-interview' | 'sales' | 'recruiting' | 'team-meet' | 'looking-for-work' | 'lecture';

interface Mode {
    id: string;
    name: string;
    templateType: TemplateType;
    customContext: string;
    isActive: boolean;
    createdAt: string;
    referenceFileCount?: number;
}

interface ReferenceFile {
    id: string;
    modeId: string;
    fileName: string;
    content: string;
    createdAt: string;
}

interface Props {
    onClose: () => void;
    isPremium: boolean;
    isLoaded: boolean;
    isTrialActive: boolean;
    onOpenNativelyAPI: () => void;
}

const TEMPLATE_OPTIONS: Array<{ value: TemplateType; label: string; desc: string }> = [
    { value: 'sales',              label: 'Sales',              desc: 'Real-time sales co-pilot (use for Scalable or Matria calls)' },
    { value: 'recruiting',         label: 'Recruiting',         desc: 'Interview evaluation helper' },
    { value: 'team-meet',          label: 'Team Meeting',       desc: 'Action-item focused internal meeting notes' },
    { value: 'lecture',            label: 'Training / Lecture', desc: 'Optimized note-taking for learning sessions' },
    { value: 'general',            label: 'General',            desc: 'Universal adaptive copilot' },
    { value: 'looking-for-work',   label: 'Looking for Work',   desc: 'Candidate-side interview prep' },
    { value: 'technical-interview',label: 'Technical Interview',desc: 'Tech screen answer assistance' },
];

const templateLabel = (t: TemplateType): string =>
    TEMPLATE_OPTIONS.find(o => o.value === t)?.label ?? t;

const ModesSettings: React.FC<Props> = ({ onClose }) => {
    const [modes, setModes] = useState<Mode[]>([]);
    const [selected, setSelected] = useState<Mode | null>(null);
    const [refFiles, setRefFiles] = useState<ReferenceFile[]>([]);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [newTemplate, setNewTemplate] = useState<TemplateType>('sales');
    const [saving, setSaving] = useState(false);

    const api: any = (window as any).electronAPI;

    const reload = useCallback(async () => {
        const all = await api.modesGetAll();
        setModes(all);
        if (selected) {
            const updated = all.find((m: Mode) => m.id === selected.id);
            if (updated) setSelected(updated); else setSelected(null);
        }
    }, [api, selected]);

    useEffect(() => { reload(); }, []);

    useEffect(() => {
        if (!selected) { setRefFiles([]); return; }
        api.modesGetReferenceFiles(selected.id).then(setRefFiles);
    }, [selected?.id]);

    const activate = async (id: string | null) => {
        await api.modesSetActive(id);
        await reload();
    };

    const handleCreate = async () => {
        if (!newName.trim()) return;
        setSaving(true);
        const res = await api.modesCreate({ name: newName.trim(), templateType: newTemplate });
        setSaving(false);
        if (res.success) {
            setNewName(''); setCreating(false);
            await reload();
            if (res.mode) setSelected(res.mode);
        } else {
            alert('Could not create mode: ' + (res.error ?? 'unknown'));
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this mode? Reference files attached will also be removed.')) return;
        await api.modesDelete(id);
        if (selected?.id === id) setSelected(null);
        await reload();
    };

    const saveContext = async (mode: Mode, customContext: string) => {
        await api.modesUpdate(mode.id, { customContext });
    };

    const saveName = async (mode: Mode, name: string) => {
        await api.modesUpdate(mode.id, { name });
        await reload();
    };

    const uploadFile = async () => {
        if (!selected) return;
        const res = await api.modesUploadReferenceFile(selected.id);
        if (res.success) {
            const files = await api.modesGetReferenceFiles(selected.id);
            setRefFiles(files);
            await reload();
        } else if (!res.cancelled) {
            alert('Upload failed: ' + (res.error ?? 'unknown'));
        }
    };

    const deleteFile = async (id: string) => {
        await api.modesDeleteReferenceFile(id);
        if (selected) setRefFiles(await api.modesGetReferenceFiles(selected.id));
        await reload();
    };

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="w-[960px] h-[640px] bg-[#1a1a1c] border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                    <div>
                        <div className="text-[15px] font-semibold text-white">Modes</div>
                        <div className="text-[12px] text-white/50">Tailor Natively for different meeting contexts</div>
                    </div>
                    <button onClick={onClose} className="p-1 text-white/60 hover:text-white">
                        <X size={18} />
                    </button>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    <div className="w-[300px] border-r border-white/10 flex flex-col overflow-hidden">
                        <div className="px-4 pt-4 pb-2">
                            {!creating ? (
                                <button
                                    onClick={() => setCreating(true)}
                                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[13px] text-white bg-white/10 hover:bg-white/15 rounded-md transition">
                                    <Plus size={14} /> New Mode
                                </button>
                            ) : (
                                <div className="space-y-2 p-3 bg-white/5 border border-white/10 rounded-md">
                                    <input
                                        autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                                        placeholder="Mode name (e.g. Scalable Sales)"
                                        className="w-full px-2 py-1.5 text-[13px] bg-black/40 border border-white/10 rounded text-white placeholder-white/40" />
                                    <select
                                        value={newTemplate} onChange={e => setNewTemplate(e.target.value as TemplateType)}
                                        className="w-full px-2 py-1.5 text-[12px] bg-black/40 border border-white/10 rounded text-white">
                                        {TEMPLATE_OPTIONS.map(o => (
                                            <option key={o.value} value={o.value}>{o.label}</option>
                                        ))}
                                    </select>
                                    <div className="text-[11px] text-white/50">
                                        {TEMPLATE_OPTIONS.find(o => o.value === newTemplate)?.desc}
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            disabled={saving || !newName.trim()}
                                            onClick={handleCreate}
                                            className="flex-1 px-2 py-1.5 text-[12px] bg-white text-black rounded hover:bg-white/90 disabled:opacity-40">
                                            Create
                                        </button>
                                        <button
                                            onClick={() => { setCreating(false); setNewName(''); }}
                                            className="px-3 py-1.5 text-[12px] text-white/70 hover:text-white">
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
                            {modes.length === 0 && (
                                <div className="px-3 py-6 text-center text-[12px] text-white/40">No modes yet</div>
                            )}
                            {modes.map(m => (
                                <button
                                    key={m.id} onClick={() => setSelected(m)}
                                    className={`w-full text-left px-3 py-2 rounded-md transition ${selected?.id === m.id ? 'bg-white/10' : 'hover:bg-white/5'}`}>
                                    <div className="flex items-center gap-2">
                                        {m.isActive && <Check size={12} className="text-green-400 flex-shrink-0" />}
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[13px] text-white truncate">{m.name}</div>
                                            <div className="text-[11px] text-white/50">{templateLabel(m.templateType)}</div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {!selected ? (
                            <div className="h-full flex items-center justify-center text-[13px] text-white/40 p-10 text-center">
                                Pick a mode from the left — or create one — to edit its Custom Context and reference files.
                            </div>
                        ) : (
                            <div className="p-6 space-y-6">
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <input
                                            defaultValue={selected.name}
                                            onBlur={e => saveName(selected, e.target.value)}
                                            className="text-[18px] font-semibold text-white bg-transparent border-b border-transparent hover:border-white/20 focus:border-white/40 w-full py-1 outline-none" />
                                        <div className="text-[12px] text-white/50 mt-1">Template: {templateLabel(selected.templateType)}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {selected.isActive ? (
                                            <button
                                                onClick={() => activate(null)}
                                                className="px-3 py-1.5 text-[12px] bg-green-500/20 text-green-300 border border-green-500/30 rounded hover:bg-green-500/30">
                                                Active — click to deactivate
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => activate(selected.id)}
                                                className="px-3 py-1.5 text-[12px] bg-white text-black rounded hover:bg-white/90">
                                                Set Active
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleDelete(selected.id)}
                                            className="p-1.5 text-white/40 hover:text-red-400">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <div className="text-[12px] font-medium text-white/80 mb-2">Custom Context</div>
                                    <div className="text-[11px] text-white/50 mb-2">
                                        Context injected into every AI response in this mode. Example: "Selling Scalable Elite ($33k/yr) to 7-figure service business owners. Discovery: revops/sales bottlenecks…"
                                    </div>
                                    <textarea
                                        defaultValue={selected.customContext}
                                        onBlur={e => saveContext(selected, e.target.value)}
                                        placeholder="Add company, offer, positioning, or any persistent context…"
                                        rows={10}
                                        className="w-full px-3 py-2 text-[13px] bg-black/40 border border-white/10 rounded-md text-white placeholder-white/30 outline-none focus:border-white/30" />
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="text-[12px] font-medium text-white/80">Reference Files</div>
                                        <button
                                            onClick={uploadFile}
                                            className="flex items-center gap-1 px-2 py-1 text-[12px] bg-white/10 hover:bg-white/15 text-white rounded">
                                            <Upload size={12} /> Upload PDF / DOCX / TXT
                                        </button>
                                    </div>
                                    {refFiles.length === 0 ? (
                                        <div className="text-[11px] text-white/40 py-2">No reference files attached.</div>
                                    ) : (
                                        <div className="space-y-1">
                                            {refFiles.map(f => (
                                                <div key={f.id} className="flex items-center gap-2 px-2 py-1.5 bg-white/5 border border-white/10 rounded">
                                                    <FileText size={12} className="text-white/60 flex-shrink-0" />
                                                    <div className="flex-1 text-[12px] text-white truncate">{f.fileName}</div>
                                                    <div className="text-[11px] text-white/40">{f.content.length.toLocaleString()} chars</div>
                                                    <button
                                                        onClick={() => deleteFile(f.id)}
                                                        className="p-1 text-white/40 hover:text-red-400">
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ModesSettings;
