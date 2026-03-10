"use client";

import { useState } from "react";
import { ChevronRight, Folder, FolderOpen, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import clsx from "clsx";

const GATEWAY = "http://127.0.0.1:18789";

export interface FolderNode {
  id: number;
  name: string;
  parent_id: number | null;
  children: FolderNode[];
}

interface FolderTreeProps {
  folders: FolderNode[];
  activeFolderId: number | null;
  onSelectFolder: (id: number | null) => void;
  onRefresh: () => void;
  noteCounts: Record<number, number>;
}

// ── Inline input used for create & rename ─────────────────────────────────────
function InlineInput({
  initial, placeholder, onConfirm, onCancel,
}: { initial?: string; placeholder: string; onConfirm: (v: string) => void; onCancel: () => void }) {
  const [val, setVal] = useState(initial ?? "");
  return (
    <div className="flex items-center gap-1 py-0.5" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && val.trim()) onConfirm(val.trim());
          if (e.key === "Escape") onCancel();
        }}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-bg border border-accent/50 rounded px-2 py-0.5 text-xs text-text outline-none"
      />
      <button onClick={() => val.trim() && onConfirm(val.trim())} className="text-teal hover:text-teal/70 text-xs font-bold">
        <Check className="w-3 h-3" />
      </button>
      <button onClick={onCancel} className="text-muted hover:text-text text-xs">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Single folder row ─────────────────────────────────────────────────────────
function FolderNode({
  node, depth, activeFolderId, onSelectFolder, onRefresh, noteCounts,
}: {
  node: FolderNode;
  depth: number;
  activeFolderId: number | null;
  onSelectFolder: (id: number | null) => void;
  onRefresh: () => void;
  noteCounts: Record<number, number>;
}) {
  const [expanded,    setExpanded]    = useState(false);
  const [renaming,    setRenaming]    = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [confirming,  setConfirming]  = useState(false);

  const hasChildren = node.children.length > 0;
  const isActive    = activeFolderId === node.id;
  const count       = noteCounts[node.id] ?? 0;

  async function handleRename(name: string) {
    await fetch(`${GATEWAY}/folders/${node.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setRenaming(false);
    onRefresh();
  }

  async function handleAddChild(name: string) {
    await fetch(`${GATEWAY}/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentId: node.id }),
    });
    setAddingChild(false);
    setExpanded(true);
    onRefresh();
  }

  async function handleDelete() {
    await fetch(`${GATEWAY}/folders/${node.id}`, { method: "DELETE" });
    if (isActive) onSelectFolder(null);
    onRefresh();
  }

  return (
    <div>
      <div
        className={clsx(
          "group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer transition-colors text-xs select-none",
          isActive
            ? "bg-accent/20 text-accent font-semibold"
            : "text-muted hover:text-text hover:bg-surface/60"
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => onSelectFolder(isActive ? null : node.id)}
      >
        {/* Chevron */}
        <button
          className={clsx("shrink-0 transition-transform", hasChildren || addingChild ? "opacity-100" : "opacity-0 pointer-events-none")}
          onClick={(e) => { e.stopPropagation(); setExpanded((s) => !s); }}
        >
          <ChevronRight className={clsx("w-3 h-3 transition-transform", expanded ? "rotate-90" : "")} />
        </button>

        {/* Icon */}
        {expanded
          ? <FolderOpen className="w-3.5 h-3.5 shrink-0" />
          : <Folder     className="w-3.5 h-3.5 shrink-0" />
        }

        {/* Name or rename input */}
        {renaming ? (
          <InlineInput
            initial={node.name}
            placeholder="Folder name…"
            onConfirm={handleRename}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="flex-1 truncate">{node.name}</span>
        )}

        {/* Note count */}
        {!renaming && count > 0 && (
          <span className="text-[10px] text-muted/70 shrink-0">{count}</span>
        )}

        {/* Action buttons — visible on hover */}
        {!renaming && (
          <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 ml-1" onClick={(e) => e.stopPropagation()}>
            <button title="Add subfolder" onClick={() => { setAddingChild(true); setExpanded(true); }}
              className="p-0.5 rounded hover:text-accent transition-colors">
              <Plus className="w-3 h-3" />
            </button>
            <button title="Rename" onClick={() => setRenaming(true)}
              className="p-0.5 rounded hover:text-accent transition-colors">
              <Pencil className="w-3 h-3" />
            </button>
            {confirming ? (
              <>
                <button onClick={handleDelete} className="p-0.5 rounded text-red-400 hover:text-red-300 font-bold transition-colors">
                  <Check className="w-3 h-3" />
                </button>
                <button onClick={() => setConfirming(false)} className="p-0.5 rounded hover:text-text transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </>
            ) : (
              <button title="Delete folder" onClick={() => setConfirming(true)}
                className="p-0.5 rounded hover:text-red-400 transition-colors">
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Children */}
      {expanded && (
        <div>
          {node.children.map((child) => (
            <FolderNode
              key={child.id}
              node={child}
              depth={depth + 1}
              activeFolderId={activeFolderId}
              onSelectFolder={onSelectFolder}
              onRefresh={onRefresh}
              noteCounts={noteCounts}
            />
          ))}
          {addingChild && (
            <div style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }} className="py-1 pr-2">
              <InlineInput
                placeholder="Subfolder name…"
                onConfirm={handleAddChild}
                onCancel={() => setAddingChild(false)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Root tree ─────────────────────────────────────────────────────────────────
export default function FolderTree({ folders, activeFolderId, onSelectFolder, onRefresh, noteCounts }: FolderTreeProps) {
  const [addingRoot, setAddingRoot] = useState(false);

  async function handleAddRoot(name: string) {
    await fetch(`${GATEWAY}/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setAddingRoot(false);
    onRefresh();
  }

  return (
    <div className="flex flex-col gap-0.5">
      {folders.map((f) => (
        <FolderNode
          key={f.id}
          node={f}
          depth={0}
          activeFolderId={activeFolderId}
          onSelectFolder={onSelectFolder}
          onRefresh={onRefresh}
          noteCounts={noteCounts}
        />
      ))}

      {addingRoot ? (
        <div className="px-2 py-1">
          <InlineInput
            placeholder="New folder name…"
            onConfirm={handleAddRoot}
            onCancel={() => setAddingRoot(false)}
          />
        </div>
      ) : (
        <button
          onClick={() => setAddingRoot(true)}
          className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted hover:text-accent transition-colors rounded-lg hover:bg-surface/60"
        >
          <Plus className="w-3 h-3" />
          <span>New folder</span>
        </button>
      )}
    </div>
  );
}
