"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, FileText, Mic, Layers, BookOpen, HelpCircle, CreditCard, FolderSymlink, GitMerge, Trash2 } from "lucide-react";
import clsx from "clsx";

const GATEWAY = "http://127.0.0.1:18789";

interface Note {
  filename: string;
  title?: string;
  mode?: string;
  course?: string;
  folder_id?: number;
  size: number;
  modified: string;
}

type DateFilter = "today" | "week" | "month" | "all";
type SortMode   = "date" | "alpha";

const GROUP_CONFIG = {
  summary:   { label: "Summary",    icon: "📄", color: "bg-accent/20 text-accent border-accent/30",             Icon: FileText   },
  explain:   { label: "Explain",    icon: "📖", color: "bg-teal/20 text-teal border-teal/30",                   Icon: BookOpen   },
  quiz:      { label: "Quiz",       icon: "❓", color: "bg-amber-500/20 text-amber-400 border-amber-500/30",    Icon: HelpCircle },
  flashcard: { label: "Flashcards", icon: "🃏", color: "bg-orange-500/20 text-orange-400 border-orange-500/30", Icon: CreditCard },
  session:   { label: "Session",    icon: "📚", color: "bg-purple-500/20 text-purple-300 border-purple-500/30", Icon: Layers     },
  audio:     { label: "Audio",      icon: "🎙️", color: "bg-pink-500/20 text-pink-400 border-pink-500/30",       Icon: Mic        },
} as const;

const GROUP_ORDER = ["summary", "explain", "quiz", "flashcard", "session", "audio"] as const;
type GroupKey = typeof GROUP_ORDER[number];

function getGroupKey(mode: string | undefined): GroupKey {
  if (!mode) return "summary";
  if (mode.startsWith("audio")) return "audio";
  return (GROUP_ORDER as readonly string[]).includes(mode) ? (mode as GroupKey) : "summary";
}

const DATE_LABELS: Record<DateFilter, string> = {
  today: "Today",
  week:  "This week",
  month: "This month",
  all:   "All time",
};

