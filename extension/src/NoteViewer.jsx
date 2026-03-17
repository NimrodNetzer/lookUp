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
  mixed:           { label: "Mixed",      color: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
};

const sectionBadge = {
  flashcard: { label: "🃏 Flashcards", color: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  quiz:      { label: "❓ Quiz",       color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  text:      { label: "📄 Notes",      color: "bg-accent/15 text-accent border-accent/30" },
};

function tryParseCards(content) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed[0]?.front !== undefined) return parsed;
  } catch {}
  return null;
}

function parseQuiz(content) {
  const pairs = [];
  // Covers: **Q1.** / **Q1:** / **Question 1.** / **1.**  +  **Answer:** / **A:** / **A.**
  const regex = /\*\*(?:Q(?:uestion)?\s*\d+[.:]?|\d+\.)\*\*\s*([\s\S]*?)\n\*\*(?:Answer|A)[.:]\*\*\s*([\s\S]*?)(?=\n\*\*(?:Q(?:uestion)?\s*\d+[.:]?|\d+\.)\*\*|$)/gi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const q = match[1].trim();
    const a = match[2].trim();
    if (q && a) pairs.push({ q, a });
  }
  return pairs.length > 0 ? pairs : null;
}

function detectType(text) {
  if (tryParseCards(text)) return "flashcard";
  if (parseQuiz(text)) return "quiz";
  return "text";
}

function QuizViewer({ pairs }) {
  return (
    <div className="flex flex-col gap-4">
      {pairs.map((p, i) => (
        <div key={i} className="border border-border rounded-xl p-4 bg-surface">
          <p className="font-semibold text-text mb-3">
            <span className="text-muted text-xs font-bold uppercase mr-2">Q{i+1}</span>
            {p.q}
          </p>
          <div className="border-t border-border pt-3 mt-1">
            <p className="text-xs font-bold uppercase text-muted mb-1">Answer</p>
            <p className="text-sm text-text">{p.a}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionBlock({ heading, type, children }) {
  const badge = sectionBadge[type];
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {heading && <span className="text-sm font-semibold text-text">{heading}</span>}
        <span className={`text-xs font-bold px-2 py-0.5 rounded-lg border ${badge.color}`}>{badge.label}</span>
      </div>
      {children}
    </div>
  );
}

function SectionContent({ text, showBadge }) {
  const headingMatch = text.match(/^###\s+(.+)\n\n([\s\S]*)$/);
  const heading = headingMatch?.[1] ?? null;
  const body = headingMatch ? headingMatch[2].trim() : text;

  const cards = tryParseCards(body);
  if (cards) {
    return showBadge ? (
      <SectionBlock heading={heading} type="flashcard"><FlashcardViewer cards={cards} /></SectionBlock>
    ) : <FlashcardViewer cards={cards} />;
  }
  const quiz = parseQuiz(body);
  if (quiz) {
    return showBadge ? (
      <SectionBlock heading={heading} type="quiz"><QuizViewer pairs={quiz} /></SectionBlock>
    ) : <QuizViewer pairs={quiz} />;
  }
  return showBadge ? (
    <SectionBlock heading={heading} type="text">
      <article className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{body}</ReactMarkdown>
      </article>
    </SectionBlock>
  ) : (
    <article className="prose">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{body}</ReactMarkdown>
    </article>
  );
}

function downloadNote(note, filename) {
  const blob = new Blob([note.content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/\.md$/, "") + ".md";
  a.click();
  URL.revokeObjectURL(url);
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

  // Split into sections if content was merged from multiple captures
  const sections = note.content.split(/\n\n---\n\n/);
  const isMultiSection = sections.length > 1;

  // Determine badge: "mixed" if multiple section types exist, otherwise use note.mode
  let badgeKey = note.mode ?? "summary";
  if (isMultiSection) {
    const types = new Set(sections.map((s) => {
      const body = s.match(/^###\s+.+\n\n([\s\S]*)$/)?.[1]?.trim() ?? s.trim();
      return detectType(body);
    }));
    if (types.size > 1) badgeKey = "mixed";
  }
  const badge = modeBadge[badgeKey] ?? modeBadge.summary;

  return (
    <main className="max-w-2xl mx-auto px-5 py-8">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <button onClick={onBack} className="text-sm text-accent hover:underline">← Back to notes</button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadNote(note, filename)}
            className="text-xs text-muted hover:text-text border border-border hover:border-accent/40 px-3 py-1.5 rounded-lg transition-colors"
            title="Download as Markdown"
          >
            ↓ Export .md
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-text border border-border hover:border-accent/40 px-3 py-1.5 rounded-lg transition-colors"
            title="Export to PDF"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
            </svg>
            Export PDF
          </button>
        </div>
      </div>

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

      {isMultiSection ? (
        <div className="flex flex-col gap-8">
          {sections.map((section, i) => (
            <div key={i}>
              <SectionContent text={section.trim()} showBadge={true} />
              {i < sections.length - 1 && <hr className="border-border mt-8" />}
            </div>
          ))}
        </div>
      ) : (
        <SectionContent text={note.content} showBadge={false} />
      )}
    </main>
  );
}
