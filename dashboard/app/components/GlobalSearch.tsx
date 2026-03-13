"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

const GATEWAY = "http://127.0.0.1:18789";

interface SearchResult {
  filename: string;
  title: string;
  mode: string;
  date: string;
  snippet: string;
}

const modeBadge: Record<string, string> = {
  summary: "Summary", explain: "Explain", quiz: "Quiz",
  flashcard: "Flashcards", session: "Session", chat: "Notes",
  "audio-summary": "Audio", "audio-explain": "Audio", "audio-quiz": "Audio",
};

export default function GlobalSearch({ onClose }: { onClose: () => void }) {
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`${GATEWAY}/notes/search?q=${encodeURIComponent(query.trim())}`);
        if (r.ok) setResults(await r.json());
      } catch {}
      setLoading(false);
    }, 280);
  }, [query]);

  return (
    <div className="gsearch-overlay" onClick={onClose}>
      <div className="gsearch-box" onClick={e => e.stopPropagation()}>
        <div className="gsearch-input-row">
          <svg className="gsearch-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={inputRef}
            className="gsearch-input"
            placeholder="Search all notes…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <button className="gsearch-esc" onClick={onClose}>Esc</button>
        </div>

        <div className="gsearch-results">
          {loading && <p className="gsearch-empty">Searching…</p>}
          {!loading && query.trim() && results.length === 0 && (
            <p className="gsearch-empty">No notes found for &quot;{query}&quot;</p>
          )}
          {!loading && results.map(r => (
            <Link
              key={r.filename}
              href={`/note/${encodeURIComponent(r.filename)}?file=${encodeURIComponent(r.filename)}`}
              className="gsearch-result"
              onClick={onClose}
            >
              <div className="gsearch-result-title">
                {r.title}
                <span style={{ marginLeft: 8, fontSize: 10, opacity: 0.5, fontWeight: 400 }}>
                  {modeBadge[r.mode] ?? r.mode}
                </span>
              </div>
              {r.snippet && <div className="gsearch-result-snippet">{r.snippet}</div>}
              <div className="gsearch-result-meta">{r.date ? new Date(r.date).toLocaleDateString() : ""}</div>
            </Link>
          ))}
          {!query.trim() && (
            <p className="gsearch-empty">Type to search across all note content</p>
          )}
        </div>
      </div>
    </div>
  );
}
