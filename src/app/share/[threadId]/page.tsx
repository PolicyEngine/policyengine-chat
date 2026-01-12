import { createServiceClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import CopyThreadButton from "./CopyThreadButton";
import { ToolLogs } from "./ToolLogs";

interface PageProps {
  params: Promise<{ threadId: string }>;
}

export default async function SharedChatPage({ params }: PageProps) {
  const { threadId } = await params;
  // Use service client to bypass RLS for public thread access
  const supabase = createServiceClient();

  // Fetch thread (only if public)
  const { data: thread, error } = await supabase
    .from("threads")
    .select("*")
    .eq("id", threadId)
    .eq("is_public", true)
    .single();

  if (!thread || error) {
    notFound();
  }

  // Fetch messages
  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  // Fetch artifacts
  const { data: artifacts } = await supabase
    .from("artifacts")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  return (
    <div className="min-h-screen bg-[var(--color-surface)]">
      {/* Header */}
      <header className="bg-white border-b border-[var(--color-border)] px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logos/teal-square.svg" alt="PolicyEngine" className="w-8 h-8" />
            <div>
              <h1 className="font-semibold text-[var(--color-text-primary)]">{thread.title}</h1>
              <p className="text-xs text-[var(--color-text-muted)]">Shared conversation</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CopyThreadButton messages={messages || []} />
            <a
              href="/"
              className="text-sm px-3 py-1.5 bg-[var(--color-pe-green)] hover:bg-[var(--color-pe-green-dark)] text-white rounded-lg font-medium transition-colors"
            >
              Try PolicyEngine Chat
            </a>
          </div>
        </div>
      </header>

      {/* Messages */}
      <main className="max-w-3xl mx-auto p-6">
        <div className="space-y-6">
          {messages?.map((message) => (
            <div key={message.id}>
              {message.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-[80%] bg-[var(--color-pe-green)] text-white rounded-2xl rounded-br-md px-5 py-3 shadow-sm">
                    <p className="text-[14px] leading-relaxed">{message.content}</p>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <img src="/logos/teal-square.svg" alt="PolicyEngine" className="w-8 h-8 flex-shrink-0" />
                  <div className="flex-1">
                    {/* Tool logs */}
                    {message.tool_logs && message.tool_logs.length > 0 && (
                      <ToolLogs logs={message.tool_logs} />
                    )}
                    <div className="bg-white border border-[var(--color-border)] rounded-2xl rounded-tl-md px-5 py-4 shadow-sm">
                      <div className="response-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                    {/* Show artifacts after this message */}
                    {artifacts?.filter(a => a.message_id === message.id ||
                      // Show artifacts without message_id after the last assistant message
                      (!a.message_id && message.id === messages?.filter(m => m.role === "assistant").slice(-1)[0]?.id)
                    ).map(artifact => (
                      <div key={artifact.id} className="mt-4 border border-[var(--color-border)] rounded-xl overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-surface-sunken)] border-b border-[var(--color-border)]">
                          <div className="flex items-center gap-2">
                            <svg className="w-4 h-4 text-[var(--color-pe-green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                            </svg>
                            <span className="text-sm font-medium text-[var(--color-text-primary)]">{artifact.title}</span>
                          </div>
                          <a
                            href={`https://nikhilwoodruff--policyengine-chat-agent-serve-artifact.modal.run?id=${artifact.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 hover:bg-[var(--color-border)] rounded-md transition-colors"
                            title="Open in new tab"
                          >
                            <svg className="w-4 h-4 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        </div>
                        <div style={{ aspectRatio: "16/9" }} className="relative">
                          <iframe
                            src={`https://nikhilwoodruff--policyengine-chat-agent-serve-artifact.modal.run?id=${artifact.id}`}
                            className="w-full h-full border-0 absolute inset-0"
                            sandbox="allow-scripts"
                            title={artifact.title}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-[var(--color-border)] text-center">
          <p className="text-sm text-[var(--color-text-muted)]">
            This is a shared conversation from{" "}
            <a
              href="https://policyengine.org"
              className="text-[var(--color-pe-green)] hover:underline"
            >
              PolicyEngine
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
