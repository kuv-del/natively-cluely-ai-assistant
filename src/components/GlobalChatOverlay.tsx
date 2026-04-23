import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStreamBuffer } from '../hooks/useStreamBuffer';
import { X, Copy, Check, Globe, ArrowUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import nativelyIcon from './icon.png';

// ============================================
// Types
// ============================================

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    isStreaming?: boolean;
}

interface GlobalChatOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    initialQuery?: string;
}

// ============================================
// Typing Indicator Component
// ============================================

const TypingIndicator: React.FC = () => (
    <div className="flex items-center gap-1 py-4">
        <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
                <motion.div
                    key={i}
                    className="w-2 h-2 rounded-full bg-text-tertiary"
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{
                        duration: 0.6,
                        repeat: Infinity,
                        delay: i * 0.15,
                        ease: "easeInOut"
                    }}
                />
            ))}
        </div>
    </div>
);

// ============================================
// Message Components
// ============================================

const UserMessage: React.FC<{ content: string }> = ({ content }) => (
    <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="flex justify-end mb-6"
    >
        <div className="bg-[#2C2C2E] text-white px-5 py-3 rounded-2xl rounded-tr-md max-w-[70%] text-[15px] leading-relaxed">
            {content}
        </div>
    </motion.div>
);

const AssistantMessage: React.FC<{ content: string; isStreaming?: boolean; model?: string }> = ({ content, isStreaming, model }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col items-start mb-6"
        >
            <div className="text-text-primary text-[15px] leading-relaxed max-w-[85%]">
                {content}
                {isStreaming && (
                    <motion.span
                        className="inline-block w-0.5 h-4 bg-text-secondary ml-0.5 align-middle"
                        animate={{ opacity: [1, 0] }}
                        transition={{ duration: 0.5, repeat: Infinity }}
                    />
                )}
            </div>
            {!isStreaming && content && (
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-2 mt-3 text-[13px] text-text-tertiary hover:text-text-secondary transition-colors"
                >
                    {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy message'}
                </button>
            )}
            {!isStreaming && model && (
                <div className="mt-1 text-[10px] text-text-tertiary/50 font-mono uppercase tracking-wide">
                    {model}
                </div>
            )}
        </motion.div>
    );
};

// ============================================
// Main Component
// ============================================

type ChatState = 'idle' | 'waiting_for_llm' | 'streaming_response' | 'error';

