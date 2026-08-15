import { NextResponse } from "next/server";

type SyncRequest = {
  action?: "sync-customer" | "sync-design-progress";
  scriptUrl?: string;
  token?: string;
  year?: number;
  month?: number;
  record?: unknown;
};

function isAllowedAppsScriptUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "script.google.com" && url.pathname.startsWith("/macros/s/");
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  let body: SyncRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Dữ liệu đồng bộ không hợp lệ." }, { status: 400 });
  }

  if (!body.scriptUrl || !isAllowedAppsScriptUrl(body.scriptUrl) || !body.token || !body.year || !body.month || !body.record) {
    return NextResponse.json({ ok: false, error: "Thiếu cấu hình Google Apps Script hoặc dữ liệu hồ sơ." }, { status: 400 });
  }

  try {
    const scriptResponse = await fetch(body.scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: body.action ?? "sync-customer", token: body.token, year: body.year, month: body.month, record: body.record }),
      redirect: "follow",
    });
    const responseText = await scriptResponse.text();
    const result = JSON.parse(responseText) as { ok?: boolean; error?: string; fileUrl?: string; folderUrl?: string };
    if (!scriptResponse.ok || !result.ok) {
      return NextResponse.json({ ok: false, error: result.error || "Google Drive không thể tạo file Excel." }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ ok: false, error: "Không thể kết nối Google Apps Script. Hãy kiểm tra Web app URL." }, { status: 502 });
  }
}
