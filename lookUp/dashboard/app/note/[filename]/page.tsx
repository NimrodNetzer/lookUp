import fs from "fs/promises";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";

const NOTES_DIR = path.resolve(process.cwd(), "../notes");

export default async function NotePage({
  params,
}: {
  params: { filename: string };
}) {
  const filename = decodeURIComponent(params.filename);

  // Security: prevent path traversal
  if (!filename.endsWith(".md") || filename.includes("/") || filename.includes("..")) {
    notFound();
  }

  let content: string;
  try {
    content = await fs.readFile(path.join(NOTES_DIR, filename), "utf-8");
  } catch {
    notFound();
  }

  // Strip frontmatter for display
  const body = content.replace(/^---[\s\S]*?---\n\n?/, "");
  const titleMatch = content.match(/^title:\s*"(.+)"/m);
  const dateMatch = content.match(/^date:\s*"(.+)"/m);

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "32px 20px" }}>
      <Link
        href="/"
        style={{ fontSize: 13, color: "#7c6af5", display: "inline-block", marginBottom: 24 }}
      >
        ← Back to notes
      </Link>

      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>
          {titleMatch?.[1] ?? filename}
        </h1>
        {dateMatch && (
          <p style={{ fontSize: 13, color: "#666" }}>
            {new Date(dateMatch[1]).toLocaleString()}
          </p>
        )}
      </header>

      <article className="prose">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, rehypeHighlight]}
        >
          {body}
        </ReactMarkdown>
      </article>
    </main>
  );
}
