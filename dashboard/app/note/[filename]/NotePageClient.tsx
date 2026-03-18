"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

function InlineMath({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{ p: ({ children }) => <span>{children}</span> }}
    >
      {text}
    </ReactMarkdown>
  );
}
import FlashcardViewer from "../../components/FlashcardViewer";
import CosmicBg from "../../components/CosmicBg";

const GATEWAY = "http://localhost:18789";

const modeBadge: Record<string, { label: string; color: string }> = {
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

interface Message { role: "user" | "assistant"; content: string; }

function isCards(content: string): { front: string; back: string }[] | null {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.front !== undefined) return parsed;
  } catch {}
  return null;
}

function parseQuiz(content: string): { q: string; a: string }[] | null {
  const pairs: { q: string; a: string }[] = [];
  const regex = /\*\*Q\d+\.\*\*\s*([\s\S]*?)\n\*\*Answer:\*\*\s*([\s\S]*?)(?=\n\*\*Q\d+\.\*\*|$)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const q = match[1].trim();
    const a = match[2].trim();
    if (q && a) pairs.push({ q, a });
  }
  return pairs.length > 0 ? pairs : null;
}

function QuizViewer({ pairs }: { pairs: { q: string; a: string }[] }) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  function toggle(i: number) {
    setRevealed(prev => {
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
            <span className="text-muted text-xs font-bold uppercase mr-2">Q{i + 1}</span>
            <InlineMath text={p.q} />
          </p>
          {revealed.has(i) ? (
            <div className="border-t border-border pt-3 mt-1">
              <p className="text-xs font-bold uppercase text-muted mb-1">Answer</p>
              <p className="text-sm text-text"><InlineMath text={p.a} /></p>
            </div>
          ) : (
            <button
              onClick={() => toggle(i)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-muted hover:border-accent hover:text-text transition-colors"
            >
              Show answer
            </button>
          )}
          {revealed.has(i) && (
            <button
              onClick={() => toggle(i)}
              className="mt-2 text-xs text-muted hover:text-text transition-colors"
            >
              Hide answer
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function MessageBlock({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    return (
      <div className="flex gap-3 mb-6">
        <span className="shrink-0 text-xs font-bold uppercase text-muted bg-surface border border-border rounded-lg px-2 py-1 h-fit mt-0.5">You</span>
        <p className="text-sm text-text pt-1">{msg.content}</p>
      </div>
    );
  }

  const cards = isCards(msg.content);
  if (cards) {
    return (
      <div className="mb-8">
        <p className="text-xs font-bold uppercase text-orange-400 mb-3">Flashcards</p>
        <FlashcardViewer cards={cards} />
      </div>
    );
  }

  const quiz = parseQuiz(msg.content);
  if (quiz) {
    return (
      <div className="mb-8">
        <p className="text-xs font-bold uppercase text-amber-400 mb-3">Quiz</p>
        <QuizViewer pairs={quiz} />
      </div>
    );
  }

  return (
    <div className="mb-8">
      <article className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {msg.content}
        </ReactMarkdown>
      </article>
    </div>
  );
}

function NotePageInner() {
  const searchParams = useSearchParams();
  const rawFilename = searchParams.get("file") ?? "";
  const filename = decodeURIComponent(rawFilename);

  const [content, setContent] = useState<string | null>(null);
  const [cards, setCards] = useState<{ front: string; back: string }[] | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [quiz, setQuiz] = useState<{ q: string; a: string }[] | null>(null);
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
        const mode = modeMatch?.[1];

        if (mode === "flashcard") {
          const cardsFilename = filename.replace(".md", ".cards.json");
          fetch(`${GATEWAY}/notes/${encodeURIComponent(cardsFilename)}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data) setCards(data); })
            .catch(() => {});
        }

        if (mode === "chat") {
          const convIdMatch = text.match(/^conversation_id:\s*"?(\d+)"?/m);
          if (convIdMatch?.[1]) {
            fetch(`${GATEWAY}/conversations/${convIdMatch[1]}`)
              .then(r => r.ok ? r.json() : null)
              .then(data => { if (data?.messages) setMessages(data.messages); })
              .catch(() => {});
          }
        }

        if (mode === "quiz") {
          const body = text.replace(/^---[\s\S]*?---\n\n?/, "");
          const quiz = parseQuiz(body);
          if (quiz) setQuiz(quiz);
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

      {mode === "chat" && messages ? (
        <div>
          {messages.map((msg, i) => <MessageBlock key={i} msg={msg} />)}
        </div>
      ) : mode === "flashcard" && cards ? (
        <FlashcardViewer cards={cards} />
      ) : mode === "quiz" && quiz ? (
        <QuizViewer pairs={quiz} />
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
    <>
      <CosmicBg />
      <div className="relative z-10">
        <Suspense fallback={<main className="max-w-2xl mx-auto px-5 py-8"><p className="text-muted">Loading…</p></main>}>
          <NotePageInner />
        </Suspense>
      </div>
    </>
  );
}
