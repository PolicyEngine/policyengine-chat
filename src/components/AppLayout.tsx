"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "./Sidebar";

const DEFAULT_WIDTH = 288;

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    // Initial load
    const savedWidth = localStorage.getItem("sidebar-width");
    if (savedWidth) {
      setSidebarWidth(parseInt(savedWidth, 10));
    }

    // Listen for storage changes (when sidebar is resized)
    const handleStorage = () => {
      const width = localStorage.getItem("sidebar-width");
      if (width) {
        setSidebarWidth(parseInt(width, 10));
      }
    };

    // Custom event for same-tab updates
    window.addEventListener("sidebar-resize", handleStorage);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("sidebar-resize", handleStorage);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return (
    <div className="flex h-screen bg-[var(--color-surface)]">
      <Sidebar />
      <main
        className="flex-1 overflow-hidden transition-[margin-left] duration-100"
        style={{ marginLeft: `${sidebarWidth}px` }}
      >
        {children}
      </main>
    </div>
  );
}
