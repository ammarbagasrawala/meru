"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import Sidebar from "./Sidebar";
import TrustStrip from "./TrustStrip";
import NetworkBanner from "./NetworkBanner";
import DemoModeBanner from "./DemoModeBanner";
import { Icon } from "./Icon";
import { usePathname } from "next/navigation";

/**
 * App shell — left sidebar + main content area, ChatGPT-style.
 * Auditor view (`/audit/...`) is rendered standalone *without* the shell so an unauthenticated
 * regulator gets a clean read-only page.
 */
export default function Shell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname() ?? "/";
  const isAuditor = pathname.startsWith("/audit/");

  if (isAuditor) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen" style={{ background: "var(--paper)" }}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-zinc-200">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-md hover:bg-zinc-100 text-zinc-700"
            aria-label="Open sidebar"
          >
            <Icon as={Menu} size={20} />
          </button>
          <img
            src="/meru-logo.png"
            alt=""
            width={22}
            height={22}
            className="w-[22px] h-[22px] rounded-md"
          />
          <span className="font-brand text-[16px] font-semibold">Meru</span>
        </header>
        <DemoModeBanner />
        <NetworkBanner />
        <TrustStrip />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
