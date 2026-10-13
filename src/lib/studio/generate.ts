import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Beat, Hook, Seo, Shot, ShotKind, Thumb, TitleOption } from "./types";

const BriefSchema = z.object({
  title: z.string().trim().min(2).max(120),
  format: z.enum(["uzun", "shorts", "belgesel", "cocuk"]),
  audience: z.string().trim().min(2).max(80),
  minutes: z.number().int().min(1).max(30),
  tone: z.string().trim().min(2).max(40),
  promise: z.string().trim().min(8).max(400),
  language: z.enum(["tr", "en"]),
  sources: z.string().trim().max(2000).optional(),
});

const GeneratedSchema = z.object({
  titles: z
    .array(
      z.object({
        text: z.string().min(1).max(120),
        angle: z.string().min(1).max(40),
        why: z.string().min(1).max(280),
      }),
    )
    .min(3)
    .max(6),
  hooks: z
    .array(
      z.object({
        window: z.string().min(1).max(24),
        line: z.string().min(1).max(400),
        visual: z.string().min(1).max(240),
        cut: z.string().min(1).max(180),
      }),
    )
    .min(2)
    .max(4),
  beats: z
    .array(
      z.object({
        time: z.string().min(1).max(16),
        title: z.string().min(1).max(80),
        voice: z.string().min(1).max(700),
        screen: z.string().min(1).max(160),
        visual: z.string().min(1).max(240),
      }),
    )
    .min(4)
    .max(10),
  shots: z
    .array(
      z.object({
        n: z.string().min(1).max(8),
        kind: z.enum(["A-roll", "B-roll", "Grafik", "Ses"]),
        frame: z.string().min(1).max(80),
        do: z.string().min(1).max(240),
        sec: z.number().min(1).max(180),
        must: z.boolean(),
      }),
    )
    .min(4)
    .max(18),
  thumb: z.object({
    words: z.string().min(1).max(40),
    face: z.string().min(1).max(220),
    layout: z.string().min(1).max(240),
    contrast: z.string().min(1).max(180),
    ban: z.string().min(1).max(180),
  }),
  seo: z.object({
    description: z.string().min(40).max(2500),
    chapters: z
      .array(
        z.object({
          time: z.string().min(1).max(12),
          title: z.string().min(1).max(80),
        }),
      )
      .min(3)
      .max(12),
    tags: z.array(z.string().min(2).max(32)).min(3).max(15),
    pinned: z.string().min(1).max(400),
    end: z.string().min(1).max(320),
  }),
});

export type GeneratedPack = {
  titles: TitleOption[];
  hooks: Hook[];
  beats: Beat[];
  shots: Shot[];
  thumb: Thumb;
  seo: Seo;
};

function kindOf(value: unknown): ShotKind {
  const s = String(value ?? "").toLowerCase();
  if (s.includes("graf") || s.includes("graphic")) return "Grafik";
  if (s.includes("ses") || s.includes("vo") || s.includes("voice") || s.includes("narr"))
    return "Ses";
  if (s.includes("b-roll") || s.includes("broll") || s.includes("b roll") || s === "b")
    return "B-roll";
  return "A-roll";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clip(value: unknown, max: number, fallback = "") {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const base = text || fallback;
  if (base.length <= max) return base;
  return `${base.slice(0, max - 1).trimEnd()}…`;
}

function asBool(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const s = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!s || s === "false" || s === "0" || s === "no" || s === "hayır" || s === "yedek") return false;
  return true;
}

function mustNote(value: unknown) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 12) return "";
  if (/^(true|false|yes|no|zorunlu|yedek)$/i.test(text)) return "";
  return text;
}

function normalize(raw: unknown): unknown {
  const root = asRecord(raw);
  if (!root) return raw;
  const shots = Array.isArray(root.shots)
    ? root.shots.map((shot, index) => {
        const row = asRecord(shot);
        if (!row) return shot;
        const sec = Number(row.sec ?? row.seconds ?? 4);
        const note = mustNote(row.must);
        const action = [clip(row.do ?? row.action, 200), note].filter(Boolean).join(" ");
        return {
          n: clip(row.n ?? index + 1, 8, String(index + 1)),
          kind: kindOf(row.kind),
          frame: clip(row.frame, 80, "Orta"),
          do: clip(action, 240, "Çekim"),
          sec: Number.isFinite(sec) ? Math.min(180, Math.max(1, Math.round(sec))) : 4,
          must: asBool(row.must),
        };
      })
    : root.shots;
  const titles = Array.isArray(root.titles)
    ? root.titles.map((item) => {
        const row = asRecord(item);
        if (!row) return item;
        return {
          text: clip(row.text, 120, "Başlıksız"),
          angle: clip(row.angle, 40, "açı"),
          why: clip(row.why, 280, "Bu başlık vaadi taşır."),
        };
      })
    : root.titles;
  return { ...root, shots, titles };
}

