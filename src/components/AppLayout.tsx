"use client";

import { Sidebar } from "./Sidebar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-[var(--color-surface)]">
      <Sidebar />
      <main className="flex-1 overflow-hidden ml-72">{children}</main>
    </div>
  );
}
