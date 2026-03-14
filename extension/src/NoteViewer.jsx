import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Notes } from "../storage.js";
import FlashcardViewer from "./FlashcardViewer.jsx";

const modeBadge = {
  summary:         { label: "Summary",    color: "bg-accent/15 text-accent border-accent/30" },
  explain:         { label: "Explain",    color: "bg-teal/15 text-teal border-teal/30" },
  quiz:            { label: "Quiz",       color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  flashcard:       { label: "Flashcards", color: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  session:         { label: "Session",    color: "bg-purple-500/15 text-purple-300 border-purple-500/30" },
  chat:            { label: "Notes",      color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  "audio-summary": { label: "Audio",      color: "bg-pink-500/15 text-pink-400 border-pink-500/30" },
  "audio-explain": { label: "Audio",      color: "bg-pink-500/15 text-pink-400 border-pink-500/30" },
  "audio-quiz":    { label: "Audio",      color: "bg-pink-500/15 text-pink-400 border-pink-500/30" },
};

function parseQuiz(content) {
  const pairs = [];
  const regex = /\*\*Q\d+\.\*\*\s*([\s\S]*?)\n\*\*Answer:\*\*\s*([\s\S]*?)(?=\n\*\*Q\d+\.\*\*|$)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const q = match[1].trim();
    const a = match[2].trim();
    if (q && a) pairs.push({ q, a });
  }
  return pairs.length > 0 ? pairs : null;
}

function QuizViewer({ pairs }) {
  const [revealed, setRevealed] = useState(new Set());
  function toggle(i) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }
  return (
    <div className="flex flex-col gap-4">
      {pairs.map((p, i) => (
        <div key={i} className="border border-border rounded-xl p-4 bg-surface">
          <p className="font-semibold text-text mb-3">
            <span className="text-muted text-xs font-bold uppercase mr-2">Q{i+1}</span>
            {p.q}
          </p>
          {revealed.has(i) ? (
            <div className="border-t border-border pt-3 mt-1">
              <p className="text-xs font-bold uppercase text-muted mb-1">Answer</p>
              <p className="text-sm text-text">{p.a}</p>
              <button onClick={() => toggle(i)} className="mt-2 text-xs text-muted hover:text-text transition-colors">
                Hide answer
              </button>
            </div>
          ) : (
            <button
              onClick={() => toggle(i)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-muted hover:border-accent hover:text-text transition-colors"
            >
              Show answer
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default function NoteViewer({ filename, onBack }) {
  const [note,     setNote]     = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!filename) { setNotFound(true); return; }
    Notes.get(filename).then((n) => {
      if (!n) setNotFound(true);
      else setNote(n);
    });
  }, [filename]);

  if (notFound) {
    return (
      <main className="max-w-2xl mx-auto px-5 py-8">
        <button onClick={onBack} className="text-sm text-accent hover:underline mb-6 block">← Back to notes</button>
        <p className="text-muted">Note not found.</p>
      </main>
    );
  }

  if (!note) {
    return (
      <main className="max-w-2xl mx-auto px-5 py-8">
        <p className="text-muted">Loading…</p>
      </main>
    );
  }

  const mode  = note.mode ?? "summary";
  const badge = modeBadge[mode] ?? modeBadge.summary;
  const quiz  = mode === "quiz" ? parseQuiz(note.content) : null;

  // Flashcards may be stored as the cards array directly on the note object
  const cards = note.cards ?? (mode === "flashcard" ? tryParseCards(note.content) : null);

  return (
    <main className="max-w-2xl mx-auto px-5 py-8">
      <button onClick={onBack} className="text-sm text-accent hover:underline mb-6 block">
        ← Back to notes
      </button>

      <header className="mb-7">
        <div className="flex items-start gap-3 flex-wrap">
          <h1 className="text-2xl font-extrabold text-text flex-1 leading-snug">
            {note.title ?? filename}
          </h1>
          <span className={`text-xs font-bold uppercase tracking-wide px-2 py-1 rounded-lg border shrink-0 ${badge.color}`}>
            {badge.label}
          </span>
        </div>
        <p className="text-xs text-muted mt-2">
          {new Date(note.createdAt).toLocaleString()}
        </p>
      </header>

      {mode === "flashcard" && cards ? (
        <FlashcardViewer cards={cards} />
      ) : quiz ? (
        <QuizViewer pairs={quiz} />
      ) : (
        <article className="prose">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
            {note.content}
          </ReactMarkdown>
        </article>
      )}
    </main>
  );
}

function tryParseCards(content) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed[0]?.front !== undefined) return parsed;
  } catch {}
  return null;
}
