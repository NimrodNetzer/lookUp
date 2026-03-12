"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import FlashcardViewer from "../../components/FlashcardViewer";

const GATEWAY = "http://localhost:18789";

const modeBadge: Record<string, { label: string; color: string }> = {
  summary:         { label: "Summary",    color: "bg-accent/15 text-accent border-accent/30" },
  explain:         { label: "Explain",    color: "bg-teal/15 text-teal border-teal/30" },
  quiz:            { label: "Quiz",       color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  flashcard:       { label: "Flashcards", color: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  session:         { label: "Session",    color: "bg-purple-500/15 text-purple-300 border-purple-500/30" },
  "audio-summary": { label: "Audio",      color: "bg-pink-500/15 text-pink-400 border-pink-500/30" },
  "audio-explain": { label: "Audio",      color: "bg-pink-500/15 text-pink-400 border-pink-500/30" },
  "audio-quiz":    { label: "Audio",      color: "bg-pink-500/15 text-pink-400 border-pink-500/30" },
};

function NotePageInner() {
  const searchParams = useSearchParams();
  const rawFilename = searchParams.get("file") ?? "";
  const filename = decodeURIComponent(rawFilename);

  const [content, setContent] = useState<string | null>(null);
  const [cards, setCards] = useState<{ front: string; back: string }[] | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!filename.endsWith(".md") || filename.includes("/") || filename.includes("..")) {
      setNotFound(true);
      return;
    }

    fetch(`${GATEWAY}/notes/${encodeURIComponent(filename)}`)
      .then(r => {
        if (!r.ok) { setNotFound(true); return null; }
        return r.text();
      })
      .then(text => {
        if (text === null) return;
        setContent(text);

        const modeMatch = text.match(/^mode:\s*"(.+)"/m);
        if (modeMatch?.[1] === "flashcard") {
          const cardsFilename = filename.replace(".md", ".cards.json");
          fetch(`${GATEWAY}/notes/${encodeURIComponent(cardsFilename)}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data) setCards(data); })
            .catch(() => {});
        }
      })
      .catch(() => setNotFound(true));
  }, [filename]);

  if (notFound) {
    return (
      <main className="max-w-2xl mx-auto px-5 py-8">
        <Link href="/" className="text-sm text-accent hover:underline inline-block mb-6">← Back to notes</Link>
        <p className="text-muted">Note not found.</p>
      </main>
    );
  }

  if (content === null) {
    return (
      <main className="max-w-2xl mx-auto px-5 py-8">
        <p className="text-muted">Loading…</p>
      </main>
    );
  }

  const body = content.replace(/^---[\s\S]*?---\n\n?/, "");
  const titleMatch = content.match(/^title:\s*"(.+)"/m);
  const dateMatch  = content.match(/^date:\s*"(.+)"/m);
  const modeMatch  = content.match(/^mode:\s*"(.+)"/m);
  const mode = modeMatch?.[1] ?? "summary";
  const badge = modeBadge[mode] ?? modeBadge.summary;

  return (
    <main className="max-w-2xl mx-auto px-5 py-8">
      <Link href="/" className="text-sm text-accent hover:underline inline-block mb-6">
        ← Back to notes
      </Link>

      <header className="mb-7">
        <div className="flex items-start gap-3 flex-wrap">
          <h1 className="text-2xl font-extrabold text-text flex-1 leading-snug">
            {titleMatch?.[1] ?? filename}
          </h1>
          <span className={`text-xs font-bold uppercase tracking-wide px-2 py-1 rounded-lg border shrink-0 ${badge.color}`}>
            {badge.label}
          </span>
        </div>
        {dateMatch && (
          <p className="text-xs text-muted mt-2">
            {new Date(dateMatch[1]).toLocaleString()}
          </p>
        )}
      </header>

      {mode === "flashcard" && cards ? (
        <FlashcardViewer cards={cards} />
      ) : (
        <article className="prose">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
          >
            {body}
          </ReactMarkdown>
        </article>
      )}
    </main>
  );
}

export default function NotePageClient() {
  return (
    <Suspense fallback={<main className="max-w-2xl mx-auto px-5 py-8"><p className="text-muted">Loading…</p></main>}>
      <NotePageInner />
    </Suspense>
  );
}
