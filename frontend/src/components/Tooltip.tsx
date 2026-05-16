"use client";

import { ReactNode, useState } from "react";

type Props = {
  /** Plain-English explanation, 8–12 words. The "what is this in layman terms" line. */
  text: string;
  /** Optional learn-more URL. */
  href?: string;
  children: ReactNode;
};

/**
 * Tiny on-hover/focus tooltip. The site-wide policy is: every jargon term wears
 * a Tooltip with a plain-English explanation in 8–12 words. Use sparingly — only
 * on actually-jargon terms. Don't wrap every word, the user is not a fool.
 */
export default function Tooltip({ text, href, children }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex">
      <span
        className="cursor-help underline decoration-dotted decoration-zinc-400 underline-offset-2"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        tabIndex={0}
      >
        {children}
      </span>
      {open && (
        <span
          role="tooltip"
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-60 rounded-md bg-zinc-900 text-white text-[11px] leading-snug px-2.5 py-1.5 shadow-lg"
        >
          {text}
          {href && (
            <>
              {" "}
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-emerald-300"
              >
                learn more
              </a>
            </>
          )}
        </span>
      )}
    </span>
  );
}
