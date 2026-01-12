"use client";

import { useState, useCallback } from "react";

interface Message {
  role: string;
  content: string;
}

export default function CopyThreadButton({ messages }: { messages: Message[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = messages
      .map((m) => `${m.role === "user" ? "User" : "PolicyEngine"}: ${m.content}`)
      .join("\n\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [messages]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-border)] hover:bg-[var(--color-surface-sunken)] rounded-lg text-[var(--color-text-secondary)] text-sm font-medium transition-colors"
      title="Copy entire conversation"
    >
      {copied ? (
        <>
          <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy all
        </>
      )}
    </button>
  );
}
