import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// When running as a pkg exe, store data next to the executable.
// In dev, store it at the project root (gateway/../data).
const BASE_DIR = process.pkg
  ? path.dirname(process.execPath)
  : path.join(__dirname, "..");
const DATA_DIR = path.join(BASE_DIR, "data");
const DB_PATH = process.env.TEST_DB_PATH || path.join(DATA_DIR, "lookup.db");

if (DB_PATH !== ":memory:") fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS activity (
    date TEXT PRIMARY KEY,
    count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS folders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT,
    messages   TEXT NOT NULL DEFAULT '[]',
    folder_id  INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── Activity ─────────────────────────────────────────────────────────────────

/** Record one capture event for today */
export function logActivity() {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO activity (date, count) VALUES (?, 1)
    ON CONFLICT(date) DO UPDATE SET count = count + 1
  `).run(today);
}

/** Get activity for the last N days (for heatmap) */
export function getActivity(days = 365) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return db.prepare(
    "SELECT date, count FROM activity WHERE date >= ? ORDER BY date ASC"
  ).all(cutoffStr);
}

/** Current consecutive-day streak */
export function getStreak() {
  const rows = db.prepare(
    "SELECT date FROM activity ORDER BY date DESC"
  ).all();
  if (rows.length === 0) return 0;

  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  for (const { date } of rows) {
    const expected = cursor.toISOString().slice(0, 10);
    if (date === expected) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else if (streak === 0 && date === new Date(Date.now() - 86400000).toISOString().slice(0, 10)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

// ── Settings ─────────────────────────────────────────────────────────────────

/** Get or set a setting value */
export function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

// ── Folders ──────────────────────────────────────────────────────────────────

/** Return the full folder tree as nested objects */
export function getFolderTree() {
  const rows = db.prepare("SELECT id, name, parent_id FROM folders ORDER BY name ASC").all();
  const map = new Map();
  for (const r of rows) map.set(r.id, { ...r, children: [] });
  const roots = [];
  for (const node of map.values()) {
    if (node.parent_id == null) roots.push(node);
    else map.get(node.parent_id)?.children.push(node);
  }
  return roots;
}

/** Return a flat list of all folders {id, name, parent_id} */
export function getFoldersFlat() {
  return db.prepare("SELECT id, name, parent_id FROM folders ORDER BY name ASC").all();
}

export function getFolderById(id) {
  return db.prepare("SELECT * FROM folders WHERE id = ?").get(id);
}

export function createFolder(name, parentId = null) {
  const result = db.prepare(
    "INSERT INTO folders (name, parent_id) VALUES (?, ?)"
  ).run(name, parentId ?? null);
  return db.prepare("SELECT * FROM folders WHERE id = ?").get(result.lastInsertRowid);
}

export function renameFolder(id, name) {
  db.prepare("UPDATE folders SET name = ? WHERE id = ?").run(name, id);
}

export function deleteFolder(id) {
  db.prepare("DELETE FROM folders WHERE id = ?").run(id);
}

// ── Conversations ─────────────────────────────────────────────────────────────

// Migration: add sort_order if not present
try { db.exec("ALTER TABLE conversations ADD COLUMN sort_order INTEGER DEFAULT 0"); } catch {}

export function listConversations() {
  return db.prepare(
    "SELECT id, title, folder_id, created_at, updated_at FROM conversations ORDER BY sort_order ASC, updated_at DESC"
  ).all();
}

export function getConversation(id) {
  const row = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
  if (!row) return null;
  return { ...row, messages: JSON.parse(row.messages) };
}

/** Returns the most recently updated conversation, creating one if none exists */
export function getActiveConversation() {
  let row = db.prepare(
    "SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 1"
  ).get();
  if (!row) {
    const result = db.prepare(
      "INSERT INTO conversations (title, messages) VALUES (?, '[]')"
    ).run("New conversation");
    row = db.prepare("SELECT * FROM conversations WHERE id = ?").get(result.lastInsertRowid);
  }
  return { ...row, messages: JSON.parse(row.messages) };
}

export function createConversation(title = "New conversation", folderId = null) {
  const result = db.prepare(
    "INSERT INTO conversations (title, messages, folder_id) VALUES (?, '[]', ?)"
  ).run(title, folderId ?? null);
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(result.lastInsertRowid);
}

export function touchConversation(id) {
  const now = new Date().toISOString();
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, id);
}

export function saveConversation(id, messages, title = null) {
  const now = new Date().toISOString();
  if (title) {
    db.prepare(
      "UPDATE conversations SET messages = ?, title = ?, updated_at = ? WHERE id = ?"
    ).run(JSON.stringify(messages), title, now, id);
  } else {
    db.prepare(
      "UPDATE conversations SET messages = ?, updated_at = ? WHERE id = ?"
    ).run(JSON.stringify(messages), now, id);
  }
}

export function deleteConversation(id) {
  db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
}

export function reorderConversations(orderedIds) {
  const stmt = db.prepare("UPDATE conversations SET sort_order = ? WHERE id = ?");
  db.transaction((ids) => { ids.forEach((id, i) => stmt.run(i, id)); })(orderedIds);
}

export function mergeConversations(targetId, sourceId) {
  const target = getConversation(targetId);
  const source = getConversation(sourceId);
  if (!target || !source) throw new Error("Conversation not found");
  const merged = [...target.messages, ...source.messages];
  saveConversation(targetId, merged, target.title ?? source.title);
  deleteConversation(sourceId);
}

export function renameConversation(id, title) {
  db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
    .run(title, new Date().toISOString(), id);
}

// ── Command log ───────────────────────────────────────────────────────────────

try {
  db.exec(`CREATE TABLE IF NOT EXISTS command_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL,
    text       TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
} catch {}

export function appendCommandLog(type, text) {
  db.prepare("INSERT INTO command_log (type, text) VALUES (?, ?)").run(type, text);
}

export function getCommandLog(limit = 40) {
  return db.prepare(
    "SELECT type, text FROM command_log ORDER BY id DESC LIMIT ?"
  ).all(limit).reverse();
}

export default db;
