import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { onlineWorkspaceSchema } from "../../../db/schema";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  all: <T>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};

type D1Database = {
  prepare: (query: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown>;
};

type StoredRecord = {
  projectId?: string;
  name?: string;
  houseId?: string;
  createdAt?: string;
  [key: string]: unknown;
};

function database() {
  return (env as unknown as { DB: D1Database }).DB;
}

async function ensureSchema() {
  const db = database();
  await db.batch(onlineWorkspaceSchema.map((sql) => db.prepare(sql)));
  return db;
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  const projectId = String(url.searchParams.get("projectId") || "").trim();
  if (!year || month < 1 || month > 12) return json({ ok: false, error: "Thiếu kỳ dữ liệu cần nạp." }, 400);

  const db = await ensureSchema();
  if (projectId) {
    const row = await db.prepare("SELECT payload FROM crm_records WHERE project_id = ?").bind(projectId).all<{ payload: string }>();
    const payload = row.results?.[0]?.payload;
    return json({ ok: true, record: payload ? JSON.parse(payload) : null });
  }
  const rows = await db.prepare("SELECT payload FROM crm_records WHERE year = ? AND month = ? ORDER BY updated_at DESC").bind(year, month).all<{ payload: string }>();
  return json({ ok: true, records: (rows.results || []).map((row) => JSON.parse(row.payload)) });
}

export async function POST(request: Request) {
  let body: { action?: string; year?: number; month?: number; record?: StoredRecord; records?: StoredRecord[] };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Dữ liệu lưu online không hợp lệ." }, 400);
  }
  const year = Number(body.year);
  const month = Number(body.month);
  const records = body.action === "upsert-records" ? body.records || [] : body.record ? [body.record] : [];
  if (!year || month < 1 || month > 12 || !records.length) return json({ ok: false, error: "Thiếu hồ sơ cần lưu online." }, 400);

  const now = Date.now();
  const db = await ensureSchema();
  const statements: D1Statement[] = [];
  for (const record of records) {
    const projectId = String(record.projectId || "").trim();
    if (!projectId) continue;
    statements.push(db.prepare(`INSERT INTO crm_records (project_id, year, month, name, house_id, created_at, payload, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET year = excluded.year, month = excluded.month, name = excluded.name,
      house_id = excluded.house_id, created_at = excluded.created_at, payload = excluded.payload, updated_at = excluded.updated_at`)
      .bind(projectId, year, month, String(record.name || ""), String(record.houseId || ""), String(record.createdAt || ""), JSON.stringify(record), now));
  }
  if (!statements.length) return json({ ok: false, error: "Hồ sơ không có mã dự án." }, 400);
  await db.batch(statements);
  return json({ ok: true, saved: statements.length });
}
