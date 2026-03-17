import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { FolderSymlink, GitMerge, Trash2, Pencil, Pin, PinOff } from "lucide-react";
import clsx from "clsx";
import { Notes } from "../storage.js";

const MODE_BADGE = {
  summary:   { icon: "📄", color: "bg-accent/20 text-accent border-accent/30" },
  explain:   { icon: "📖", color: "bg-teal/20 text-teal border-teal/30" },
  quiz:      { icon: "❓", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  flashcard: { icon: "🃏", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  session:   { icon: "📚", color: "bg-purple-500/20 text-purple-300 border-purple-500/30" },
  audio:     { icon: "🎙️", color: "bg-pink-500/20 text-pink-400 border-pink-500/30" },
  chat:      { icon: "💬", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
};

function getModeKey(mode) {
  if (!mode) return "summary";
  if (mode.startsWith("audio")) return "audio";
  return mode in MODE_BADGE ? mode : "summary";
}

function flattenFolders(nodes, depth = 0) {
  return nodes.flatMap((n) => [{ folder: n, depth }, ...flattenFolders(n.children ?? [], depth + 1)]);
}

// ── Filter dropdown ───────────────────────────────────────────────────────────
const FILTER_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "week",  label: "This week" },
  { value: "month", label: "This month" },
  { value: "all",   label: "All time" },
  { value: "range", label: "📅 Custom range" },
];

function FilterDropdown({ value, showRange, onChange, onToggleRange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeLabel = showRange
    ? "📅 Custom range"
    : (FILTER_OPTIONS.find((o) => o.value === value)?.label ?? "All time");

  function handleSelect(opt) {
    setOpen(false);
    if (opt.value === "range") { onToggleRange(true); }
    else { onToggleRange(false); onChange(opt.value); }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full border transition-colors",
          open || showRange || value !== "all"
            ? "bg-accent/20 border-accent/50 text-accent"
            : "border-border text-muted hover:border-accent/40 hover:text-text"
        )}
      >
        {activeLabel}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={clsx("transition-transform duration-150", open ? "rotate-180" : "")}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className="absolute top-full mt-1.5 left-0 z-50 bg-surface border border-border rounded-xl shadow-2xl overflow-hidden min-w-[150px] py-1">
          {FILTER_OPTIONS.map((opt) => {
            const isActive = opt.value === "range" ? showRange : (!showRange && value === opt.value);
            return (
              <button key={opt.value} onClick={() => handleSelect(opt)}
                className={clsx(
                  "w-full text-left px-4 py-2 text-xs transition-colors",
                  isActive ? "text-accent font-semibold bg-accent/10" : "text-text hover:bg-accent/10"
                )}>
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Context menu ──────────────────────────────────────────────────────────────
function ContextMenu({ note, x, y, folders, onClose, onStartRename, onAssign, onTogglePin }) {
  const [view, setView] = useState("menu");
  const ref = useRef(null);
  const flatFolders = useMemo(() => flattenFolders(folders), [folders]);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const [pos, setPos] = useState({ top: y, left: x });
  useEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    setPos({ top: Math.min(y, window.innerHeight - height - 8), left: Math.min(x, window.innerWidth - width - 8) });
  }, [x, y, view]);

  return (
    <div ref={ref} style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
      className="bg-surface border border-border rounded-xl shadow-2xl overflow-hidden min-w-[190px]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {view === "menu" ? (
        <div className="py-1">
          <button onClick={() => { onTogglePin(); onClose(); }}
            className="w-full text-left px-4 py-2.5 text-sm text-text hover:bg-accent/10 flex items-center gap-2.5 transition-colors">
            {note.pinned ? <PinOff className="w-3.5 h-3.5 text-muted" /> : <Pin className="w-3.5 h-3.5 text-muted" />}
            {note.pinned ? "Unpin" : "Pin to top"}
          </button>
          <button onClick={() => { onStartRename(); onClose(); }}
            className="w-full text-left px-4 py-2.5 text-sm text-text hover:bg-accent/10 flex items-center gap-2.5 transition-colors">
            <Pencil className="w-3.5 h-3.5 text-muted" /> Rename
          </button>
          <button onClick={() => setView("folders")}
            className="w-full text-left px-4 py-2.5 text-sm text-text hover:bg-accent/10 flex items-center gap-2.5 transition-colors">
            <FolderSymlink className="w-3.5 h-3.5 text-muted" /> Assign to folder
          </button>
        </div>
      ) : (
        <>
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <button onClick={() => setView("menu")} className="text-muted hover:text-text text-sm px-0.5 transition-colors">←</button>
            <span className="text-xs font-semibold text-muted uppercase tracking-widest">Assign to folder</span>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            <button onClick={() => { onAssign(null); onClose(); }}
              className={clsx("w-full text-left px-4 py-2 text-sm hover:bg-accent/10 transition-colors italic",
                !note.folder_id ? "text-accent font-semibold" : "text-muted")}>
              None (unattached)
            </button>
            {flatFolders.map(({ folder, depth }) => (
              <button key={folder.id} onClick={() => { onAssign(folder.id); onClose(); }}
                style={{ paddingLeft: `${16 + depth * 14}px` }}
                className={clsx("w-full text-left text-sm py-2 pr-3 hover:bg-accent/10 transition-colors flex items-center gap-1.5",
                  note.folder_id === folder.id ? "text-accent font-semibold" : "text-text")}>
                📁 {folder.name}
              </button>
            ))}
            {flatFolders.length === 0 && <p className="text-xs text-muted px-4 py-3">No folders yet</p>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Inline rename ─────────────────────────────────────────────────────────────
function InlineRename({ note, onConfirm, onCancel }) {
  const [val, setVal] = useState(note.title ?? note.filename);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <input ref={ref} type="text" value={val} onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && val.trim()) onConfirm(val.trim()); if (e.key === "Escape") onCancel(); }}
        onBlur={onCancel}
        className="flex-1 min-w-0 bg-bg border border-accent/50 rounded px-2 py-0.5 text-sm text-text outline-none" />
      <button onMouseDown={(e) => { e.preventDefault(); if (val.trim()) onConfirm(val.trim()); }} className="text-teal text-xs font-bold">✓</button>
      <button onMouseDown={(e) => { e.preventDefault(); onCancel(); }} className="text-muted text-xs">✕</button>
    </div>
  );
}

// ── Selection bar ─────────────────────────────────────────────────────────────
function SelectionBar({ selected, folders, onClear, onMerge, onDelete, onTransfer }) {
  const [action,  setAction]  = useState(null);
  const [title,   setTitle]   = useState("");
  const [loading, setLoading] = useState(false);
  const flatFolders = useMemo(() => flattenFolders(folders), [folders]);

  async function doMerge() {
    setLoading(true); await onMerge(title.trim()); setLoading(false); setTitle(""); setAction(null);
  }
  async function doDelete() { setLoading(true); await onDelete(); setLoading(false); }
  async function doTransfer(folderId) { setLoading(true); await onTransfer(folderId); setLoading(false); setAction(null); }

  return (
    <div className="sticky top-0 z-10 mb-4 bg-surface border border-accent/40 rounded-xl shadow-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="text-xs font-semibold text-accent shrink-0">{selected.size} selected</span>
        <button onClick={() => setAction(action === "merge" ? null : "merge")} disabled={selected.size < 2 || loading}
          className={clsx("flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors shrink-0 disabled:opacity-30",
            action === "merge" ? "bg-accent/20 border-accent/50 text-accent" : "border-border text-muted hover:border-accent/40 hover:text-text")}>
          <GitMerge className="w-3 h-3" /> Merge
        </button>
        <button onClick={() => setAction(action === "move" ? null : "move")} disabled={loading}
          className={clsx("flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors shrink-0 disabled:opacity-30",
            action === "move" ? "bg-teal/20 border-teal/50 text-teal" : "border-border text-muted hover:border-teal/40 hover:text-text")}>
          <FolderSymlink className="w-3 h-3" /> Move
        </button>
        <button onClick={doDelete} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-muted hover:border-red-400/40 hover:text-red-400 disabled:opacity-30 transition-colors shrink-0">
          <Trash2 className="w-3 h-3" /> Delete
        </button>
        <button onClick={onClear} className="ml-auto text-xs text-muted hover:text-text transition-colors shrink-0">Cancel</button>
      </div>

      {action === "merge" && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border/60 bg-bg/40">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doMerge(); }}
            placeholder="Merged note title (optional)…"
            className="flex-1 bg-bg border border-border rounded-lg px-3 py-1.5 text-xs text-text placeholder:text-muted outline-none focus:border-accent transition-colors min-w-0" />
          <button onClick={doMerge} disabled={loading}
            className="px-3 py-1.5 text-xs font-semibold bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-40 transition-colors shrink-0">
            {loading ? "Merging…" : "Merge"}
          </button>
        </div>
      )}

      {action === "move" && (
        <div className="px-4 py-2 border-t border-border/60 bg-bg/40 max-h-48 overflow-y-auto">
          <button onClick={() => doTransfer(null)} disabled={loading}
            className="w-full text-left px-3 py-2 text-xs text-muted hover:bg-accent/10 hover:text-text rounded-lg transition-colors italic">
            None (unsorted)
          </button>
          {flatFolders.map(({ folder, depth }) => (
            <button key={folder.id} onClick={() => doTransfer(folder.id)} disabled={loading}
              style={{ paddingLeft: `${12 + depth * 14}px` }}
              className="w-full text-left py-2 pr-3 text-xs text-text hover:bg-accent/10 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-40">
              📁 {folder.name}
            </button>
          ))}
          {flatFolders.length === 0 && <p className="text-xs text-muted px-3 py-2">No folders yet</p>}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function NotesList({ notes, folders, onRefresh, onOpenNote, limit }) {
  const [dateFilter,       setDateFilter]       = useState("all");
  const [sortMode,         setSortMode]         = useState("date");
  const [showRange,        setShowRange]        = useState(false);
  const [rangeFrom,        setRangeFrom]        = useState("");
  const [rangeTo,          setRangeTo]          = useState("");
  const [selectMode,       setSelectMode]       = useState(false);
  const [selected,         setSelected]         = useState(new Set());
  const [actionError,      setActionError]      = useState(null);
  const [ctxMenu,          setCtxMenu]          = useState(null);
  const [renamingFilename, setRenamingFilename] = useState(null);
  const [expanded,         setExpanded]         = useState(false);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  function handleContextMenu(e, note) { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, note }); }

  async function handleRenameNote(note, title) {
    try { await Notes.updateMeta(note.filename, { title }); onRefresh(); } catch {}
    setRenamingFilename(null);
  }

  async function handleAssignFolder(note, folderId) {
    try { await Notes.updateMeta(note.filename, { folder_id: folderId }); onRefresh(); } catch {}
  }

  async function handleTogglePin(note) {
    try { await Notes.updateMeta(note.filename, { pinned: !note.pinned }); onRefresh(); } catch {}
  }

  const sortedNotes = useMemo(() => {
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const filtered = notes.filter((n) => {
      const d = new Date(n.modified ?? n.updatedAt ?? n.createdAt);
      if (showRange && (rangeFrom || rangeTo)) {
        if (rangeFrom && d < new Date(rangeFrom))             return false;
        if (rangeTo   && d > new Date(rangeTo + "T23:59:59")) return false;
      } else {
        if (dateFilter === "today" && d < today)                                      return false;
        if (dateFilter === "week"  && d < new Date(today.getTime() - 6  * 86400000)) return false;
        if (dateFilter === "month" && d < new Date(today.getTime() - 29 * 86400000)) return false;
      }
      return true;
    });

    const sorted = [...filtered];
    if (sortMode === "date") sorted.sort((a, b) => (b.modified ?? b.updatedAt ?? 0) - (a.modified ?? a.updatedAt ?? 0));
    else sorted.sort((a, b) => (a.title ?? a.filename).localeCompare(b.title ?? b.filename));
    sorted.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    return sorted;
  }, [notes, dateFilter, sortMode, rangeFrom, rangeTo, showRange]);

  const displayedNotes = limit && !expanded ? sortedNotes.slice(0, limit) : sortedNotes;
  const hiddenCount = limit && !expanded ? Math.max(0, sortedNotes.length - limit) : 0;

  function toggleNote(filename) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(filename)) next.delete(filename); else next.add(filename); return next; });
  }

  function toggleSelectMode() { setSelectMode((s) => !s); setSelected(new Set()); setActionError(null); }

  async function handleMerge(title) {
    setActionError(null);
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const slug = (title || "merged").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const newFilename = `${ts}_${slug}.md`;
      await Notes.merge(Array.from(selected), newFilename, title || "Merged Note");
      setSelectMode(false); setSelected(new Set()); onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Merge failed");
    }
  }

  async function handleDeleteSelected() {
    setActionError(null);
    try {
      await Promise.all(Array.from(selected).map((f) => Notes.delete(f)));
      setSelectMode(false); setSelected(new Set()); onRefresh();
    } catch { setActionError("Delete failed"); }
  }

  async function handleTransferSelected(folderId) {
    setActionError(null);
    try {
      await Promise.all(Array.from(selected).map((f) => Notes.updateMeta(f, { folder_id: folderId })));
      setSelectMode(false); setSelected(new Set()); onRefresh();
    } catch { setActionError("Move failed"); }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <FilterDropdown
          value={dateFilter}
          showRange={showRange}
          onChange={(f) => { setDateFilter(f); setRangeFrom(""); setRangeTo(""); }}
          onToggleRange={(v) => { setShowRange(v); if (!v) { setRangeFrom(""); setRangeTo(""); } }}
        />
        <button onClick={toggleSelectMode}
          className={clsx("px-3 py-1 text-xs font-semibold rounded-full border transition-colors",
            selectMode ? "bg-accent/20 border-accent/50 text-accent" : "border-border text-muted hover:border-accent/40 hover:text-text")}>
          {selectMode ? "Cancel" : "Select"}
        </button>
        <div className="ml-auto flex rounded-lg overflow-hidden border border-border">
          {["date", "alpha"].map((s) => (
            <button key={s} onClick={() => setSortMode(s)}
              className={clsx("px-3 py-1 text-xs font-semibold transition-colors",
                sortMode === s ? "bg-accent/20 text-accent" : "text-muted hover:text-text")}>
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

      {selectMode && selected.size >= 1 && (
        <SelectionBar selected={selected} folders={folders} onClear={toggleSelectMode}
          onMerge={handleMerge} onDelete={handleDeleteSelected} onTransfer={handleTransferSelected} />
      )}
      {actionError && <p className="text-xs text-red-400 mb-3 px-1">{actionError}</p>}

      {sortedNotes.length === 0 ? (
        <div className="text-center py-16 text-muted text-sm border border-dashed border-border rounded-xl">
          No notes for this period — capture something!
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden divide-y divide-border/50">
          {displayedNotes.map((note) => {
            const modeKey    = getModeKey(note.mode);
            const badge      = MODE_BADGE[modeKey];
            const noteDate   = note.modified ?? note.updatedAt ?? note.createdAt;
            const isRenaming = renamingFilename === note.filename;
            return (
              <div key={note.filename}
                draggable={!selectMode && !isRenaming}
                onDragStart={(e) => { e.dataTransfer.setData("text/plain", note.filename); e.dataTransfer.effectAllowed = "move"; }}
                onClick={selectMode ? () => toggleNote(note.filename) : undefined}
                onContextMenu={!selectMode ? (e) => handleContextMenu(e, note) : undefined}
                className={clsx(
                  "group flex items-center gap-3 px-4 py-2.5 hover:bg-surface/40 transition-colors",
                  !selectMode && !isRenaming && "cursor-grab active:cursor-grabbing",
                  selectMode && "cursor-pointer",
                  selectMode && selected.has(note.filename) && "bg-accent/10"
                )}>
                {selectMode && (
                  <input type="checkbox" readOnly checked={selected.has(note.filename)}
                    className="w-4 h-4 accent-[#7c6af5] shrink-0 pointer-events-none" />
                )}
                <span className={clsx("text-xs px-1.5 py-0.5 rounded border leading-none shrink-0", badge.color)}>
                  {badge.icon}
                </span>
                {isRenaming ? (
                  <InlineRename note={note} onConfirm={(title) => handleRenameNote(note, title)} onCancel={() => setRenamingFilename(null)} />
                ) : (
                  <button className="flex-1 min-w-0 text-left" onClick={!selectMode ? () => onOpenNote(note.filename) : undefined}>
                    <p className="text-sm font-medium text-text truncate">
                      {note.pinned && <span className="text-accent mr-1.5 text-xs">📌</span>}
                      {note.title ?? note.filename}
                    </p>
                    <p className="text-xs text-muted mt-0.5">
                      {noteDate ? new Date(noteDate).toLocaleString() : ""}
                    </p>
                  </button>
                )}
                {!selectMode && !isRenaming && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenamingFilename(note.filename); }}
                      title="Rename note"
                      className="opacity-0 group-hover:opacity-100 flex items-center px-2 py-0.5 rounded border border-transparent hover:border-accent/30 hover:text-accent text-muted transition-all"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={async (e) => { e.stopPropagation(); try { await Notes.delete(note.filename); onRefresh(); } catch {} }}
                      title="Delete note"
                      className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-muted hover:text-red-400 transition-all px-2 py-0.5 rounded border border-transparent hover:border-red-400/30">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="mt-2 w-full flex items-center justify-center gap-2 py-2 text-xs text-muted hover:text-accent border border-dashed border-border/60 hover:border-accent/40 rounded-xl transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {hiddenCount} more note{hiddenCount !== 1 ? "s" : ""}
        </button>
      )}
      {expanded && limit && sortedNotes.length > limit && (
        <button
          onClick={() => setExpanded(false)}
          className="mt-2 w-full flex items-center justify-center gap-1 py-2 text-xs text-muted hover:text-text border border-dashed border-border/60 hover:border-border rounded-xl transition-colors"
        >
          Show less
        </button>
      )}

      {ctxMenu && (
        <ContextMenu note={ctxMenu.note} x={ctxMenu.x} y={ctxMenu.y} folders={folders}
          onClose={closeCtxMenu}
          onStartRename={() => setRenamingFilename(ctxMenu.note.filename)}
          onAssign={(folderId) => handleAssignFolder(ctxMenu.note, folderId)}
          onTogglePin={() => handleTogglePin(ctxMenu.note)} />
      )}
    </div>
  );
}
