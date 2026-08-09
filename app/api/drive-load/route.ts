import { NextResponse } from "next/server";

type LoadRequest = {
  scriptUrl?: string;
  token?: string;
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
  let body: LoadRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Dữ liệu nạp Drive không hợp lệ." }, { status: 400 });
  }

  if (!body.scriptUrl || !isAllowedAppsScriptUrl(body.scriptUrl) || !body.token) {
    return NextResponse.json({ ok: false, error: "Thiếu cấu hình Google Apps Script." }, { status: 400 });
  }

  try {
    const scriptResponse = await fetch(body.scriptUrl, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "load-consulting", token: body.token }),
      redirect: "follow",
    });
    const responseText = await scriptResponse.text();
    let result: { ok?: boolean; error?: string; years?: unknown[] };
    try {
      result = JSON.parse(responseText) as typeof result;
    } catch {
      return NextResponse.json({ ok: false, error: "Google Apps Script trả về dữ liệu không hợp lệ." }, { status: 502 });
    }
    if (!scriptResponse.ok || !result.ok || !Array.isArray(result.years)) {
      return NextResponse.json({ ok: false, error: result.error || "Không thể nạp dữ liệu Excel từ Drive." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, years: result.years }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Không thể kết nối Google Apps Script để nạp Drive." }, { status: 502 });
  }
}
