"use client";

import { API_BASE } from "@/lib/api";
import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import {
  Brain,
  ChevronDown,
  ChevronUp,
  X,
  Send,
  Loader2,
  Wrench,
  Check,
  Trash2,
  Sparkles,
  Key,
  Settings,
  Eye,
  EyeOff,
} from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  tools?: ToolEvent[];
  timestamp?: string;
}

interface ToolEvent {
  tool: string;
  input?: string;
  summary?: string;
  status: "running" | "done";
}

const SUGGESTED_PROMPTS = [
  "Investigate username 'johndoe' across all platforms",
  "Analyze domain example.com — WHOIS, DNS, subdomains",
  "What military flights are active right now?",
  "Generate a dossier on the Mexico security situation",
  "Search for recent news about cybersecurity breaches",
  "Find all ships near the Gulf of Mexico",
];

const InvestigationPanel = React.memo(function InvestigationPanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [agentAvailable, setAgentAvailable] = useState<boolean | null>(null);
  const [activeTools, setActiveTools] = useState<ToolEvent[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Config state
  const [showConfig, setShowConfig] = useState(false);
  const [configKey, setConfigKey] = useState("");
  const [configModel, setConfigModel] = useState("");
  const [configProvider, setConfigProvider] = useState("openrouter");
  const [configSaving, setConfigSaving] = useState(false);
  const [keyPreview, setKeyPreview] = useState("");
  const [showKey, setShowKey] = useState(false);

  // Check agent availability on mount
  useEffect(() => {
    if (!isOpen) return;
    fetch(`${API_BASE}/api/agent/status`)
      .then((r) => r.json())
      .then((d) => {
        setAgentAvailable(d.available);
        if (d.provider) setConfigProvider(d.provider);
        if (d.model) setConfigModel(d.model);
        if (d.key_preview) setKeyPreview(d.key_preview);
        // Auto-show config if no key
        if (!d.available) setShowConfig(true);
      })
      .catch(() => setAgentAvailable(false));
  }, [isOpen]);

  const handleSaveConfig = useCallback(async () => {
    setConfigSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/agent/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: configKey,
          model: configModel,
          provider: configProvider,
        }),
      });
      const data = await res.json();
      setAgentAvailable(data.configured);
      if (data.configured) {
        setShowConfig(false);
        setConfigKey("");
        setKeyPreview(configKey ? `${configKey.slice(0, 8)}...${configKey.slice(-4)}` : "");
        // Clear session since agent was reconfigured
        setMessages([]);
        setSessionId("");
      }
    } catch {
      // silently fail
    }
    setConfigSaving(false);
  }, [configKey, configModel, configProvider]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeTools]);

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    if (!msg || streaming) return;
    setInput("");
    setStreaming(true);
    setActiveTools([]);

    // Add user message
    setMessages((prev) => [...prev, { role: "user", content: msg, timestamp: new Date().toISOString() }]);

    // Add placeholder for assistant
    setMessages((prev) => [...prev, { role: "assistant", content: "", tools: [], timestamp: new Date().toISOString() }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${API_BASE}/api/agent/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message: msg }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Unknown error" }));
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: `**Error:** ${err.error || response.statusText}`,
          };
          return updated;
        });
        setStreaming(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);
              handleSSEEvent(eventType, data);
            } catch {
              // Non-JSON data, skip
            }
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") {
        setMessages((prev) => {
          const updated = [...prev];
          if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: updated[updated.length - 1].content + "\n\n**Connection lost**",
            };
          }
          return updated;
        });
      }
    }

    setStreaming(false);
    setActiveTools([]);
    abortRef.current = null;
  }, [input, streaming, sessionId]);

  const handleSSEEvent = useCallback((eventType: string, data: Record<string, unknown>) => {
    switch (eventType) {
      case "session":
        setSessionId(data.session_id as string);
        break;

      case "token":
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant") {
            updated[updated.length - 1] = {
              ...last,
              content: last.content + (data.content as string),
            };
          }
          return updated;
        });
        break;

      case "tool_start": {
        const toolEvent: ToolEvent = {
          tool: data.tool as string,
          input: data.input as string,
          status: "running",
        };
        setActiveTools((prev) => [...prev, toolEvent]);
        // Also add to the current message's tools
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant") {
            updated[updated.length - 1] = {
              ...last,
              tools: [...(last.tools || []), toolEvent],
            };
          }
          return updated;
        });
        break;
      }

      case "tool_end": {
        const toolName = data.tool as string;
        const summary = data.summary as string;
        setActiveTools((prev) =>
          prev.map((t) =>
            t.tool === toolName && t.status === "running"
              ? { ...t, status: "done", summary }
              : t
          )
        );
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant") {
            const tools = (last.tools || []).map((t) =>
              t.tool === toolName && t.status === "running"
                ? { ...t, status: "done" as const, summary }
                : t
            );
            updated[updated.length - 1] = { ...last, tools };
          }
          return updated;
        });
        break;
      }

      case "error":
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant") {
            updated[updated.length - 1] = {
              ...last,
              content: last.content + `\n\n**Error:** ${data.error}`,
            };
          }
          return updated;
        });
        break;
    }
  }, []);

  const handleClearSession = useCallback(() => {
    if (sessionId) {
      fetch(`${API_BASE}/api/agent/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      }).catch(() => {});
    }
    setMessages([]);
    setSessionId("");
    setActiveTools([]);
  }, [sessionId]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, x: 20 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.95, x: 20 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="fixed right-4 top-16 bottom-20 w-[480px] bg-[var(--bg-primary)]/90 backdrop-blur-xl border border-[var(--border-primary)] rounded-xl z-[9999] flex flex-col font-mono shadow-[0_8px_60px_rgba(0,0,0,0.5)] pointer-events-auto"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-primary)] shrink-0">
        <Brain size={14} className="text-purple-400" />
        <span className="text-[10px] tracking-[0.2em] text-[var(--text-primary)] font-bold flex-1">
          OSINT AGENT
        </span>
        {sessionId && (
          <span className="text-[7px] text-[var(--text-muted)] tracking-wider">
            SESSION {sessionId.slice(0, 8)}
          </span>
        )}
        <button
          onClick={() => setShowConfig(!showConfig)}
          title="Agent settings"
          className={`transition-colors p-0.5 ${showConfig ? "text-purple-400" : "text-[var(--text-muted)] hover:text-purple-400"}`}
        >
          <Settings size={10} />
        </button>
        {messages.length > 0 && (
          <button
            onClick={handleClearSession}
            title="Clear session"
            className="text-[var(--text-muted)] hover:text-red-400 transition-colors p-0.5"
          >
            <Trash2 size={10} />
          </button>
        )}
        <button onClick={() => setIsMinimized(!isMinimized)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          {isMinimized ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-red-400 transition-colors">
          <X size={12} />
        </button>
      </div>

      <AnimatePresence>
        {!isMinimized && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col flex-1 min-h-0"
          >
            {/* Config Panel */}
            <AnimatePresence>
              {showConfig && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden border-b border-[var(--border-primary)]"
                >
                  <div className="p-3 space-y-2">
                    <div className="flex items-center gap-2 mb-1">
                      <Key size={10} className="text-purple-400" />
                      <span className="text-[8px] tracking-[0.2em] text-[var(--text-muted)]">LLM CONFIGURATION</span>
                    </div>

                    {/* Provider selector */}
                    <div className="flex gap-1">
                      {(["openrouter", "anthropic", "openai"] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setConfigProvider(p)}
                          className={`flex-1 px-2 py-1.5 rounded text-[8px] font-mono tracking-wider transition-all ${
                            configProvider === p
                              ? "bg-purple-500/20 border border-purple-500/50 text-purple-300"
                              : "bg-[var(--bg-secondary)]/20 border border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                          }`}
                        >
                          {p === "openrouter" ? "OPENROUTER" : p.toUpperCase()}
                        </button>
                      ))}
                    </div>

                    {/* API Key input */}
                    <div className="flex items-center gap-2 bg-[var(--bg-secondary)]/30 border border-[var(--border-primary)] rounded px-2 py-1.5 focus-within:border-purple-700 transition-colors">
                      <Key size={9} className="text-[var(--text-muted)] shrink-0" />
                      <input
                        type={showKey ? "text" : "password"}
                        value={configKey}
                        onChange={(e) => setConfigKey(e.target.value)}
                        placeholder={keyPreview || `Enter ${configProvider} API key...`}
                        className="flex-1 bg-transparent text-[9px] text-[var(--text-primary)] font-mono tracking-wider outline-none placeholder:text-[var(--text-muted)]/50"
                      />
                      <button
                        onClick={() => setShowKey(!showKey)}
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        {showKey ? <EyeOff size={9} /> : <Eye size={9} />}
                      </button>
                    </div>

                    {/* Model input */}
                    <div className="flex items-center gap-2 bg-[var(--bg-secondary)]/30 border border-[var(--border-primary)] rounded px-2 py-1.5 focus-within:border-purple-700 transition-colors">
                      <Brain size={9} className="text-[var(--text-muted)] shrink-0" />
                      <input
                        type="text"
                        value={configModel}
                        onChange={(e) => setConfigModel(e.target.value)}
                        placeholder={
                          configProvider === "openrouter"
                            ? "anthropic/claude-sonnet-4 (default)"
                            : configProvider === "anthropic"
                            ? "claude-sonnet-4-20250514 (default)"
                            : "gpt-4o (default)"
                        }
                        className="flex-1 bg-transparent text-[9px] text-[var(--text-primary)] font-mono tracking-wider outline-none placeholder:text-[var(--text-muted)]/50"
                      />
                    </div>

                    {configProvider === "openrouter" && (
                      <div className="text-[7px] text-[var(--text-muted)] leading-relaxed">
                        Get a key at{" "}
                        <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">
                          openrouter.ai/keys
                        </a>
                        {" "}— supports Claude, GPT-4o, Gemini, Llama, and 200+ models.
                      </div>
                    )}

                    <button
                      onClick={handleSaveConfig}
                      disabled={!configKey && !configModel}
                      className={`w-full flex items-center justify-center gap-2 py-2 rounded text-[9px] tracking-[0.15em] font-bold transition-all ${
                        configKey || configModel
                          ? "bg-purple-500/20 border border-purple-500/50 text-purple-300 hover:bg-purple-500/30"
                          : "bg-[var(--bg-secondary)]/50 border border-[var(--border-primary)] text-[var(--text-muted)] cursor-not-allowed"
                      }`}
                    >
                      {configSaving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                      {configSaving ? "SAVING..." : "SAVE CONFIGURATION"}
                    </button>

                    {agentAvailable && (
                      <div className="flex items-center gap-1.5 text-[8px] text-green-400">
                        <Check size={8} />
                        <span>Agent ready — {keyPreview && `key: ${keyPreview}`}</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto styled-scrollbar px-3 py-2 space-y-3 min-h-0">
              {/* No API key — prompt to configure */}
              {messages.length === 0 && agentAvailable === false && !showConfig && (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Key size={24} className="text-purple-400/50" />
                  <div className="text-[9px] text-[var(--text-muted)] text-center max-w-[280px] leading-relaxed">
                    Configure an API key to activate the OSINT agent.
                    Click the <Settings size={8} className="inline text-purple-400" /> icon above.
                  </div>
                  <button
                    onClick={() => setShowConfig(true)}
                    className="px-4 py-2 rounded text-[9px] tracking-[0.15em] font-bold bg-purple-500/20 border border-purple-500/50 text-purple-300 hover:bg-purple-500/30 transition-all"
                  >
                    CONFIGURE API KEY
                  </button>
                </div>
              )}

              {/* Welcome / suggested prompts */}
              {messages.length === 0 && agentAvailable !== false && (
                <div className="space-y-3 py-4">
                  <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-purple-500/10 border border-purple-500/20">
                      <Sparkles size={18} className="text-purple-400" />
                    </div>
                    <div className="text-[10px] text-[var(--text-primary)] tracking-wider font-bold">
                      SHADOW OSINT AGENT
                    </div>
                    <div className="text-[8px] text-[var(--text-muted)] max-w-[300px] mx-auto leading-relaxed">
                      AI-powered investigation agent with access to Sherlock, HIBP, DNS recon,
                      live flight/ship tracking, web search, and 20+ OSINT tools.
                    </div>
                  </div>
                  <div className="space-y-1.5 pt-2">
                    <div className="text-[7px] tracking-[0.2em] text-[var(--text-muted)] text-center">
                      SUGGESTED INVESTIGATIONS
                    </div>
                    {SUGGESTED_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => {
                          setInput(prompt);
                        }}
                        className="w-full text-left px-3 py-2 rounded text-[9px] text-[var(--text-secondary)] bg-[var(--bg-secondary)]/20 border border-[var(--border-primary)]/50 hover:border-purple-500/30 hover:text-[var(--text-primary)] hover:bg-purple-950/10 transition-all"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Chat messages */}
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[90%] rounded-lg px-3 py-2 text-[10px] leading-relaxed ${
                      msg.role === "user"
                        ? "bg-cyan-950/30 border border-cyan-800/30 text-cyan-100"
                        : "bg-[var(--bg-secondary)]/30 border border-[var(--border-primary)]/50 text-[var(--text-secondary)]"
                    }`}
                  >
                    {/* Tool events */}
                    {msg.tools && msg.tools.length > 0 && (
                      <div className="mb-2 space-y-1">
                        {msg.tools.map((t, ti) => (
                          <div
                            key={ti}
                            className="flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--bg-primary)]/40 border border-[var(--border-primary)]/30 text-[8px]"
                          >
                            {t.status === "running" ? (
                              <Loader2 size={8} className="animate-spin text-purple-400" />
                            ) : (
                              <Check size={8} className="text-green-400" />
                            )}
                            <Wrench size={7} className="text-[var(--text-muted)]" />
                            <span className="text-purple-300 font-bold">{t.tool}</span>
                            {t.input && (
                              <span className="text-[var(--text-muted)] truncate max-w-[150px]">
                                ({t.input})
                              </span>
                            )}
                            {t.summary && t.status === "done" && (
                              <span className="text-[var(--text-muted)] ml-auto shrink-0">
                                {t.summary}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Message content */}
                    {msg.role === "user" ? (
                      <span className="font-mono">{msg.content}</span>
                    ) : (
                      <div className="prose prose-invert prose-xs max-w-none [&_p]:my-1 [&_h1]:text-[12px] [&_h2]:text-[11px] [&_h3]:text-[10px] [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_h1]:text-[var(--text-primary)] [&_h2]:text-[var(--text-primary)] [&_h3]:text-[var(--text-primary)] [&_li]:my-0 [&_ul]:my-1 [&_ol]:my-1 [&_code]:text-cyan-300 [&_code]:bg-cyan-950/30 [&_code]:px-1 [&_code]:rounded [&_pre]:bg-[var(--bg-primary)]/60 [&_pre]:border [&_pre]:border-[var(--border-primary)]/50 [&_pre]:rounded [&_pre]:p-2 [&_table]:text-[8px] [&_th]:text-[var(--text-muted)] [&_td]:py-0.5 [&_a]:text-cyan-400 [&_strong]:text-[var(--text-primary)] [&_blockquote]:border-purple-500/30 [&_blockquote]:text-[var(--text-muted)]">
                        <ReactMarkdown>{msg.content || (streaming && i === messages.length - 1 ? "..." : "")}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Streaming tool indicators */}
              {streaming && activeTools.some((t) => t.status === "running") && (
                <div className="flex items-center gap-2 px-2 py-1 text-[8px] text-purple-400 animate-pulse">
                  <Loader2 size={10} className="animate-spin" />
                  <span className="tracking-wider">
                    RUNNING {activeTools.filter((t) => t.status === "running").map((t) => t.tool).join(", ")}
                  </span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="shrink-0 border-t border-[var(--border-primary)] p-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 bg-[var(--bg-secondary)]/30 border border-[var(--border-primary)] rounded-lg px-3 py-2 focus-within:border-purple-700 transition-colors">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={agentAvailable === false ? "Agent unavailable..." : "Ask the OSINT agent..."}
                    disabled={agentAvailable === false}
                    className="flex-1 bg-transparent text-[10px] text-[var(--text-primary)] font-mono tracking-wider outline-none placeholder:text-[var(--text-muted)]/50 disabled:opacity-50"
                  />
                </div>
                {streaming ? (
                  <button
                    onClick={handleStop}
                    className="p-2 rounded-lg bg-red-500/20 border border-red-500/50 text-red-300 hover:bg-red-500/30 transition-colors"
                    title="Stop"
                  >
                    <X size={12} />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || agentAvailable === false}
                    className={`p-2 rounded-lg transition-colors ${
                      input.trim() && agentAvailable !== false
                        ? "bg-purple-500/20 border border-purple-500/50 text-purple-300 hover:bg-purple-500/30 hover:border-purple-400"
                        : "bg-[var(--bg-secondary)]/50 border border-[var(--border-primary)] text-[var(--text-muted)] cursor-not-allowed"
                    }`}
                    title="Send"
                  >
                    <Send size={12} />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

export default InvestigationPanel;
