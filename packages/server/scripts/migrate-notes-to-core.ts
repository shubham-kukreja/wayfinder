// Copy notes from this (legacy) backend into core-jobs-service (/v1/notes).
//
// Same approach as push-notes.ts: notes are replayed through the target's
// own API, so core validates them and records each one in its audit log,
// rather than rows being written underneath it.
//
// Source, one of:
//   --db ./data/wayfinder.db        a legacy SQLite file (default). It is copied
//                                   to a temp dir first, so the original is
//                                   never opened for writing.
//   --from-api https://legacy-host  a running legacy server (GET /api/notes
//                                   needs no login there)
// Target:
//   --target http://127.0.0.1:8090  core-jobs-service, with CORE_API_KEY set to
//                                   an analyst or admin API key
//                                   (app user create-api-key). Never logged.
//   --dry-run                       print what would be sent, send nothing
//
// What carries over: title, body (the editor document, verbatim) and
// references. What does not: timestamps and author. Core stamps both: the
// copied notes are authored by the API key's user and dated now.
//
// Empty untitled notes (an unused "New note" click) are skipped.
//
// Idempotent: a note whose title and body already exist in core is skipped,
// and each POST carries Idempotency-Key legacy-note-<id>, so a rerun after a
// partial failure resumes rather than duplicating.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import Database from "better-sqlite3";

interface LegacyNote {
  id: string;
  title: string | null;
  body: string;
  refs: Array<{ entityType: string; entityId: string; position: number }>;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function fromSqlite(path: string): LegacyNote[] {
  if (!existsSync(path)) throw new Error(`No database at ${path}`);
  const dir = mkdtempSync(join(tmpdir(), "notes-migrate-"));
  try {
    const copy = join(dir, basename(path));
    copyFileSync(path, copy);
    for (const ext of ["-wal", "-shm"]) if (existsSync(path + ext)) copyFileSync(path + ext, copy + ext);
    const db = new Database(copy);
    try {
      const notes = db.prepare("SELECT id, title, body FROM notes ORDER BY created_at").all() as Omit<LegacyNote, "refs">[];
      const refs = db.prepare(
        "SELECT entity_type AS entityType, entity_id AS entityId, position FROM note_refs WHERE note_id = ? ORDER BY position",
      );
      return notes.map((n) => ({ ...n, refs: refs.all(n.id) as LegacyNote["refs"] }));
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function fromApi(base: string): Promise<LegacyNote[]> {
  const res = await fetch(`${base}/api/notes`);
  if (!res.ok) throw new Error(`GET ${base}/api/notes: ${res.status}`);
  const list = (await res.json()) as { notes: Array<{ id: string }> };
  const out: LegacyNote[] = [];
  for (const { id } of list.notes) {
    const r = await fetch(`${base}/api/notes/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(`GET ${base}/api/notes/${id}: ${r.status}`);
    out.push((await r.json()) as LegacyNote);
  }
  return out.reverse(); // oldest first, like the SQLite source
}

interface CoreNote {
  title: string | null;
  body: string;
}

async function coreNotes(target: string, key: string): Promise<CoreNote[]> {
  const out: CoreNote[] = [];
  let cursor: string | null = null;
  do {
    const url = `${target}/v1/notes?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`GET /v1/notes: ${res.status} ${await res.text()}`);
    const page = (await res.json()) as { data: CoreNote[]; next_cursor: string | null };
    out.push(...page.data);
    cursor = page.next_cursor;
  } while (cursor);
  return out;
}

const sameKey = (title: string | null, body: string) => `${(title ?? "").trim()}\u0000${body}`;

async function main(): Promise<void> {
  const target = arg("target")?.replace(/\/$/, "");
  const legacyApi = arg("from-api")?.replace(/\/$/, "");
  const dbPath = arg("db") ?? "./data/wayfinder.db";
  const dryRun = process.argv.includes("--dry-run");
  const key = process.env.CORE_API_KEY;

  if (!target) {
    console.error("Missing --target <core url>, e.g. --target http://127.0.0.1:8090");
    process.exit(1);
  }
  if (!key) {
    console.error("Missing CORE_API_KEY (an analyst or admin key from `app user create-api-key`).");
    process.exit(1);
  }

  const notes = legacyApi ? await fromApi(legacyApi) : fromSqlite(dbPath);
  console.log(`Source ${legacyApi ?? dbPath}: ${notes.length} note(s)`);
  console.log(`Target ${target}${dryRun ? "  (DRY RUN: nothing will be sent)" : ""}\n`);

  const existing = new Set((await coreNotes(target, key)).map((n) => sameKey(n.title, n.body)));
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const n of notes) {
    const label = n.title ?? "(untitled)";
    if (!n.title?.trim() && !n.body.trim() && n.refs.length === 0) {
      console.log(`  skip    ${label}: empty (an unused "New note")`);
      skipped++;
      continue;
    }
    if (existing.has(sameKey(n.title, n.body))) {
      console.log(`  skip    ${label}: already in core`);
      skipped++;
      continue;
    }
    const payload = {
      title: n.title,
      body: n.body,
      refs: n.refs.map((r) => ({ kind: r.entityType, key: r.entityId, position: r.position })),
    };
    if (dryRun) {
      console.log(`  would   ${label}: ${n.body.length} chars, ${n.refs.length} ref(s)`);
      continue;
    }
    const res = await fetch(`${target}/v1/notes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `legacy-note-${n.id}` },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const made = (await res.json()) as { id: string; refs: unknown[] };
      console.log(`  copied  ${label} → ${made.id} (${made.refs.length} ref(s))`);
      created++;
    } else {
      console.log(`  FAILED  ${label}: ${res.status} ${await res.text()}`);
      failed++;
    }
  }
  console.log(`\n${created} copied, ${skipped} already there, ${failed} failed.`);
  if (failed) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
