import fs from "fs/promises";
import path from "path";
import Link from "next/link";

const NOTES_DIR = path.resolve(process.cwd(), "../notes");

interface NoteFile {
  filename: string;
  title: string;
  date: string;
  mode: string;
  size: number;
}

async function getNotes(): Promise<NoteFile[]> {
  try {
    const files = await fs.readdir(NOTES_DIR);
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    const notes = await Promise.all(
      mdFiles.map(async (filename) => {
        const content = await fs.readFile(path.join(NOTES_DIR, filename), "utf-8");
        const stat = await fs.stat(path.join(NOTES_DIR, filename));

        // Parse frontmatter
        const titleMatch = content.match(/^title:\s*"(.+)"/m);
        const dateMatch = content.match(/^date:\s*"(.+)"/m);
        const modeMatch = content.match(/^mode:\s*"(.+)"/m);

        return {
          filename,
          title: titleMatch?.[1] ?? filename,
          date: dateMatch?.[1] ?? "",
          mode: modeMatch?.[1] ?? "summary",
          size: stat.size,
        };
      })
    );

    return notes.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch {
    return [];
  }
}

const modeColors: Record<string, string> = {
  summary: "#7c6af5",
  explain: "#5eead4",
  quiz: "#f59e0b",
};

export default async function HomePage() {
  const notes = await getNotes();

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "32px 20px" }}>
      <header style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            background: "linear-gradient(135deg, #7c6af5, #5eead4)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            marginBottom: 6,
          }}
        >
          LookUp — Study Sensei
        </h1>
        <p style={{ color: "#888", fontSize: 14 }}>
          {notes.length} note{notes.length !== 1 ? "s" : ""} saved
        </p>
      </header>

      {notes.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            color: "#555",
            border: "1px dashed #2a2a3e",
            borderRadius: 12,
          }}
        >
          <p style={{ fontSize: 16, marginBottom: 8 }}>No notes yet.</p>
          <p style={{ fontSize: 13 }}>
            Use the Chrome Extension to capture your first screen.
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 12 }}>
          {notes.map((note) => (
            <li key={note.filename}>
              <Link
                href={`/note/${encodeURIComponent(note.filename)}`}
                style={{
                  display: "block",
                  background: "#1a1a2e",
                  border: "1px solid #2a2a3e",
                  borderRadius: 12,
                  padding: "16px 20px",
                  transition: "border-color 0.2s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      background: modeColors[note.mode] ?? "#7c6af5",
                      color: "#fff",
                    }}
                  >
                    {note.mode}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#e8e8f0" }}>
                    {note.title}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#666" }}>
                  {note.date ? new Date(note.date).toLocaleString() : ""}
                  {" · "}
                  {(note.size / 1024).toFixed(1)} KB
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
