import { NextResponse } from "next/server";

type AudioSegment = { time: string; text: string };

const MAX_AUDIO_BYTES = 18 * 1024 * 1024;
const MAX_SUMMARY_CHUNKS = 20;
const GEMINI_MODEL = "gemini-3.6-flash";

const transcriptSchema = {
  type: "OBJECT",
  properties: {
    language: { type: "STRING", description: "Ngôn ngữ chính của bản ghi âm." },
    segments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          time: { type: "STRING", description: "Mốc thời gian dạng MM:SS, hoặc dấu ~ nếu không xác định được." },
          text: { type: "STRING", description: "Nội dung lời nói đã chuyển thành văn bản." },
        },
        required: ["time", "text"],
      },
    },
  },
  required: ["language", "segments"],
};

const pointsSchema = {
  type: "OBJECT",
  properties: {
    points: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
  },
  required: ["points"],
};

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  }
  return btoa(binary);
}

function splitTranscript(text: string) {
  const lines = text.split("\n").filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current && current.length + line.length + 1 > 6500) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function getResponseText(response: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }) {
  return response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
}

async function generateJson<T>(apiKey: string, contents: unknown, responseSchema: object): Promise<T> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
      },
    }),
  });
  const payload = await response.json() as { error?: { message?: string }; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  if (!response.ok) {
    throw new Error(payload.error?.message || "Gemini không thể xử lý bản ghi âm.");
  }
  const text = getResponseText(payload);
  if (!text) throw new Error("Gemini không trả về nội dung.");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Gemini trả về dữ liệu không đúng định dạng.");
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: "Chưa cấu hình Gemini API." }, { status: 503 });

  try {
    const formData = await request.formData();
    const audio = formData.get("audio");
    if (!(audio instanceof File)) return NextResponse.json({ ok: false, error: "Hãy chọn một file ghi âm." }, { status: 400 });
    if (!audio.type.startsWith("audio/")) return NextResponse.json({ ok: false, error: "Chỉ hỗ trợ file ghi âm." }, { status: 400 });
    if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ ok: false, error: "File tối đa 18 MB. Hãy chia nhỏ bản ghi trước khi nhập." }, { status: 413 });

    const audioData = toBase64(new Uint8Array(await audio.arrayBuffer()));
    const transcriptResult = await generateJson<{ language?: string; segments?: AudioSegment[] }>(apiKey, [{
      role: "user",
      parts: [
        { inline_data: { mime_type: audio.type, data: audioData } },
        { text: "Chuyển toàn bộ lời nói trong ghi âm thành văn bản chính xác. Chia theo các đoạn ý nghĩa, mỗi đoạn 1–3 câu, có mốc thời gian MM:SS nếu nhận biết được. Giữ nguyên tiếng Việt; không tự thêm thông tin." },
      ],
    }], transcriptSchema);

    const segments = (transcriptResult.segments ?? [])
      .filter((segment) => typeof segment?.text === "string" && segment.text.trim())
      .map((segment) => ({ time: typeof segment.time === "string" ? segment.time : "~", text: segment.text.trim() }));
    if (!segments.length) throw new Error("Không nhận diện được lời nói trong file ghi âm.");

    const transcript = segments.map((segment) => `[${segment.time}] ${segment.text}`).join("\n");
    const chunks = splitTranscript(transcript);
    if (chunks.length > MAX_SUMMARY_CHUNKS) throw new Error("Bản ghi quá dài để tóm tắt một lần. Hãy chia file ghi âm thành các phần ngắn hơn.");

    const partialPoints: string[] = [];
    for (const [index, chunk] of chunks.entries()) {
      const summary = await generateJson<{ points?: string[] }>(apiKey, [{
        role: "user",
        parts: [{ text: `Tóm tắt phần ${index + 1}/${chunks.length} dưới đây thành tối đa 4 ý chính ngắn, chỉ giữ quyết định, nhu cầu, số liệu, việc cần làm và rủi ro. Không lặp lại, không thêm nhận định ngoài văn bản.\n\n${chunk}` }],
      }], pointsSchema);
      partialPoints.push(...(summary.points ?? []).filter((point) => typeof point === "string" && point.trim()).map((point) => point.trim()));
    }

    const finalSummary = await generateJson<{ points?: string[] }>(apiKey, [{
      role: "user",
      parts: [{ text: `Gộp các ý dưới đây thành tối đa 10 ý chính cho hồ sơ khách hàng. Bỏ ý trùng, ưu tiên thông tin có thể hành động. Viết tiếng Việt ngắn gọn.\n\n${partialPoints.map((point) => `- ${point}`).join("\n")}` }],
    }], pointsSchema);

    return NextResponse.json({
      ok: true,
      language: transcriptResult.language || "Tiếng Việt",
      segments,
      keyPoints: (finalSummary.points ?? []).filter((point) => typeof point === "string" && point.trim()).map((point) => point.trim()),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể xử lý file ghi âm.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
