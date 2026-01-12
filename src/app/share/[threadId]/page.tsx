import { createServiceClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import CopyThreadButton from "./CopyThreadButton";

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
                  <div className="flex-1 bg-white border border-[var(--color-border)] rounded-2xl rounded-tl-md px-5 py-4 shadow-sm">
                    <div className="response-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                        {message.content}
                      </ReactMarkdown>
                    </div>
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
