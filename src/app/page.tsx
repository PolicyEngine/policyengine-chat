"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { AppLayout } from "@/components/AppLayout";

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const supabase = createClient();

  async function startNewChat() {
    if (!user) return;

    const { data, error } = await supabase
      .from("threads")
      .insert({ title: "New chat", user_id: user.id })
      .select()
      .single();

    if (data && !error) {
      router.push(`/chat/${data.id}`);
    }
  }

  return (
    <AppLayout>
      <div className="flex flex-col items-center justify-center h-full p-8 bg-white">
        <div className="max-w-xl text-center">
          <div className="w-16 h-16 rounded-2xl bg-[var(--color-pe-green)] flex items-center justify-center mx-auto mb-6 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>

          <h1 className="text-3xl font-semibold text-[var(--color-text-primary)] mb-4">
            PolicyEngine chat
          </h1>

          <p className="text-[var(--color-text-secondary)] mb-8 leading-relaxed">
            Ask questions about UK or US tax and benefit policy. I can calculate
            how reforms affect your household, analyse economy-wide impacts, and
            explain policy rules.
          </p>

          <div className="grid gap-3 text-left mb-8">
            <ExamplePrompt text="What is my income tax if I earn £50,000?" />
            <ExamplePrompt text="How would doubling the child tax credit affect poverty rates?" />
            <ExamplePrompt text="Compare my net income under current law vs a £500 UBI" />
          </div>

          <button
            onClick={startNewChat}
            className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--color-pe-green)] hover:bg-[var(--color-pe-green-dark)]
              text-white rounded-xl font-medium transition-colors shadow-sm"
          >
            Start a new chat
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      </div>
    </AppLayout>
  );
}

function ExamplePrompt({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-[var(--color-surface-sunken)] border border-[var(--color-border)]">
      <svg className="w-4 h-4 text-[var(--color-text-muted)] mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
      <span className="text-sm text-[var(--color-text-secondary)]">{text}</span>
    </div>
  );
}