export function parseGeneratedPack(raw: unknown) {
  return GeneratedSchema.safeParse(normalize(raw));
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSON yok");
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

export const deepenPack = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }): Promise<
    { ok: true; pack: GeneratedPack } | { ok: false; error: string }
  > => {
    const record = asRecord(data);
    const briefInput = record && typeof record.title === "string" ? record : record?.brief;
    const parsed = BriefSchema.safeParse(briefInput);
    if (!parsed.success) return { ok: false, error: "Brief eksik ya da çok uzun." };
    const brief = parsed.data;
    const needsSources = Boolean(record?.needsSources);
    if (needsSources && !(brief.sources ?? "").trim()) {
      return { ok: false, error: "Belgeselde önce kaynak alanını doldur." };
    }
    const textModel = typeof record?.textModel === "string" ? record.textModel : "grok-4.5";
    const sealed = asRecord(record?.sealed);
    const sealedKey =
      sealed && typeof sealed.iv === "string" && typeof sealed.ciphertext === "string"
        ? { iv: sealed.iv, ciphertext: sealed.ciphertext }
        : undefined;
    const channelNote = typeof record?.channelNote === "string" ? record.channelNote.slice(0, 800) : "";

    const lang = brief.language === "en" ? "English" : "Turkish";
    const system = [
      "You are a YouTube showrunner writing a production pack.",
      `Write every audience-facing string in ${lang}.`,
      "Return one JSON object and nothing else.",
      "The video must be able to pay every claim. No fake curiosity, no fear in children's films, no sarcasm aimed at a child.",
      "For belgesel: claim and evidence live in different sentences. Do not invent sources beyond the ones given.",
      "For cocuk: 3–6 age, warm, a repeatable line, no monster, no death.",
      "For shorts: spoken draft fits about 45 seconds, one claim, a loop back to the first frame.",
      "Voice lines are speakable. Directing notes go in visual, cut, face, layout — not in voice.",
      "Thumbnail words: at most 5, and they must not repeat the video title.",
      "Chapters start at 0:00 and match beat times.",
      "shot.n is a short string. shot.must is a boolean. Put constraints in do, not in must.",
      "Schema keys: titles[{text,angle,why}], hooks[{window,line,visual,cut}], beats[{time,title,voice,screen,visual}], shots[{n,kind,frame,do,sec,must}], thumb{words,face,layout,contrast,ban}, seo{description,chapters[{time,title}],tags,pinned,end}.",
      "shot.kind is exactly one of: A-roll, B-roll, Grafik, Ses.",
      channelNote,
    ]
      .filter(Boolean)
      .join(" ");

    try {
      const { completeText } = await import("./ai-runtime");
      const result = await completeText({
        model: textModel,
        system,
        user: JSON.stringify(brief),
        sealed: sealedKey,
        json: true,
      });
      if (!result.ok) return { ok: false, error: result.error };
      const pack = parseGeneratedPack(extractJson(result.text));
      if (!pack.success) {
        return { ok: false, error: "Paket eksik döndü. Tekrar dene ya da masa kalıbında kal." };
      }
      return { ok: true, pack: pack.data };
    } catch {
      return { ok: false, error: "Bağlantı koptu. Masa kalıbı duruyor." };
    }
  });

const SealedSchema = z.object({ iv: z.string().min(8), ciphertext: z.string().min(8) }).optional();

export const sealProviderKey = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const provider = row?.provider;
    const key = typeof row?.key === "string" ? row.key.trim() : "";
    if (provider !== "xai" && provider !== "gemini" && provider !== "openai" && provider !== "anthropic") {
      return { ok: false as const, error: "Sağlayıcı yok." };
    }
    if (key.length < 12 || key.length > 400) return { ok: false as const, error: "Anahtar eksik." };
    const { sealSecret } = await import("./ai-runtime");
    const sealed = sealSecret(key);
    if (!sealed.ok) return sealed;
    return { ok: true as const, provider, hint: sealed.hint, iv: sealed.iv, ciphertext: sealed.ciphertext };
  });

export const testProviderKey = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const provider = row?.provider;
    if (provider !== "xai" && provider !== "gemini" && provider !== "openai" && provider !== "anthropic") {
      return { ok: false as const, error: "Sağlayıcı yok." };
    }
    const sealed = SealedSchema.safeParse(row?.sealed);
    const { testProvider } = await import("./ai-runtime");
    return testProvider(provider, sealed.success ? sealed.data : undefined);
  });

export const imagineScene = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const prompt = typeof row?.prompt === "string" ? row.prompt.slice(0, 2000) : "";
    const model = typeof row?.model === "string" ? row.model : "grok-imagine-image";
    if (prompt.length < 8) return { ok: false as const, error: "Prompt kısa." };
    const sealed = SealedSchema.safeParse(row?.sealed);
    const { imagineImage } = await import("./ai-runtime");
    return imagineImage(prompt, model, sealed.success ? sealed.data : undefined);
  });

export const startSceneVideo = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const prompt = typeof row?.prompt === "string" ? row.prompt.slice(0, 2000) : "";
    const model = typeof row?.model === "string" ? row.model : "grok-imagine-video-1.5-lite";
    if (prompt.length < 8) return { ok: false as const, error: "Prompt kısa." };
    const sealed = SealedSchema.safeParse(row?.sealed);
    const { startVideo } = await import("./ai-runtime");
    return startVideo(prompt, model, sealed.success ? sealed.data : undefined);
  });

export const pollSceneVideo = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const requestId = typeof row?.requestId === "string" ? row.requestId : "";
    const sealed = SealedSchema.safeParse(row?.sealed);
    const { pollVideo } = await import("./ai-runtime");
    return pollVideo(requestId, sealed.success ? sealed.data : undefined);
  });

export const probeLocalClis = createServerFn({ method: "GET" }).handler(async () => {
  const { probeClis } = await import("./ai-runtime");
  return probeClis();
});
