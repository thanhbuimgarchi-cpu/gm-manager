import { NextResponse } from "next/server";

const MAX_AUDIO_BYTES = 800 * 1024;

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
    const year = Number(formData.get("year"));
    const month = Number(formData.get("month"));
    const projectId = formData.get("projectId");
    const chunkIndex = Number(formData.get("chunkIndex"));
    const totalChunks = Number(formData.get("totalChunks"));
    const originalFileName = formData.get("originalFileName");
    if (!(audio instanceof File)) return NextResponse.json({ ok: false, error: "Hãy chọn một file ghi âm." }, { status: 400 });
    if (typeof scriptUrl !== "string" || !isAllowedAppsScriptUrl(scriptUrl) || typeof token !== "string" || !token) {
      return NextResponse.json({ ok: false, error: "Hãy kết nối Google Apps Script trước khi nhập ghi âm." }, { status: 400 });
    }
    if (!year || month < 1 || month > 12 || typeof projectId !== "string" || !projectId || chunkIndex < 0 || totalChunks < 1 || chunkIndex >= totalChunks) {
      return NextResponse.json({ ok: false, error: "Thiếu thông tin thư mục lưu ghi âm." }, { status: 400 });
    }

    const mimeType = inferAudioMimeType(audio);
    if (!mimeType) return NextResponse.json({ ok: false, error: "Chỉ hỗ trợ file MP3, WAV, M4A, AAC, OGG hoặc FLAC." }, { status: 400 });
    if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ ok: false, error: "Một đoạn ghi âm vẫn quá lớn để tải lên." }, { status: 413 });

    const scriptResponse = await fetch(scriptUrl, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "store-audio-chunk",
        token,
        year,
        month,
        projectId,
        chunkIndex,
        totalChunks,
        originalFileName: typeof originalFileName === "string" ? originalFileName : audio.name,
        audio: { fileName: audio.name, mimeType, data: toBase64(new Uint8Array(await audio.arrayBuffer())) },
      }),
      redirect: "follow",
    });
    const responseText = await scriptResponse.text();
    let result: { ok?: boolean; error?: string; fileUrl?: string };
    try {
      result = JSON.parse(responseText) as typeof result;
    } catch {
      return NextResponse.json({ ok: false, error: "Google Apps Script chưa hỗ trợ lưu đoạn ghi âm. Hãy dán lại mã Script mới và triển khai lại." }, { status: 502 });
    }
    if (!scriptResponse.ok || !result.ok) return NextResponse.json({ ok: false, error: result.error || "Không thể lưu file ghi âm vào Drive." }, { status: 502 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Không thể kết nối Google Apps Script để lưu ghi âm." }, { status: 502 });
  }
}
