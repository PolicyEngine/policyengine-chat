"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message } from "@/types/database";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={`p-1.5 rounded-md hover:bg-[var(--color-surface-sunken)] transition-colors cursor-pointer ${className}`}
      title="Copy"
    >
      {copied ? (
        <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-4 h-4 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

interface AgentLog {
  id: string;
  thread_id: string;
  message: string;
  created_at: string;
}

interface ParsedStep {
  type: "agent" | "tool_use" | "api_call" | "api_response" | "tool_result" | "assistant" | "unknown";
  title: string;
  content: string;
  method?: string;
  url?: string;
  statusCode?: number;
  toolName?: string;
  params?: Record<string, unknown>;
}

interface ChatInterfaceProps {
  threadId: string;
}

// Tool name mapping for human-readable labels
const TOOL_NAME_MAP: Record<string, string> = {
  "list_parameters_parameters__get": "Search parameters",
  "get_parameter_parameters__parameter_id__get": "Get parameter",
  "list_parameter_values_parameter_values__get": "Get parameter values",
  "get_parameter_value_parameter_values__parameter_value_id__get": "Get parameter value",
  "list_variables_variables__get": "Search variables",
  "get_variable_variables__variable_id__get": "Get variable",
  "create_policy_policies__post": "Create policy",
  "get_policy_policies__policy_id__get": "Get policy",
  "list_policies_policies__get": "List policies",
  "calculate_household_household_calculate_post": "Calculate household",
  "get_household_job_status_household_calculate__job_id__get": "Poll household job",
  "calculate_household_impact_comparison_household_impact_post": "Calculate household impact",
  "get_household_impact_job_status_household_impact__job_id__get": "Poll household impact",
  "economic_impact_analysis_economic_impact_post": "Run economic analysis",
  "get_economic_impact_status_analysis_economic_impact__report_id__get": "Poll economic analysis",
  "list_datasets_datasets__get": "List datasets",
  "get_dataset_datasets__dataset_id__get": "Get dataset",
  "list_tax_benefit_models_tax_benefit_models__get": "List models",
  "get_tax_benefit_model_tax_benefit_models__model_id__get": "Get model",
  "list_simulations_simulations__get": "List simulations",
  "get_simulation_simulations__simulation_id__get": "Get simulation",
  "sleep": "Wait",
};

function parseLogEntry(message: string): ParsedStep {
  // [AGENT] messages - filter out internal debug info
  if (message.startsWith("[AGENT]")) {
    const content = message.replace("[AGENT] ", "");
    if (content.startsWith("Stop reason:") ||
        content.startsWith("Turn ") ||
        content.startsWith("Loaded ") ||
        content.startsWith("Fetching ") ||
        content.startsWith("Completed")) {
      return { type: "unknown", title: "", content: "" };
    }
    return { type: "agent", title: "Agent", content };
  }

  // [TOOL_USE] tool_name: {...}
  if (message.startsWith("[TOOL_USE]")) {
    const content = message.replace("[TOOL_USE] ", "");
    const colonIndex = content.indexOf(":");
    if (colonIndex > -1) {
      const toolName = content.slice(0, colonIndex).trim();
      const paramsStr = content.slice(colonIndex + 1).trim();
      let params: Record<string, unknown> = {};
      try {
        params = JSON.parse(paramsStr);
      } catch {
        // Not valid JSON
      }
      const displayName = TOOL_NAME_MAP[toolName] || toolName
        .replace(/_+/g, " ")
        .replace(/\s+(get|post|put|delete)$/i, "")
        .replace(/\s+/g, " ")
        .trim();
      return { type: "tool_use", title: displayName, content: paramsStr, toolName, params };
    }
  }

  // [API] GET/POST url
  if (message.startsWith("[API]")) {
    const content = message.replace("[API] ", "");
    if (content.startsWith("Response:")) {
      const statusCode = parseInt(content.replace("Response: ", ""), 10);
      return { type: "api_response", title: "Response", content, statusCode };
    }
    const methodMatch = content.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/);
    if (methodMatch) {
      return { type: "api_call", title: "API Request", content, method: methodMatch[1], url: methodMatch[2] };
    }
    if (content.startsWith("Query:") || content.startsWith("Body:")) {
      return {
        type: "api_call",
        title: content.startsWith("Query:") ? "Query params" : "Request body",
        content: content.replace(/^(Query|Body):\s*/, ""),
      };
    }
  }

  // [TOOL_RESULT] ...
  if (message.startsWith("[TOOL_RESULT]")) {
    return { type: "tool_result", title: "Result", content: message.replace("[TOOL_RESULT] ", "") };
  }

  // [ASSISTANT] ...
  if (message.startsWith("[ASSISTANT]")) {
    return { type: "assistant", title: "Thinking", content: message.replace("[ASSISTANT] ", "") };
  }

  // [SLEEP] ...
  if (message.startsWith("[SLEEP]")) {
    return { type: "unknown", title: "", content: "" };
  }

  return { type: "unknown", title: "Log", content: message };
}

function ToolCard({ step }: { step: ParsedStep }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (step.type === "agent" || step.type === "unknown") {
    return null;
  }

  if (step.type === "tool_use") {
    return (
      <div className="py-1.5 animate-fadeIn">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 hover:text-[var(--color-pe-green)] transition-colors group w-full text-left font-mono cursor-pointer"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-pe-green)] shrink-0" />
          <span className="text-[12px] text-[var(--color-text-secondary)]">{step.title}</span>
          {step.params && Object.keys(step.params).length > 0 && (
            <svg
              className={`w-3 h-3 text-[var(--color-text-muted)] transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </button>
        {isExpanded && step.params && Object.keys(step.params).length > 0 && (
          <div className="ml-3.5 mt-2 text-[11px] bg-[var(--color-code-bg)] text-[var(--color-code-text)] rounded-lg px-3 py-2.5 animate-slideDown font-mono">
            {Object.entries(step.params).map(([key, value]) => (
              <div key={key} className="flex gap-2 py-0.5">
                <span className="text-[var(--color-pe-green-light)]">{key}:</span>
                <span className="text-[var(--color-code-text)]/80 break-all">
                  {typeof value === "string" ? value : JSON.stringify(value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (step.type === "api_call" || step.type === "api_response") {
    return null;
  }

  if (step.type === "tool_result") {
    // Try to parse and format as JSON
    let formattedContent = step.content;
    let isTruncated = false;
    try {
      const parsed = JSON.parse(step.content);
      formattedContent = JSON.stringify(parsed, null, 2);
    } catch {
      // Check if it looks truncated (ends abruptly)
      if (step.content.endsWith("...") || (step.content.length > 200 && !step.content.endsWith("}") && !step.content.endsWith("]"))) {
        isTruncated = true;
      }
    }

    // Limit display size
    const MAX_SIZE = 10000;
    const isLarge = formattedContent.length > MAX_SIZE;
    const displayContent = isLarge ? formattedContent.slice(0, MAX_SIZE) + "\n\n... (truncated)" : formattedContent;

    return (
      <div className="py-1 ml-3.5 animate-fadeIn">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] font-mono cursor-pointer"
        >
          <svg className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span>result {isTruncated && "(truncated in logs)"}</span>
        </button>
        {isExpanded && (
          <div className="mt-1.5 text-[11px] bg-[var(--color-code-bg)] text-[var(--color-code-text)] rounded-lg p-3 overflow-x-auto max-h-96 overflow-y-auto animate-slideDown font-mono">
            <pre className="whitespace-pre-wrap leading-relaxed">{displayContent}</pre>
          </div>
        )}
      </div>
    );
  }

  if (step.type === "assistant") {
    return (
      <div className="py-2 animate-fadeIn">
        <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed italic">{step.content}</p>
      </div>
    );
  }

  return null;
}

function CollapsedLogs({ logs }: { logs: AgentLog[] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const parsedSteps = useMemo(() => {
    return logs
      .map(log => parseLogEntry(log.message))
      .filter(step => step.type !== "unknown" && step.type !== "agent");
  }, [logs]);

  if (parsedSteps.length === 0) return null;

  const toolCount = parsedSteps.filter(s => s.type === "tool_use").length;

  return (
    <div className="mb-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] font-mono cursor-pointer"
      >
        <svg
          className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span>{toolCount} tool call{toolCount !== 1 ? "s" : ""}</span>
      </button>
      {isExpanded && (
        <div className="mt-2 p-3 bg-[var(--color-surface-sunken)] rounded-xl border border-[var(--color-border)]">
          {parsedSteps.map((step, i) => (
            <ToolCard key={i} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProgressIndicator({ logs }: { logs: AgentLog[] }) {
  const stage = useMemo(() => {
    const messages = logs.map(l => l.message.toLowerCase());
    const hasSearch = messages.some(m => m.includes("parameters") || m.includes("variables"));
    const hasPolicy = messages.some(m => m.includes("policies") || m.includes("create_policy"));
    const hasAnalysis = messages.some(m => m.includes("analysis") || m.includes("economic"));
    const hasHousehold = messages.some(m => m.includes("household"));

    if (hasAnalysis) return { label: "Running analysis...", icon: "spin" };
    if (hasPolicy) return { label: "Creating policy...", icon: "spin" };
    if (hasHousehold) return { label: "Calculating...", icon: "spin" };
    if (hasSearch) return { label: "Searching parameters...", icon: "spin" };
    return { label: "Thinking...", icon: "spin" };
  }, [logs]);

  if (logs.length === 0) return null;

  return (
    <div className="flex items-center gap-2.5 mb-3 pb-3 border-b border-[var(--color-border)]">
      <div className="w-4 h-4 border-2 border-[var(--color-pe-green)] border-t-transparent rounded-full animate-spin" />
      <span className="text-[12px] font-mono text-[var(--color-text-muted)]">{stage.label}</span>
    </div>
  );
}

export function ChatInterface({ threadId }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [messageLogs, setMessageLogs] = useState<Record<string, AgentLog[]>>({});
  const [isPublic, setIsPublic] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tokenCost, setTokenCost] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    loadMessages();
    loadThreadStatus();

    const messagesChannel = supabase
      .channel(`messages-${threadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });
          if (newMessage.role === "assistant") {
            // Save logs for this message before clearing (use callback to get current logs)
            setLogs((currentLogs) => {
              setMessageLogs((prev) => ({
                ...prev,
                [newMessage.id]: currentLogs,
              }));
              return [];
            });
            setIsLoading(false);
            // Reload thread status to get updated token counts
            loadThreadStatus();
          }
        }
      )
      .subscribe();

    const logsChannel = supabase
      .channel(`logs-${threadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_logs",
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const newLog = payload.new as AgentLog;
          setLogs((prev) => {
            if (prev.some((l) => l.id === newLog.id)) return prev;
            return [...prev, newLog];
          });
        }
      )
      .subscribe();

    // Subscribe to thread updates for token cost
    const threadChannel = supabase
      .channel(`thread-${threadId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "threads",
          filter: `id=eq.${threadId}`,
        },
        (payload) => {
          const updated = payload.new as { input_tokens?: number; output_tokens?: number };
          const inputTokens = updated.input_tokens ?? 0;
          const outputTokens = updated.output_tokens ?? 0;
          if (inputTokens > 0 || outputTokens > 0) {
            const cost = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
            setTokenCost(cost);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(logsChannel);
      supabase.removeChannel(threadChannel);
    };
  }, [threadId]);

  // Poll for new messages as fallback when loading
  useEffect(() => {
    if (!isLoading) return;

    const pollInterval = setInterval(async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });

      if (data && data.length > messages.length) {
        const newMessages = data.filter(
          (m) => !messages.some((existing) => existing.id === m.id)
        );
        if (newMessages.some((m) => m.role === "assistant")) {
          setMessages(data);
          // Save current logs before clearing
          const assistantMsg = newMessages.find((m) => m.role === "assistant");
          if (assistantMsg) {
            setLogs((currentLogs) => {
              setMessageLogs((prev) => ({
                ...prev,
                [assistantMsg.id]: currentLogs,
              }));
              return [];
            });
          }
          setIsLoading(false);
          // Reload thread status to get updated token counts
          loadThreadStatus();
        }
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [isLoading, threadId, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  async function loadMessages() {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    if (data) setMessages(data);
  }

  async function loadThreadStatus() {
    const { data } = await supabase
      .from("threads")
      .select("is_public, input_tokens, output_tokens")
      .eq("id", threadId)
      .single();
    if (data) {
      setIsPublic(data.is_public ?? false);
      // Calculate cost: Claude Sonnet pricing $3/1M input, $15/1M output
      const inputTokens = data.input_tokens ?? 0;
      const outputTokens = data.output_tokens ?? 0;
      if (inputTokens > 0 || outputTokens > 0) {
        const cost = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
        setTokenCost(cost);
      }
    }
  }

  async function togglePublic() {
    const newValue = !isPublic;
    setIsPublic(newValue);
    await supabase
      .from("threads")
      .update({ is_public: newValue })
      .eq("id", threadId);
  }

  function copyShareLink() {
    const url = `${window.location.origin}/share/${threadId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setIsLoading(true);
    setLogs([]);

    await supabase.from("agent_logs").delete().eq("thread_id", threadId);

    await supabase.from("messages").insert({
      thread_id: threadId,
      role: "user",
      content: userMessage,
    });

    if (messages.length === 0) {
      const title = userMessage.slice(0, 50) + (userMessage.length > 50 ? "..." : "");
      await supabase.from("threads").update({ title }).eq("id", threadId);
    }

    const history = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const response = await fetch("/api/agent/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userMessage,
          history,
          threadId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error("Agent error:", error);
        setIsLoading(false);
      }
    } catch (error) {
      console.error("Failed to spawn agent:", error);
      setIsLoading(false);
    }
  }

  const parsedSteps = useMemo(() => {
    return logs
      .map(log => parseLogEntry(log.message))
      .filter(step => step.type !== "unknown");
  }, [logs]);

  const exampleQuestions = [
    "What is the UK personal allowance for 2026?",
    "Calculate tax for someone earning $50,000 in the US",
    "What if we increased child benefit by 10%?",
    "What benefits would a single parent receive?",
  ];

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-6 py-3 bg-gradient-to-r from-[var(--color-pe-green)] to-[var(--color-pe-green-dark)] shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logos/white-square.svg" alt="PolicyEngine" className="w-8 h-8" />
            <div>
              <h2 className="text-white font-semibold text-sm">Policy analyst</h2>
              <p className="text-white/70 text-xs">UK and US tax-benefit policy</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Copy thread button */}
            {messages.length > 0 && (
              <button
                onClick={() => {
                  const text = messages.map(m => `${m.role === "user" ? "User" : "PolicyEngine"}: ${m.content}`).join("\n\n");
                  navigator.clipboard.writeText(text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-white text-xs font-medium transition-colors"
                title="Copy entire conversation"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {copied ? "Copied!" : "Copy all"}
              </button>
            )}
            {/* Share button */}
            <div className="relative">
              <button
                onClick={() => setShowShareMenu(!showShareMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-white text-xs font-medium transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share
              </button>
              {showShareMenu && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-lg border border-[var(--color-border)] p-4 z-50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">Public link</span>
                    <button
                      onClick={togglePublic}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isPublic ? "bg-[var(--color-pe-green)]" : "bg-gray-200"}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${isPublic ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                  </div>
                  {isPublic && (
                    <button
                      onClick={copyShareLink}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[var(--color-surface-sunken)] hover:bg-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-secondary)] transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy link
                    </button>
                  )}
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                    {isPublic ? "Anyone with the link can view this chat" : "Only you can view this chat"}
                  </p>
                </div>
              )}
            </div>
            {/* Token cost */}
            {tokenCost !== null && tokenCost > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 rounded-lg">
                <svg className="w-3.5 h-3.5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-white/80 text-xs font-medium">
                  ${tokenCost < 0.01 ? tokenCost.toFixed(4) : tokenCost.toFixed(2)}
                </span>
              </div>
            )}
            {/* Status indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/20 rounded-lg">
              <div className={`w-2 h-2 rounded-full ${isLoading ? "bg-amber-300 animate-pulse-dot" : "bg-green-300"}`} />
              <span className="text-white/80 text-xs font-medium">
                {isLoading ? "Working..." : "Ready"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6">
        {messages.length === 0 && !isLoading && (
          <div className="h-full flex flex-col justify-center">
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-2xl bg-[var(--color-pe-green)]/10 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-[var(--color-pe-green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2">
                What would you like to know?
              </h3>
              <p className="text-sm text-[var(--color-text-muted)] max-w-md mx-auto">
                Ask about tax rates, benefits, policy impacts, or household calculations
              </p>
            </div>
            <div className="grid gap-2 max-w-lg mx-auto">
              {exampleQuestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => setInput(q)}
                  className="text-left px-4 py-3 rounded-xl bg-[var(--color-surface-sunken)] hover:bg-white border border-transparent hover:border-[var(--color-border)] hover:shadow-sm text-[13px] text-[var(--color-text-secondary)] transition-all group cursor-pointer"
                >
                  <span className="group-hover:text-[var(--color-pe-green)] transition-colors">{q}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-6 max-w-3xl mx-auto">
          {messages.map((message) => (
            <div key={message.id} className="group/message">
              {message.role === "user" ? (
                <div className="flex justify-end items-start gap-2">
                  <CopyButton
                    text={message.content}
                    className="opacity-0 group-hover/message:opacity-100 mt-2"
                  />
                  <div className="max-w-[80%] bg-[var(--color-pe-green)] text-white rounded-2xl rounded-br-md px-5 py-3 shadow-sm">
                    <p className="text-[14px] leading-relaxed">{message.content}</p>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <img src="/logos/teal-square.svg" alt="PolicyEngine" className="w-8 h-8 flex-shrink-0" />
                  <div className="flex-1">
                    {/* Collapsed logs for this message */}
                    {messageLogs[message.id] && messageLogs[message.id].length > 0 && (
                      <CollapsedLogs logs={messageLogs[message.id]} />
                    )}
                    <div className="bg-white border border-[var(--color-border)] rounded-2xl rounded-tl-md px-5 py-4 shadow-sm relative">
                      <CopyButton
                        text={message.content}
                        className="absolute top-2 right-2 opacity-0 group-hover/message:opacity-100"
                      />
                      <div className="response-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Live agent logs */}
          {isLoading && logs.length > 0 && (
            <div className="flex gap-3 animate-fadeIn">
              <img src="/logos/teal-square.svg" alt="PolicyEngine" className="w-8 h-8 flex-shrink-0" />
              <div className="flex-1 bg-[var(--color-surface-sunken)] rounded-2xl rounded-tl-md p-4 max-h-[500px] overflow-y-auto border border-[var(--color-border)]">
                <ProgressIndicator logs={logs} />
                <div className="space-y-0">
                  {parsedSteps.map((step, j) => (
                    <ToolCard key={j} step={step} />
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>
            </div>
          )}

          {isLoading && logs.length === 0 && (
            <div className="flex gap-3 animate-fadeIn">
              <img src="/logos/teal-square.svg" alt="PolicyEngine" className="w-8 h-8 flex-shrink-0" />
              <div className="flex items-center gap-3 px-5 py-4 bg-[var(--color-surface-sunken)] rounded-2xl rounded-tl-md border border-[var(--color-border)]">
                <div className="w-4 h-4 border-2 border-[var(--color-pe-green)] border-t-transparent rounded-full animate-spin" />
                <span className="text-[13px] font-mono text-[var(--color-text-muted)]">Starting agent...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-[var(--color-border)] p-4 bg-[var(--color-surface)]">
        <form onSubmit={sendMessage} className="flex gap-3 max-w-3xl mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a policy question..."
            disabled={isLoading}
            className="flex-1 px-4 py-3 text-[14px] border border-[var(--color-border)] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-pe-green)] focus:border-transparent disabled:opacity-50 placeholder:text-[var(--color-text-muted)]"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-5 py-3 bg-[var(--color-pe-green)] hover:bg-[var(--color-pe-green-dark)] text-white rounded-xl text-[14px] font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 shadow-sm"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Working</span>
              </>
            ) : (
              <>
                <span>Ask</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </>
            )}
          </button>
        </form>
        <p className="text-center text-[11px] text-[var(--color-text-muted)] mt-2 max-w-3xl mx-auto">
          Messages are processed by PolicyEngine and stored on our servers. Do not share sensitive personal information.
        </p>
      </div>
    </div>
  );
}
