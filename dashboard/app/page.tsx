import fs from "fs/promises";
import path from "path";

import LearningHub from "./components/LearningHub";

export const revalidate = 0;

const NOTES_DIR = path.resolve(process.cwd(), "../notes");
const GATEWAY   = "http://127.0.0.1:18789";

async function getNotes() {
  try {
    const files = await fs.readdir(NOTES_DIR);
    return await Promise.all(
      files.filter((f) => f.endsWith(".md")).map(async (filename) => {
        const content = await fs.readFile(path.join(NOTES_DIR, filename), "utf-8");
        const stat    = await fs.stat(path.join(NOTES_DIR, filename));
        const folderIdMatch = content.match(/^folder_id:\s*"?(\d+)"?/m);
        return {
          filename,
          title:     content.match(/^title:\s*"(.+)"/m)?.[1]  ?? filename,
          mode:      content.match(/^mode:\s*"(.+)"/m)?.[1]   ?? "summary",
          course:    content.match(/^course:\s*"(.+)"/m)?.[1] ?? undefined,
          folder_id: folderIdMatch ? parseInt(folderIdMatch[1]) : undefined,
          size:      stat.size,
          modified:  stat.mtime.toISOString(),
        };
      })
    ).then((n) => n.sort((a, b) => b.modified.localeCompare(a.modified)));
  } catch { return []; }
}

async function getStats() {
  try {
    const r = await fetch(`${GATEWAY}/stats`, { cache: "no-store" });
    return r.ok ? r.json() : { totalNotes: 0, streak: 0, thisWeek: 0 };
  } catch { return { totalNotes: 0, streak: 0, thisWeek: 0 }; }
}

export default async function HomePage() {
  const [notes, stats] = await Promise.all([getNotes(), getStats()]);

  return (
    <div className="max-w-5xl mx-auto px-5 py-8">
      {/* Header */}
      <header className="mb-8 flex items-end gap-6">
        <div>
          <h1 className="text-3xl font-extrabold bg-gradient-to-r from-accent to-teal bg-clip-text text-transparent">
            LookUp
          </h1>
          <p className="text-muted text-sm mt-1">Your personal learning hub</p>
        </div>
        {/* Stats inline */}
        <div className="ml-auto flex gap-3">
          <StatPill icon="📚" label="Notes"   value={stats.totalNotes} />
          <StatPill icon="🔥" label="Streak"  value={`${stats.streak}d`} />
          <StatPill icon="⚡" label="Week"    value={stats.thisWeek} />
        </div>
      </header>

      <LearningHub notes={notes} />
    </div>
  );
}

function StatPill({ icon, label, value }: { icon: string; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2 bg-surface border border-border rounded-xl px-4 py-2.5">
      <span className="text-base leading-none">{icon}</span>
      <div>
        <p className="text-sm font-bold text-text leading-none">{value}</p>
        <p className="text-xs text-muted mt-0.5">{label}</p>
      </div>
    </div>
  );
}
