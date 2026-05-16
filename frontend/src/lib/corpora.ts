"use client";

/**
 * localStorage-backed registry of the corpora this browser has minted.
 * Not authoritative — the iNFT contract on 0G Chain is. This is just a UI cache so the
 * sidebar can show "your conversations". Never stores PII or keys.
 */

export type CorpusListEntry = {
  tokenId: string;
  title: string;        // user-editable, defaults to "Corpus #<id>"
  createdAt: number;
};

const STORAGE_KEY = "provenant:corpora:v1";
const MAX_ENTRIES = 100;

function read(): CorpusListEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is CorpusListEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as CorpusListEntry).tokenId === "string" &&
        typeof (e as CorpusListEntry).title === "string" &&
        typeof (e as CorpusListEntry).createdAt === "number"
      )
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function write(entries: CorpusListEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_ENTRIES))
    );
    window.dispatchEvent(new Event("provenant:corpora-changed"));
  } catch {
    /* localStorage full or blocked — fail silently */
  }
}

export function listCorpora(): CorpusListEntry[] {
  return read().sort((a, b) => b.createdAt - a.createdAt);
}

export function recordCorpus(tokenId: string, title?: string): CorpusListEntry {
  const existing = read();
  const idx = existing.findIndex((e) => e.tokenId === tokenId);
  const entry: CorpusListEntry = idx >= 0
    ? { ...existing[idx]!, title: title ?? existing[idx]!.title }
    : { tokenId, title: title ?? `Corpus #${tokenId.slice(-6)}`, createdAt: Date.now() };
  const next = idx >= 0
    ? existing.map((e, i) => (i === idx ? entry : e))
    : [entry, ...existing];
  write(next);
  return entry;
}

export function renameCorpus(tokenId: string, title: string): void {
  const trimmed = title.trim().slice(0, 60);
  if (!trimmed) return;
  const next = read().map((e) =>
    e.tokenId === tokenId ? { ...e, title: trimmed } : e
  );
  write(next);
}

export function forgetCorpus(tokenId: string): void {
  write(read().filter((e) => e.tokenId !== tokenId));
}
