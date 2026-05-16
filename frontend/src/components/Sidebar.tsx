"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Mountain, Plus, Trash2 } from "lucide-react";
import { listCorpora, type CorpusListEntry, forgetCorpus } from "@/lib/corpora";
import ConnectButton from "./ConnectButton";
import { Icon } from "./Icon";

/**
 * Sidebar — ChatGPT-style left rail. Lists the user's corpora (local cache of mintedTokenIds).
 * Top: brand + "New corpus" button.
 * Middle: corpus list (scrollable).
 * Bottom: connect-wallet + a tiny disclaimer.
 */
export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname() ?? "/";
  const [corpora, setCorpora] = useState<CorpusListEntry[]>([]);

  useEffect(() => {
    setCorpora(listCorpora());
    const handler = () => setCorpora(listCorpora());
    window.addEventListener("provenant:corpora-changed", handler);
    return () => window.removeEventListener("provenant:corpora-changed", handler);
  }, []);

  return (
    <>
      {/* Backdrop on mobile when open */}
      <div
        onClick={onClose}
        className={`md:hidden fixed inset-0 z-30 bg-black/50 transition-opacity ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden
      />
      <aside
        className={`fixed md:static z-40 inset-y-0 left-0 w-64 border-r border-zinc-200 flex flex-col transform transition-transform md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "color-mix(in srgb, var(--paper) 60%, white)" }}
        aria-label="Meru sidebar"
      >
        {/* Brand + new */}
        <div className="p-3 flex items-center justify-between gap-2">
          <Link href="/" className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-100 flex-1 transition-colors">
            {/* Brand mark — Meru logo, 24×24 in the sidebar. The image is in
                public/ so Next.js serves it at /meru-logo.png. The `priority`
                flag would matter if we used next/image; plain img is fine for
                a 24px icon. */}
            <img
              src="/meru-logo.png"
              alt=""
              width={24}
              height={24}
              className="w-6 h-6 rounded-md"
              title="Meru — a stable centre of truth and verification"
            />
            <span className="font-brand text-[15px] font-semibold text-zinc-900">
              Meru
            </span>
          </Link>
          <Link
            href="/"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-zinc-100 text-zinc-500 transition-colors"
            title="New corpus"
            aria-label="New corpus"
          >
            <Icon as={Plus} size={16} />
          </Link>
        </div>

        {/* List */}
        <nav className="flex-1 overflow-y-auto px-2 py-2 thin-scroll">
          <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 px-2 pb-2 font-medium">
            Your corpora
          </div>
          {corpora.length === 0 ? (
            <div className="px-2 py-3 text-[12px] text-zinc-500 leading-relaxed">
              No corpora yet. Upload a doc to mint your first one.
            </div>
          ) : (
            <ul className="space-y-0.5">
              {corpora.map((c) => {
                const href = `/corpus/${c.tokenId}` as const;
                const active = pathname === href || pathname.startsWith(`/corpus/${c.tokenId}/`);
                return (
                  <li key={c.tokenId} className="group relative">
                    <Link
                      href={href as never}
                      onClick={onClose}
                      className={`block px-2.5 py-2 rounded-md text-[13.5px] truncate transition-colors ${
                        active
                          ? "bg-white text-zinc-900 shadow-[0_0_0_1px_var(--hairline)]"
                          : "text-zinc-700 hover:bg-white/60"
                      }`}
                      title={c.title}
                    >
                      {c.title}
                    </Link>
                    <button
                      type="button"
                      aria-label="Forget this corpus from sidebar"
                      onClick={(e) => {
                        e.preventDefault();
                        if (confirm("Remove this corpus from sidebar? The on-chain record is untouched.")) {
                          forgetCorpus(c.tokenId);
                        }
                      }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-zinc-400 opacity-0 group-hover:opacity-100 hover:bg-zinc-100 hover:text-red-600 transition-opacity"
                    >
                      <Icon as={Trash2} size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-zinc-200 space-y-2">
          <div className="px-1">
            <ConnectButton />
          </div>
          <div className="text-[10px] text-zinc-500 px-1 leading-relaxed">
            Confidential AI on 0G · MIT
          </div>
        </div>
      </aside>
    </>
  );
}
