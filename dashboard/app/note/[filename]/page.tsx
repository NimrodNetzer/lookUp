import fs from "fs/promises";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import FlashcardViewer from "../../components/FlashcardViewer";

const NOTES_DIR = path.resolve(process.cwd(), "../notes");

export default async function NotePage({
  params,
}: {
  params: { filename: string };
}) {
  const filename = decodeURIComponent(params.filename);

  if (!filename.endsWith(".md") || filename.includes("/") || filename.includes("..")) {
    notFound();
  }

  let content: string;
  try {
    content = await fs.readFile(path.join(NOTES_DIR, filename), "utf-8");
  } catch {
    notFound();
  }

  const body = content.replace(/^---[\s\S]*?---\n\n?/, "");
  const titleMatch = content.match(/^title:\s*"(.+)"/m);
  const dateMatch  = content.match(/^date:\s*"(.+)"/m);
  const modeMatch  = content.match(/^mode:\s*"(.+)"/m);
  const mode = modeMatch?.[1] ?? "summary";

  // For flashcard notes, try to load the companion .cards.json
  let cards: { front: string; back: string }[] | null = null;
  if (mode === "flashcard") {
    const cardsFilename = filename.replace(".md", ".cards.json");
    try {
      const cardsRaw = await fs.readFile(path.join(NOTES_DIR, cardsFilename), "utf-8");
      cards = JSON.parse(cardsRaw);
    } catch { /* no companion file — fall back to markdown */ }
  }

  const modeBadge: Record<string, { label: string; color: string }> = {
    summary:        { label: "Summary",    color: "bg-accent/15 text-accent border-accent/30" },
    explain:        { label: "Explain",    color: "bg-teal/15 text-teal border-teal/30" },
    quiz:           { label: "Quiz",       color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    flashcard:      { label: "Flashcards", color: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
    session:        { label: "Session",    color: "bg-purple-500/15 text-purple-300 border-purple-500/30" },
    "audio-summary":{ label: "Audio",      color: "bg-pink-500/15 text-pink-400 border-pink-500/30" },
    "audio-explain":{ label: "Audio",      color: "bg-pink-500/15 text-pink-400 border-pink-500/30" },
    "audio-quiz":   { label: "Audio",      color: "bg-pink-500/15 text-pink-400 border-pink-500/30" },
  };
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
            rehypePlugins={[rehypeKatex, rehypeHighlight]}
          >
            {body}
          </ReactMarkdown>
        </article>
      )}
    </main>
  );
}
