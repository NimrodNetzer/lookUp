import { useState, useEffect, useRef } from "react";
import { Notes } from "../storage.js";

const modeBadge = {
  summary: "Summary", explain: "Explain", quiz: "Quiz",
  flashcard: "Flashcards", session: "Session", chat: "Notes",
  "audio-summary": "Audio", "audio-explain": "Audio", "audio-quiz": "Audio",
};

export default function GlobalSearch({ onClose, onOpenNote }) {
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const found = await Notes.search(query.trim());
        setResults(found);
      } catch {}
      setLoading(false);
    }, 280);
  }, [query]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <svg className="w-4 h-4 text-muted shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm text-text placeholder-muted outline-none"
            placeholder="Search all notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button onClick={onClose} className="text-xs text-muted border border-border rounded px-2 py-0.5 hover:text-text transition-colors">Esc</button>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {loading && <p className="text-sm text-muted px-5 py-4">Searching…</p>}
          {!loading && query.trim() && results.length === 0 && (
            <p className="text-sm text-muted px-5 py-4">No notes found for "{query}"</p>
          )}
          {!loading && results.map((r) => (
            <button
              key={r.filename}
              className="w-full text-left px-5 py-3.5 hover:bg-accent/10 transition-colors border-b border-border last:border-b-0"
              onClick={() => { onOpenNote(r.filename); onClose(); }}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text truncate">{r.title ?? r.filename}</span>
                <span className="text-xs text-muted/60 shrink-0">{modeBadge[r.mode] ?? r.mode}</span>
              </div>
              <p className="text-xs text-muted mt-0.5">
                {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ""}
              </p>
            </button>
          ))}
          {!query.trim() && (
            <p className="text-sm text-muted px-5 py-4">Type to search across all note content</p>
          )}
        </div>
      </div>
    </div>
  );
}