const GlobalChatOverlay: React.FC<GlobalChatOverlayProps> = ({
    isOpen,
    onClose,
    initialQuery = ''
}) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [chatState, setChatState] = useState<ChatState>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const streamBuffer = useStreamBuffer();
    const [conversationHistory, setConversationHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [activeModel, setActiveModel] = useState<string | null>(null);
    const [modelBadgeId, setModelBadgeId] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const chatWindowRef = useRef<HTMLDivElement>(null);

    // Submit initial query when overlay opens
    useEffect(() => {
        if (isOpen && initialQuery && messages.length === 0) {
            setTimeout(() => {
                submitQuestion(initialQuery);
            }, 100);
        }
    }, [isOpen, initialQuery]);

    // Listen for new queries from parent
    useEffect(() => {
        if (isOpen && initialQuery && messages.length > 0) {
            // This is a follow-up query
            submitQuestion(initialQuery);
        }
    }, [initialQuery]);

    // ESC key handler
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // Click outside handler
    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    }, [onClose]);

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && query.trim()) {
            e.preventDefault();
            submitQuestion(query);
            setQuery('');
        }
    };

    // Submit question using GoBot /ask as primary, RAG as fallback
    const submitQuestion = useCallback(async (question: string) => {
        if (!question.trim() || chatState === 'waiting_for_llm' || chatState === 'streaming_response') return;

        const userMessage: Message = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: question
        };
        setMessages(prev => [...prev, userMessage]);
        setChatState('waiting_for_llm');
        setErrorMessage(null);
        setStatusMessage('Connecting to GoBot...');
        setActiveModel(null);

        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);

        const assistantMessageId = `assistant-${Date.now()}`;

        try {
            await new Promise(resolve => setTimeout(resolve, 200));

            setMessages(prev => [...prev, {
                id: assistantMessageId,
                role: 'assistant',
                content: '',
                isStreaming: true
            }]);

            streamBuffer.reset();

            // Register GoBot event listeners
            const chunkCleanup = (window.electronAPI as any)?.onGobotChunk((data: any) => {
                setChatState('streaming_response');
                setStatusMessage(null);
                streamBuffer.appendToken(data.chunk, (content) => {
                    setMessages(prev => prev.map(msg =>
                        msg.id === assistantMessageId ? { ...msg, content } : msg
                    ));
                });
            });

            const statusCleanup = (window.electronAPI as any)?.onGobotStatus((data: any) => {
                setStatusMessage(data.message);
            });

            const toolCleanup = (window.electronAPI as any)?.onGobotTool((data: any) => {
                if (data.status === 'running') {
                    setStatusMessage(`Using ${data.name.replace(/_/g, ' ')}…`);
                } else if (data.status === 'done') {
                    setStatusMessage(null);
                }
            });

            const doneCleanup = (window.electronAPI as any)?.onGobotDone((data: any) => {
                const finalContent = streamBuffer.getBufferedContent();
                setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessageId
                        ? { ...msg, content: finalContent, isStreaming: false }
                        : msg
                ));
                setConversationHistory(prev => [
                    ...prev,
                    { role: 'user', content: question },
                    { role: 'assistant', content: finalContent }
                ]);
                setActiveModel(data.model);
                setModelBadgeId(assistantMessageId);
                setChatState('idle');
                setStatusMessage(null);
                streamBuffer.reset();
                chunkCleanup?.();
                statusCleanup?.();
                toolCleanup?.();
                doneCleanup?.();
                errorCleanup?.();
                setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
            });

            const errorCleanup = (window.electronAPI as any)?.onGobotError((data: any) => {
                setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
                setErrorMessage(data.error);
                setChatState('error');
                setStatusMessage(null);
                streamBuffer.reset();
                chunkCleanup?.();
                statusCleanup?.();
                toolCleanup?.();
                doneCleanup?.();
                errorCleanup?.();
            });

            const result = await (window.electronAPI as any)?.gobotQuery({
                query: question,
                conversationHistory,
            });

            // If GoBot unreachable, fall back to local RAG
            if (!result?.success) {
                chunkCleanup?.();
                statusCleanup?.();
                toolCleanup?.();
                doneCleanup?.();
                errorCleanup?.();
                setStatusMessage('Searching meetings...');

                streamBuffer.reset();
                const ragChunkCleanup = window.electronAPI?.onRAGStreamChunk((data: { chunk: string }) => {
                    setChatState('streaming_response');
                    setStatusMessage(null);
                    streamBuffer.appendToken(data.chunk, (content) => {
                        setMessages(prev => prev.map(msg =>
                            msg.id === assistantMessageId ? { ...msg, content } : msg
                        ));
                    });
                });
                const ragDoneCleanup = window.electronAPI?.onRAGStreamComplete(() => {
                    const finalContent = streamBuffer.getBufferedContent();
                    setMessages(prev => prev.map(msg =>
                        msg.id === assistantMessageId
                            ? { ...msg, content: finalContent, isStreaming: false }
                            : msg
                    ));
                    setChatState('idle');
                    setStatusMessage(null);
                    streamBuffer.reset();
                    ragChunkCleanup?.();
                    ragDoneCleanup?.();
                    ragErrorCleanup?.();
                });
                const ragErrorCleanup = window.electronAPI?.onRAGStreamError(() => {
                    setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
                    setErrorMessage("GoBot unavailable and meetings search failed. Please try again.");
                    setChatState('error');
                    setStatusMessage(null);
                    streamBuffer.reset();
                    ragChunkCleanup?.();
                    ragDoneCleanup?.();
                    ragErrorCleanup?.();
                });
                await window.electronAPI?.ragQueryGlobal(question);
            }

        } catch (error) {
            console.error('[GlobalChat] Error:', error);
            setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
            setErrorMessage("Something went wrong. Please try again.");
            setChatState('error');
            setStatusMessage(null);
        }
    }, [chatState, conversationHistory]);

    return (
        <AnimatePresence
            onExitComplete={() => {
                setChatState('idle');
                setMessages([]);
                setErrorMessage(null);
                setConversationHistory([]);
                setStatusMessage(null);
                setActiveModel(null);
                setModelBadgeId(null);
            }}
        >
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}
                    className="absolute inset-0 z-40 flex flex-col justify-end"
                    onClick={handleBackdropClick}
                >
                    {/* Backdrop with blur */}
                    <motion.div
                        initial={{ backdropFilter: 'blur(0px)' }}
                        animate={{ backdropFilter: 'blur(8px)' }}
                        exit={{ backdropFilter: 'blur(0px)' }}
                        transition={{ duration: 0.16 }}
                        className="absolute inset-0 bg-black/40"
                    />

                    {/* Chat Window */}
                    <motion.div
                        ref={chatWindowRef}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "85vh", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{
                            height: { type: "spring", stiffness: 300, damping: 30, mass: 0.8 },
                            opacity: { duration: 0.2 }
                        }}
                        className="relative mx-auto w-full max-w-[680px] mb-0 bg-bg-secondary rounded-t-[24px] border-t border-x border-border-subtle shadow-2xl overflow-hidden flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
                            <div className="flex items-center gap-2 text-text-tertiary">
                                <img src={nativelyIcon} className="w-3.5 h-3.5 force-black-icon opacity-50" alt="logo" />
                                <span className="text-[13px] font-medium">Ask anything</span>
                                {statusMessage && (
                                    <span className="text-[11px] text-text-tertiary italic ml-2 animate-pulse">{statusMessage}</span>
                                )}
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 transition-colors group"
                            >
                                <X size={16} className="text-text-tertiary group-hover:text-red-500 group-hover:drop-shadow-[0_0_8px_rgba(239,68,68,0.5)] transition-all duration-300" />
                            </button>
                        </div>

                        {/* Messages area - scrollable */}
                        <div className="flex-1 overflow-y-auto px-6 py-4 pb-32 custom-scrollbar">
                            {messages.map((msg) => (
                                msg.role === 'user'
                                    ? <UserMessage key={msg.id} content={msg.content} />
                                    : <AssistantMessage
                                        key={msg.id}
                                        content={msg.content}
                                        isStreaming={msg.isStreaming}
                                        model={msg.id === modelBadgeId ? activeModel ?? undefined : undefined}
                                      />
                            ))}

                            {chatState === 'waiting_for_llm' && <TypingIndicator />}

                            {errorMessage && (
                                <motion.div
                                    initial={{ opacity: 0, y: 4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="text-[#FF6B6B] text-[13px] py-2"
                                >
                                    {errorMessage}
                                </motion.div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>

                        {/* Floating Footer (Ask Bar) */}
                        <div className="absolute bottom-0 left-0 right-0 p-6 flex justify-center z-50 pointer-events-none">
                            <div className="w-full max-w-[440px] relative group pointer-events-auto">
                                {/* Dark Glass Effect Input */}
                                <input
                                    type="text"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    onKeyDown={handleInputKeyDown}
                                    placeholder="Ask me anything..."
                                    className="w-full pl-5 pr-12 py-3 bg-bg-elevated shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-border-muted rounded-full text-sm text-text-primary placeholder-text-tertiary/70 focus:outline-none transition-all"
                                />
                                <button
                                    onClick={() => {
                                        if (query.trim()) {
                                            submitQuestion(query);
                                            setQuery('');
                                        }
                                    }}
                                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full transition-all duration-200 border border-white/5 ${query.trim() ? 'bg-text-primary text-bg-primary hover:scale-105' : 'bg-bg-item-active text-text-primary hover:bg-bg-item-hover'
                                        }`}
                                >
                                    <ArrowUp size={16} className="transform rotate-45" />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default GlobalChatOverlay;
