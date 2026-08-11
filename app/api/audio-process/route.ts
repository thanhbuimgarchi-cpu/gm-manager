import { NextResponse } from "next/server";

type ProcessRequest = {
  scriptUrl?: string;
  token?: string;
  year?: number;
  month?: number;
  projectId?: string;
  chunkIndex?: number;
  totalChunks?: number;
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
  let body: ProcessRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Dữ liệu xử lý ghi âm không hợp lệ." }, { status: 400 });
  }

  if (!body.scriptUrl || !isAllowedAppsScriptUrl(body.scriptUrl) || !body.token || !body.year || !body.month || !body.projectId || body.chunkIndex === undefined || !body.totalChunks) {
    return NextResponse.json({ ok: false, error: "Thiếu thông tin đoạn ghi âm cần xử lý." }, { status: 400 });
  }

  try {
    const scriptResponse = await fetch(body.scriptUrl, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "process-audio-chunk",
        token: body.token,
        year: body.year,
        month: body.month,
        projectId: body.projectId,
        chunkIndex: body.chunkIndex,
        totalChunks: body.totalChunks,
      }),
      redirect: "follow",
    });
    const responseText = await scriptResponse.text();
    let result: { ok?: boolean; error?: string; language?: string; segments?: unknown[]; keyPoints?: string[]; apiCallsUsed?: number };
    try {
      result = JSON.parse(responseText) as typeof result;
    } catch {
      return NextResponse.json({ ok: false, error: "Google Apps Script chưa hỗ trợ tiếp tục xử lý ghi âm. Hãy dán lại mã Script mới và triển khai lại." }, { status: 502 });
    }
    if (!scriptResponse.ok || !result.ok) return NextResponse.json({ ok: false, error: result.error || "Không thể xử lý đoạn ghi âm đã lưu." }, { status: 502 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Không thể kết nối Google Apps Script để xử lý ghi âm." }, { status: 502 });
  }
}
