import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data");
const DB_PATH = path.join(DATA_DIR, "lookup.db");

fs.mkdirSync(DATA_DIR, { recursive: true });

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
`);

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
      // Allow streak to start from yesterday if nothing today yet
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

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

export default db;
