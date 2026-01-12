"use client";

import { useState, useMemo } from "react";

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
  }

  if (message.startsWith("[TOOL_RESULT]")) {
    return { type: "tool_result", title: "Result", content: message.replace("[TOOL_RESULT] ", "") };
  }

  if (message.startsWith("[ASSISTANT]")) {
    return { type: "assistant", title: "Thinking", content: message.replace("[ASSISTANT] ", "") };
  }

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
      <div className="py-1.5">
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
          <div className="ml-3.5 mt-2 text-[11px] bg-[var(--color-code-bg)] text-[var(--color-code-text)] rounded-lg px-3 py-2.5 font-mono">
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

  if (step.type === "tool_result") {
    let formattedContent = step.content;
    let isTruncated = false;
    try {
      const parsed = JSON.parse(step.content);
      formattedContent = JSON.stringify(parsed, null, 2);
    } catch {
      if (step.content.endsWith("...") || (step.content.length > 200 && !step.content.endsWith("}") && !step.content.endsWith("]"))) {
        isTruncated = true;
      }
    }

    const MAX_SIZE = 10000;
    const isLarge = formattedContent.length > MAX_SIZE;
    const displayContent = isLarge ? formattedContent.slice(0, MAX_SIZE) + "\n\n... (truncated)" : formattedContent;

    return (
      <div className="py-1 ml-3.5">
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
          <div className="mt-1.5 text-[11px] bg-[var(--color-code-bg)] text-[var(--color-code-text)] rounded-lg p-3 overflow-x-auto max-h-96 overflow-y-auto font-mono">
            <pre className="whitespace-pre-wrap leading-relaxed">{displayContent}</pre>
          </div>
        )}
      </div>
    );
  }

  if (step.type === "assistant") {
    return (
      <div className="py-2">
        <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed italic">{step.content}</p>
      </div>
    );
  }

  return null;
}

export function ToolLogs({ logs }: { logs: string[] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const parsedSteps = useMemo(() => {
    return logs
      .map(msg => parseLogEntry(msg))
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
