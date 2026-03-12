"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { Search, FileText, Mic, Layers, BookOpen, HelpCircle, CreditCard, FolderSymlink, GitMerge, Trash2, Pencil } from "lucide-react";
import clsx from "clsx";
import { FolderNode } from "./FolderTree";

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

// ── Flatten folder tree ────────────────────────────────────────────────────────
function flattenFolders(nodes: FolderNode[], depth = 0): { folder: FolderNode; depth: number }[] {
  return nodes.flatMap((n) => [{ folder: n, depth }, ...flattenFolders(n.children, depth + 1)]);
}

// ── Right-click context menu ───────────────────────────────────────────────────
function ContextMenu({
  note, x, y, folders, onClose, onStartRename, onAssign,
}: {
  note: Note;
  x: number;
  y: number;
  folders: FolderNode[];
  onClose: () => void;
  onStartRename: () => void;
  onAssign: (folderId: number | null) => void;
}) {
  const [view, setView] = useState<"menu" | "folders">("menu");
  const ref = useRef<HTMLDivElement>(null);
  const flatFolders = useMemo(() => flattenFolders(folders), [folders]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Nudge menu inside viewport
  const [pos, setPos] = useState({ top: y, left: x });
  useEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    setPos({
      top:  Math.min(y, window.innerHeight - height - 8),
      left: Math.min(x, window.innerWidth  - width  - 8),
    });
  }, [x, y, view]);

  return (
    <div
      ref={ref}
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
      className="bg-surface border border-border rounded-xl shadow-2xl overflow-hidden min-w-[190px]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {view === "menu" ? (
        <div className="py-1">
          <button
            onClick={() => { onStartRename(); onClose(); }}
            className="w-full text-left px-4 py-2.5 text-sm text-text hover:bg-accent/10 flex items-center gap-2.5 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5 text-muted" />
            Rename
          </button>
          <button
            onClick={() => setView("folders")}
            className="w-full text-left px-4 py-2.5 text-sm text-text hover:bg-accent/10 flex items-center gap-2.5 transition-colors"
          >
            <FolderSymlink className="w-3.5 h-3.5 text-muted" />
            Assign to folder
          </button>
        </div>
      ) : (
        <>
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <button
              onClick={() => setView("menu")}
              className="text-muted hover:text-text text-sm leading-none px-0.5 transition-colors"
            >
              ←
            </button>
            <span className="text-xs font-semibold text-muted uppercase tracking-widest">Assign to folder</span>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            <button
              onClick={() => { onAssign(null); onClose(); }}
              className={clsx(
                "w-full text-left px-4 py-2 text-sm hover:bg-accent/10 transition-colors italic",
                !note.folder_id ? "text-accent font-semibold" : "text-muted"
              )}
            >
              None (unattached)
            </button>
            {flatFolders.map(({ folder, depth }) => (
              <button
                key={folder.id}
                onClick={() => { onAssign(folder.id); onClose(); }}
                style={{ paddingLeft: `${16 + depth * 14}px` }}
                className={clsx(
                  "w-full text-left text-sm py-2 pr-3 hover:bg-accent/10 transition-colors flex items-center gap-1.5",
                  note.folder_id === folder.id ? "text-accent font-semibold" : "text-text"
                )}
              >
                📁 {folder.name}
              </button>
            ))}
            {flatFolders.length === 0 && (
              <p className="text-xs text-muted px-4 py-3">No folders yet</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Delete button ─────────────────────────────────────────────────────────────
function DeleteButton({ note, onRefresh }: { note: Note; onRefresh: () => void }) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(true);
    try {
      await fetch(`${GATEWAY}/notes/${encodeURIComponent(note.filename)}`, { method: "DELETE" });
      onRefresh();
    } catch {}
    setDeleting(false);
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      title="Delete note"
      className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-muted hover:text-red-400 disabled:opacity-40 transition-all px-2 py-0.5 rounded border border-transparent hover:border-red-400/30"
    >
      <Trash2 className="w-4 h-4" />
    </button>
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

// ── Inline rename input ────────────────────────────────────────────────────────
function InlineRename({ note, onConfirm, onCancel }: {
  note: Note;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(note.title ?? note.filename);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <input
        ref={ref}
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && val.trim()) onConfirm(val.trim());
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => onCancel()}
        className="flex-1 min-w-0 bg-bg border border-accent/50 rounded px-2 py-0.5 text-sm text-text outline-none"
      />
      <button
        onMouseDown={(e) => { e.preventDefault(); if (val.trim()) onConfirm(val.trim()); }}
        className="text-teal hover:text-teal/70 shrink-0 text-xs font-bold"
      >✓</button>
      <button
        onMouseDown={(e) => { e.preventDefault(); onCancel(); }}
        className="text-muted hover:text-text shrink-0 text-xs"
      >✕</button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function NotesList({
  notes, folders, onRefresh,
}: {
  notes: Note[];
  folders: FolderNode[];
  onRefresh: () => void;
}) {
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

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; note: Note } | null>(null);
  // Inline rename
  const [renamingFilename, setRenamingFilename] = useState<string | null>(null);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  function handleContextMenu(e: React.MouseEvent, note: Note) {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, note });
  }

  async function handleRenameNote(note: Note, title: string) {
    try {
      await fetch(`${GATEWAY}/notes/${encodeURIComponent(note.filename)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      onRefresh();
    } catch {}
    setRenamingFilename(null);
  }

  async function handleAssignFolder(note: Note, folderId: number | null) {
    try {
      await fetch(`${GATEWAY}/notes/${encodeURIComponent(note.filename)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: folderId }),
      });
      onRefresh();
    } catch {}
  }

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
                      {groupNotes.map((note) => {
                        const isRenaming = renamingFilename === note.filename;
                        return (
                          <div key={note.filename}
                            draggable={!selectMode && !isRenaming}
                            onDragStart={(e) => { e.dataTransfer.setData("text/plain", note.filename); e.dataTransfer.effectAllowed = "move"; }}
                            onClick={selectMode ? () => toggleNote(note.filename) : undefined}
                            onContextMenu={!selectMode ? (e) => handleContextMenu(e, note) : undefined}
                            className={clsx(
                              "group flex items-center gap-3 px-4 py-3 hover:bg-surface/40 transition-colors border-b border-border last:border-b-0",
                              !selectMode && !isRenaming && "cursor-grab active:cursor-grabbing",
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
                            {isRenaming ? (
                              <InlineRename
                                note={note}
                                onConfirm={(title) => handleRenameNote(note, title)}
                                onCancel={() => setRenamingFilename(null)}
                              />
                            ) : (
                              <Link
                                href={selectMode ? "#" : `/note?file=${encodeURIComponent(note.filename)}`}
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
                            )}
                            {!selectMode && !isRenaming && (
                              <DeleteButton note={note} onRefresh={onRefresh} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          note={ctxMenu.note}
          x={ctxMenu.x}
          y={ctxMenu.y}
          folders={folders}
          onClose={closeCtxMenu}
          onStartRename={() => setRenamingFilename(ctxMenu.note.filename)}
          onAssign={(folderId) => handleAssignFolder(ctxMenu.note, folderId)}
        />
      )}
    </div>
  );
}
