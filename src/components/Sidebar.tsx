"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "./AuthProvider";
import type { Thread } from "@/types/database";

export function Sidebar() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [isOpen, setIsOpen] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const supabase = createClient();

  const currentThreadId = pathname?.startsWith("/chat/")
    ? pathname.split("/")[2]
    : null;

  useEffect(() => {
    if (user) {
      loadThreads();

      const channel = supabase
        .channel("threads")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "threads" },
          () => loadThreads()
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  async function loadThreads() {
    const { data } = await supabase
      .from("threads")
      .select("*")
      .order("updated_at", { ascending: false });
    if (data) setThreads(data);
  }

  async function createThread() {
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

  async function deleteThread(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await supabase.from("threads").delete().eq("id", id);
    if (currentThreadId === id) {
      router.push("/");
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 p-2 rounded-lg bg-white border border-[var(--color-border)] md:hidden shadow-sm"
      >
        {isOpen ? (
          <svg className="w-5 h-5 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>

      {/* Sidebar */}
      <aside
        className={`
          fixed z-40 h-full w-72 flex-shrink-0
          bg-white border-r border-[var(--color-border)]
          transition-transform duration-200
          ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
      >
        <div className="flex flex-col h-full">
          {/* Header with PE branding */}
          <div className="p-5 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-lg bg-[var(--color-pe-green)] flex items-center justify-center shadow-sm">
                <span className="text-white font-bold text-sm">PE</span>
              </div>
              <div>
                <div className="font-semibold text-[var(--color-text-primary)]">PolicyEngine</div>
                <div className="text-xs text-[var(--color-text-muted)]">Policy analyst</div>
              </div>
            </div>

            <button
              onClick={createThread}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5
                bg-[var(--color-pe-green)] hover:bg-[var(--color-pe-green-dark)] text-white rounded-lg
                transition-colors font-medium text-sm shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New conversation
            </button>
          </div>

          {/* Thread list */}
          <div className="flex-1 overflow-y-auto p-3">
            <div className="mb-2 px-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                Recent conversations
              </span>
            </div>

            {threads.length === 0 ? (
              <div className="text-center py-12 px-4">
                <div className="w-12 h-12 rounded-full bg-[var(--color-surface-sunken)] flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <p className="text-sm text-[var(--color-text-muted)]">
                  No conversations yet
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Start a new chat to begin
                </p>
              </div>
            ) : (
              <ul className="space-y-1">
                {threads.map((thread) => (
                  <li key={thread.id}>
                    <div
                      onClick={() => router.push(`/chat/${thread.id}`)}
                      className={`
                        w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                        transition-all group cursor-pointer
                        ${
                          currentThreadId === thread.id
                            ? "bg-[var(--color-pe-green)] text-white shadow-sm"
                            : "hover:bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)]"
                        }
                      `}
                    >
                      <svg
                        className={`w-4 h-4 flex-shrink-0 ${
                          currentThreadId === thread.id ? "text-white/70" : "text-[var(--color-text-muted)]"
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      <span className="flex-1 truncate text-sm font-medium">
                        {thread.title}
                      </span>
                      <button
                        onClick={(e) => deleteThread(thread.id, e)}
                        className={`
                          opacity-0 group-hover:opacity-100 p-1.5 rounded-md transition-all
                          ${
                            currentThreadId === thread.id
                              ? "hover:bg-white/20 text-white/70"
                              : "hover:bg-[var(--color-border)] text-[var(--color-text-muted)]"
                          }
                        `}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* User section */}
          <div className="p-4 border-t border-[var(--color-border)]">
            {user && (
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-full bg-[var(--color-surface-sunken)] flex items-center justify-center">
                  {user.is_anonymous ? (
                    <svg className="w-4 h-4 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  ) : user.user_metadata?.avatar_url ? (
                    <img
                      src={user.user_metadata.avatar_url}
                      alt=""
                      className="w-8 h-8 rounded-full"
                    />
                  ) : (
                    <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                      {user.email?.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {user.is_anonymous ? "Guest" : user.user_metadata?.full_name || user.email?.split("@")[0]}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)] truncate">
                    {user.is_anonymous ? "Sign in to save chats" : user.email}
                  </p>
                </div>
                {user.is_anonymous ? (
                  <button
                    onClick={() => router.push("/login")}
                    className="px-3 py-1.5 text-xs font-medium text-[var(--color-pe-green)] hover:bg-[var(--color-surface-sunken)] rounded-lg transition-colors"
                  >
                    Sign in
                  </button>
                ) : (
                  <button
                    onClick={signOut}
                    className="p-2 hover:bg-[var(--color-surface-sunken)] rounded-lg transition-colors"
                    title="Sign out"
                  >
                    <svg className="w-4 h-4 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                  </button>
                )}
              </div>
            )}
            <a
              href="https://policyengine.org"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-pe-green)] transition-colors"
            >
              <span>Powered by PolicyEngine</span>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}
