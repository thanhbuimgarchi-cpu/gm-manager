import { NextResponse } from "next/server";

const MAX_AUDIO_BYTES = 18 * 1024 * 1024;

function isAllowedAppsScriptUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "script.google.com" && url.pathname.startsWith("/macros/s/");
  } catch {
    return false;
  }
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  }
  return btoa(binary);
}

function inferAudioMimeType(file: File) {
  if (file.type.startsWith("audio/")) return file.type;
  const extension = file.name.toLowerCase().split(".").pop();
  return ({ mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac" } as Record<string, string>)[extension ?? ""] ?? "";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audio = formData.get("audio");
    const scriptUrl = formData.get("scriptUrl");
    const token = formData.get("token");
    if (!(audio instanceof File)) return NextResponse.json({ ok: false, error: "Hãy chọn một file ghi âm." }, { status: 400 });
    if (typeof scriptUrl !== "string" || !isAllowedAppsScriptUrl(scriptUrl) || typeof token !== "string" || !token) {
      return NextResponse.json({ ok: false, error: "Hãy kết nối Google Apps Script trước khi nhập ghi âm." }, { status: 400 });
    }

    const mimeType = inferAudioMimeType(audio);
    if (!mimeType) return NextResponse.json({ ok: false, error: "Chỉ hỗ trợ file MP3, WAV, M4A, AAC, OGG hoặc FLAC." }, { status: 400 });
    if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ ok: false, error: "File tối đa 18 MB. Hãy chia nhỏ bản ghi trước khi nhập." }, { status: 413 });

    const scriptResponse = await fetch(scriptUrl, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "audio-insight",
        token,
        audio: { fileName: audio.name, mimeType, data: toBase64(new Uint8Array(await audio.arrayBuffer())) },
      }),
      redirect: "follow",
    });
    const responseText = await scriptResponse.text();
    let result: { ok?: boolean; error?: string; language?: string; segments?: unknown[]; keyPoints?: string[] };
    try {
      result = JSON.parse(responseText) as typeof result;
    } catch {
      return NextResponse.json({ ok: false, error: "Google Apps Script trả về dữ liệu không hợp lệ. Hãy triển khai lại Script." }, { status: 502 });
    }
    if (!scriptResponse.ok || !result.ok) {
      return NextResponse.json({ ok: false, error: result.error || "Google Apps Script không thể xử lý ghi âm." }, { status: 502 });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Không thể kết nối Google Apps Script. Hãy kiểm tra Web app URL." }, { status: 502 });
  }
}
