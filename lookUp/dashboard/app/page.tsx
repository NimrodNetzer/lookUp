import fs from "fs/promises";
import path from "path";
import { BookOpen, Flame, Calendar, Zap, type LucideIcon } from "lucide-react";
import NotesList from "./components/NotesList";
import Heatmap from "./components/Heatmap";

export const revalidate = 0; // always fresh

const NOTES_DIR = path.resolve(process.cwd(), "../notes");
const GATEWAY   = "http://127.0.0.1:18789";

async function getNotes() {
  try {
    const files = await fs.readdir(NOTES_DIR);
    return await Promise.all(
      files.filter((f) => f.endsWith(".md")).map(async (filename) => {
        const content = await fs.readFile(path.join(NOTES_DIR, filename), "utf-8");
        const stat    = await fs.stat(path.join(NOTES_DIR, filename));
        return {
          filename,
          title:    content.match(/^title:\s*"(.+)"/m)?.[1] ?? filename,
          mode:     content.match(/^mode:\s*"(.+)"/m)?.[1]  ?? "summary",
          size:     stat.size,
          modified: stat.mtime.toISOString(),
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

async function getActivity() {
  try {
    const r = await fetch(`${GATEWAY}/activity`, { cache: "no-store" });
    return r.ok ? r.json() : [];
  } catch { return []; }
}

function StatCard({
  icon: Icon, label, value, color,
}: { icon: LucideIcon; label: string; value: string | number; color: string }) {
  return (
    <div className="flex items-center gap-3 bg-surface border border-border rounded-xl p-4">
      <div className={`p-2 rounded-lg ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-xl font-bold text-text leading-none">{value}</p>
        <p className="text-xs text-muted mt-0.5">{label}</p>
      </div>
    </div>
  );
}

export default async function HomePage() {
  const [notes, stats, activity] = await Promise.all([getNotes(), getStats(), getActivity()]);

  return (
    <main className="max-w-3xl mx-auto px-5 py-8">

      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold bg-gradient-to-r from-accent to-teal bg-clip-text text-transparent">
          LookUp
        </h1>
        <p className="text-muted text-sm mt-1">Your personal study knowledge base</p>
      </header>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <StatCard icon={BookOpen} label="Total notes"   value={stats.totalNotes} color="bg-accent/15 text-accent" />
        <StatCard icon={Flame}    label="Day streak"    value={stats.streak}     color="bg-orange-500/15 text-orange-400" />
        <StatCard icon={Zap}      label="This week"     value={stats.thisWeek}   color="bg-teal/15 text-teal" />
      </div>

      {/* Heatmap */}
      <section className="bg-surface border border-border rounded-xl p-5 mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-4 h-4 text-muted" />
          <h2 className="text-sm font-semibold text-text">Capture Activity</h2>
          <span className="ml-auto text-xs text-muted">Last 365 days</span>
        </div>
        <Heatmap data={activity} />
      </section>

      {/* Notes list with search */}
      <section>
        <h2 className="text-sm font-semibold text-muted uppercase tracking-widest mb-4">
          Notes — {notes.length}
        </h2>
        <NotesList notes={notes} />
      </section>

    </main>
  );
}