// ── Move-to inline form ───────────────────────────────────────────────────────
function MoveToButton({ note, courses, onRefresh }: { note: Note; courses: string[]; onRefresh: () => void }) {
  const [open,    setOpen]    = useState(false);
  const [val,     setVal]     = useState(note.course ?? "");
  const [saving,  setSaving]  = useState(false);

  async function save() {
    if (!val.trim()) return;
    setSaving(true);
    try {
      await fetch(`${GATEWAY}/notes/${encodeURIComponent(note.filename)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ course: val.trim() }),
      });
      onRefresh();
      setOpen(false);
    } catch {}
    setSaving(false);
  }

  if (!open) {
    return (
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        title="Move to course"
        className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-xs text-muted hover:text-accent transition-all px-2 py-0.5 rounded border border-transparent hover:border-accent/30"
      >
        <FolderSymlink className="w-3 h-3" />
        <span>{note.course ? "Move" : "Assign"}</span>
      </button>
    );
  }

  return (
    <div
      className="flex items-center gap-1"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <input
        autoFocus
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Course name…"
        list="course-list"
        className="w-28 text-xs bg-bg border border-accent/50 rounded px-2 py-0.5 text-text outline-none"
      />
      <datalist id="course-list">
        {courses.map((c) => <option key={c} value={c} />)}
      </datalist>
      <button
        onClick={save}
        disabled={saving}
        className="text-xs text-teal hover:text-teal/70 font-bold disabled:opacity-40"
      >✓</button>
      <button
        onClick={() => setOpen(false)}
        className="text-xs text-muted hover:text-text"
      >✕</button>
    </div>
  );
}

// ── Delete button ─────────────────────────────────────────────────────────────
function DeleteButton({ note, onRefresh }: { note: Note; onRefresh: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch(`${GATEWAY}/notes/${encodeURIComponent(note.filename)}`, { method: "DELETE" });
      onRefresh();
    } catch {}
    setDeleting(false);
  }

  if (!confirm) {
    return (
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirm(true); }}
        title="Delete note"
        className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-xs text-muted hover:text-red-400 transition-all px-2 py-0.5 rounded border border-transparent hover:border-red-400/30"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    );
  }

  return (
    <div
      className="flex items-center gap-1"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <span className="text-xs text-red-400">Delete?</span>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="text-xs text-red-400 hover:text-red-300 font-bold disabled:opacity-40"
      >✓</button>
      <button
        onClick={() => setConfirm(false)}
        className="text-xs text-muted hover:text-text"
      >✕</button>
    </div>
  );
}

// ── Merge bar ─────────────────────────────────────────────────────────────────
function MergeBar({
  selected, onClear, onMerge,
}: {
  selected: Set<string>;
  onClear: () => void;
  onMerge: (title: string) => Promise<void>;
}) {
  const [title,   setTitle]   = useState("");
  const [loading, setLoading] = useState(false);

  async function handleMerge() {
    setLoading(true);
    await onMerge(title.trim());
    setLoading(false);
    setTitle("");
  }

  return (
    <div className="sticky top-0 z-10 mb-4 flex items-center gap-2 bg-surface border border-accent/40 rounded-xl px-4 py-3 shadow-lg">
      <GitMerge className="w-4 h-4 text-accent shrink-0" />
      <span className="text-xs font-semibold text-accent">{selected.size} selected</span>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleMerge(); }}
        placeholder="Merged note title (optional)…"
        className="flex-1 bg-bg border border-border rounded-lg px-3 py-1.5 text-xs text-text placeholder:text-muted outline-none focus:border-accent transition-colors min-w-0"
      />
      <button
        onClick={handleMerge}
        disabled={loading || selected.size < 2}
        className="px-3 py-1.5 text-xs font-semibold bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-40 transition-colors shrink-0"
      >
        {loading ? "Merging…" : "Merge"}
      </button>
      <button
        onClick={onClear}
        className="text-xs text-muted hover:text-text transition-colors shrink-0"
      >
        Cancel
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function NotesList({ notes, onRefresh }: { notes: Note[]; onRefresh: () => void }) {
  const [query,          setQuery]          = useState("");
  const [dateFilter,     setDateFilter]     = useState<DateFilter>("all");
  const [sortMode,       setSortMode]       = useState<SortMode>("date");
  const [expandedGroups, setExpandedGroups] = useState<Set<GroupKey>>(new Set());
  const [showRange,      setShowRange]      = useState(false);
  const [rangeFrom,      setRangeFrom]      = useState("");
  const [rangeTo,        setRangeTo]        = useState("");
  const [selectMode,     setSelectMode]     = useState(false);
  const [selected,       setSelected]       = useState<Set<string>>(new Set());
  const [mergeError,     setMergeError]     = useState<string | null>(null);

  const courses = useMemo(
    () => Array.from(new Set(notes.map((n) => n.course).filter(Boolean) as string[])).sort(),
    [notes]
  );

  const groups = useMemo(() => {
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const filtered = notes.filter((n) => {
      const d = new Date(n.modified);
      if (showRange && (rangeFrom || rangeTo)) {
        if (rangeFrom && d < new Date(rangeFrom))               return false;
        if (rangeTo   && d > new Date(rangeTo + "T23:59:59"))   return false;
      } else {
        if (dateFilter === "today" && d < today)                                      return false;
        if (dateFilter === "week"  && d < new Date(today.getTime() - 6  * 86400000)) return false;
        if (dateFilter === "month" && d < new Date(today.getTime() - 29 * 86400000)) return false;
      }
      if (query.trim()) {
        const q = query.toLowerCase();
        return (
          (n.title ?? n.filename).toLowerCase().includes(q) ||
          (n.mode ?? "").toLowerCase().includes(q) ||
          (n.course ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });

    const map = new Map<GroupKey, Note[]>();
    for (const n of filtered) {
      const key = getGroupKey(n.mode);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    }
    Array.from(map.values()).forEach((arr) => {
      if (sortMode === "date") arr.sort((a, b) => b.modified.localeCompare(a.modified));
      else arr.sort((a, b) => (a.title ?? a.filename).localeCompare(b.title ?? b.filename));
    });
    return GROUP_ORDER.filter((k) => map.has(k)).map((k) => ({ key: k, notes: map.get(k)! }));
  }, [notes, dateFilter, sortMode, query, rangeFrom, rangeTo, showRange]);

  const totalVisible = groups.reduce((s, g) => s + g.notes.length, 0);

  function toggleGroup(key: GroupKey) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function selectDateFilter(f: DateFilter) {
    setDateFilter(f);
    setShowRange(false);
    setRangeFrom("");
    setRangeTo("");
  }

  function toggleSelectMode() {
    setSelectMode((s) => !s);
    setSelected(new Set());
    setMergeError(null);
  }

  function toggleNote(filename: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename); else next.add(filename);
      return next;
    });
  }

  async function handleMerge(title: string) {
    setMergeError(null);
    try {
      const res = await fetch(`${GATEWAY}/notes/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filenames: Array.from(selected), title: title || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Merge failed");
      setSelectMode(false);
      setSelected(new Set());
      onRefresh();
    } catch (err: unknown) {
      setMergeError(err instanceof Error ? err.message : "Merge failed");
    }
  }

  return (
    <div>
      {/* Date filter + sort */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(Object.keys(DATE_LABELS) as DateFilter[]).map((f) => (
          <button key={f} onClick={() => selectDateFilter(f)}
            className={clsx("px-3 py-1 text-xs font-semibold rounded-full border transition-colors",
              !showRange && dateFilter === f
                ? "bg-accent/20 border-accent/50 text-accent"
                : "border-border text-muted hover:border-accent/40 hover:text-text"
            )}>
            {DATE_LABELS[f]}
          </button>
        ))}
        <button onClick={() => setShowRange((s) => !s)}
          className={clsx("px-3 py-1 text-xs font-semibold rounded-full border transition-colors",
            showRange ? "bg-accent/20 border-accent/50 text-accent" : "border-border text-muted hover:border-accent/40 hover:text-text"
          )}>
          📅 Range
        </button>
        <button onClick={toggleSelectMode}
          className={clsx("px-3 py-1 text-xs font-semibold rounded-full border transition-colors flex items-center gap-1",
            selectMode ? "bg-accent/20 border-accent/50 text-accent" : "border-border text-muted hover:border-accent/40 hover:text-text"
          )}>
          <GitMerge className="w-3 h-3" />
          {selectMode ? "Cancel" : "Select & Merge"}
        </button>
        <div className="ml-auto flex rounded-lg overflow-hidden border border-border">
          {(["date", "alpha"] as SortMode[]).map((s) => (
            <button key={s} onClick={() => setSortMode(s)}
              className={clsx("px-3 py-1 text-xs font-semibold transition-colors",
                sortMode === s ? "bg-accent/20 text-accent" : "text-muted hover:text-text"
              )}>
              {s === "date" ? "Date" : "A–Z"}
            </button>
          ))}
        </div>
      </div>

      {showRange && (
        <div className="flex flex-wrap items-center gap-3 mb-3 px-4 py-3 bg-surface border border-border rounded-xl">
          <span className="text-xs text-muted">From</span>
          <input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)}
            className="text-xs bg-bg border border-border rounded-lg px-2 py-1 text-text outline-none focus:border-accent" />
          <span className="text-xs text-muted">to</span>
          <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)}
            className="text-xs bg-bg border border-border rounded-lg px-2 py-1 text-text outline-none focus:border-accent" />
          <button onClick={() => { setRangeFrom(""); setRangeTo(""); }}
            className="text-xs text-muted hover:text-text ml-auto transition-colors">Clear</button>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted w-4 h-4" />
        <input type="text" placeholder="Search notes…" value={query} onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text placeholder:text-muted outline-none focus:border-accent transition-colors" />
      </div>

      {/* Merge bar */}
      {selectMode && selected.size >= 2 && (
        <MergeBar selected={selected} onClear={toggleSelectMode} onMerge={handleMerge} />
      )}
      {mergeError && (
        <p className="text-xs text-red-400 mb-3 px-1">{mergeError}</p>
      )}

      {/* Empty state */}
      {groups.length === 0 ? (
        <div className="text-center py-16 text-muted text-sm border border-dashed border-border rounded-xl">
          {query ? `No notes matching "${query}"` : "No notes for this period — capture something!"}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted mb-4">
            {totalVisible} note{totalVisible !== 1 ? "s" : ""} · {groups.length} type{groups.length !== 1 ? "s" : ""}
          </p>
          <div className="flex flex-col gap-3">
            {groups.map(({ key, notes: groupNotes }) => {
              const cfg      = GROUP_CONFIG[key];
              const expanded = expandedGroups.has(key);
              return (
                <div key={key} className="border border-border rounded-xl overflow-hidden">
                  <button onClick={() => toggleGroup(key)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 bg-surface hover:bg-surface/70 transition-colors">
                    <div className={clsx("p-1.5 rounded-lg border text-base leading-none shrink-0", cfg.color)}>
                      {cfg.icon}
                    </div>
                    <span className="text-sm font-semibold text-text">{cfg.label}</span>
                    <span className="text-xs text-muted">{groupNotes.length} note{groupNotes.length !== 1 ? "s" : ""}</span>
                    <span className={clsx("ml-auto text-muted text-sm transition-transform duration-200", expanded ? "rotate-90" : "")}>▸</span>
                  </button>

                  {expanded && (
                    <div className="border-t border-border">
                      {groupNotes.map((note) => (
                        <div key={note.filename}
                          draggable={!selectMode}
                          onDragStart={(e) => { e.dataTransfer.setData("text/plain", note.filename); e.dataTransfer.effectAllowed = "move"; }}
                          onClick={selectMode ? () => toggleNote(note.filename) : undefined}
                          className={clsx(
                            "group flex items-center gap-3 px-4 py-3 hover:bg-surface/40 transition-colors border-b border-border last:border-b-0",
                            !selectMode && "cursor-grab active:cursor-grabbing",
                            selectMode && "cursor-pointer",
                            selectMode && selected.has(note.filename) && "bg-accent/10"
                          )}>
                          {selectMode && (
                            <input
                              type="checkbox"
                              readOnly
                              checked={selected.has(note.filename)}
                              className="w-4 h-4 accent-[#7c6af5] shrink-0 pointer-events-none"
                            />
                          )}
                          <Link
                            href={selectMode ? "#" : `/note/${encodeURIComponent(note.filename)}`}
                            onClick={selectMode ? (e) => e.preventDefault() : undefined}
                            className="flex-1 min-w-0"
                          >
                            <p className="text-sm font-medium text-text truncate">{note.title ?? note.filename}</p>
                            <p className="text-xs text-muted mt-0.5 flex items-center gap-2">
                              <span>{new Date(note.modified).toLocaleString()}</span>
                              <span>·</span>
                              <span>{(note.size / 1024).toFixed(1)} KB</span>
                              {note.course && (
                                <>
                                  <span>·</span>
                                  <span className="text-accent/70 font-medium">{note.course}</span>
                                </>
                              )}
                            </p>
                          </Link>
                          {!selectMode && (
                            <>
                              <MoveToButton note={note} courses={courses} onRefresh={onRefresh} />
                              <DeleteButton note={note} onRefresh={onRefresh} />
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
