"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * Lightweight toast surface for transient blockchain-flow messages.
 *
 * UX intent: blockchain UX research (austinwerner.io, LinkedIn, artkai.io) calls
 * out that wallet flows generate small, time-bounded events — chain switched,
 * wallet rejected, balance too low, RPC unreachable — that should not interrupt
 * the user but must be visible. Toast is the right surface; modals would be
 * overkill for these.
 *
 * Auto-dismiss is intentional (4s for info, 7s for error). The user can also
 * click to dismiss. Stacks up to 3 visible at once.
 */
export type ToastKind = "info" | "success" | "warn" | "error";

type ToastInput = {
  kind?: ToastKind;
  title: string;
  body?: string;
  /** Optional raw error text — surfaced behind a "Details" disclosure. */
  raw?: string;
  /** Override auto-dismiss in ms. 0 means no auto-dismiss. */
  durationMs?: number;
};

type Toast = ToastInput & { id: string; kind: ToastKind };

type Ctx = {
  push: (t: ToastInput) => void;
  dismiss: (id: string) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    // Fail soft — if a caller renders outside the provider, log instead of breaking the page.
    return {
      push: (t) =>
        // eslint-disable-next-line no-console
        console.warn("[toast]", t.title, t.body ?? ""),
      dismiss: () => {},
    };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: ToastInput) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const kind = t.kind ?? "info";
      const duration =
        t.durationMs ?? (kind === "error" ? 7000 : kind === "warn" ? 5500 : 4000);
      setToasts((prev) => [...prev.slice(-2), { ...t, kind, id }]);
      if (duration > 0) {
        const handle = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, handle);
      }
    },
    [dismiss]
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((h) => clearTimeout(h));
      map.clear();
    };
  }, []);

  return (
    <ToastCtx.Provider value={{ push, dismiss }}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm pointer-events-none"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const palette = {
    info: "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900",
    success: "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40",
    warn: "border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40",
    error: "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40",
  }[toast.kind];

  const dot = {
    info: "bg-zinc-400",
    success: "bg-emerald-500",
    warn: "bg-amber-500",
    error: "bg-red-500",
  }[toast.kind];

  return (
    <div
      role="status"
      className={`pointer-events-auto rounded-lg shadow-lg border px-3 py-2.5 text-sm ${palette} max-w-sm`}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className={`mt-1.5 inline-block w-2 h-2 rounded-full ${dot} shrink-0`}
        />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-zinc-900 dark:text-zinc-100">{toast.title}</div>
          {toast.body && (
            <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 leading-snug">
              {toast.body}
            </div>
          )}
          {toast.raw && (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="text-[11px] text-zinc-500 hover:text-emerald-600 underline decoration-dotted underline-offset-2 mt-1"
              >
                {open ? "Hide details" : "Details"}
              </button>
              {open && (
                <pre className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-900 rounded p-1.5 overflow-x-auto max-h-24 break-all whitespace-pre-wrap">
                  {toast.raw}
                </pre>
              )}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 -mt-0.5"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
