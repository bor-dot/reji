import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Beat, Hook, Seo, Shot, ShotKind, Thumb, TitleOption } from "./types";
import { readModelAny } from "./prompts";

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
        voice: z.string().min(1).max(1800),
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
  const beats = Array.isArray(root.beats)
    ? root.beats.map((item) => {
        const row = asRecord(item);
        if (!row) return item;
        return {
          ...row,
          time: clip(row.time, 16, "0:00"),
          title: clip(row.title, 80, "Devam"),
          voice: clip(row.voice, 1800, "…"),
          screen: clip(row.screen, 160, "Anlatı"),
          visual: clip(row.visual, 240, "Sahne sürer."),
        };
      })
    : root.beats;
  return { ...root, shots, titles, beats };
}

export function parseGeneratedPack(raw: unknown) {
  return GeneratedSchema.safeParse(normalize(raw));
}

function extractJson(text: string): unknown {
  const value = readModelAny(text);
  if (value == null) throw new Error("JSON yok");
  return value;
}

function salvageNarration(raw: string) {
  const key = raw.search(/"text"\s*:/);
  if (key < 0) return "";
  const quote = raw.indexOf('"', raw.indexOf(":", key) + 1);
  if (quote < 0) return "";
  let out = "";
  for (let index = quote + 1; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\\") {
      const next = raw[index + 1];
      out += next === "n" ? "\n" : next === "t" ? "\t" : next === "u" ? "" : (next ?? "");
      if (next === "u") index += 4;
      index += 1;
      continue;
    }
    if (char === '"') break;
    out += char;
  }
  const text = out.trim();
  const end = Math.max(text.lastIndexOf("."), text.lastIndexOf("!"), text.lastIndexOf("?"), text.lastIndexOf("…"));
  return end > 40 ? text.slice(0, end + 1).trim() : text;
}

type SealedKey = { iv: string; ciphertext: string };

function writerOf(value: unknown) {
  if (value === "cli" || value === "grok" || value === "codex" || value === "claude" || value === "gemini") return value;
  return "api" as const;
}

function sealedOf(value: unknown): SealedKey | undefined {
  const sealed = asRecord(value);
  if (sealed && typeof sealed.iv === "string" && typeof sealed.ciphertext === "string") {
    return { iv: sealed.iv, ciphertext: sealed.ciphertext };
  }
  return undefined;
}

function viaOf(value: unknown): "api" | "grok" | "codex" | "claude" | "gemini" | null {
  if (value === "api" || value === "grok" || value === "codex" || value === "claude" || value === "gemini") return value;
  return null;
}

async function draftText(input: {
  writer: string;
  via?: unknown;
  model: string;
  system: string;
  user: string;
  sealed?: SealedKey;
  maxTokens?: number;
}): Promise<{ ok: true; text: string; label: string } | { ok: false; error: string; stopped?: boolean }> {
  const { completeText } = await import("./ai-runtime");
  const hinted = viaOf(input.via);
  const result = await completeText({
    model: input.model,
    system: input.system,
    user: input.user,
    sealed: input.sealed,
    json: true,
    maxTokens: input.maxTokens,
    writer: hinted && hinted !== "api" ? hinted : input.writer,
  });
  if (!result.ok) return { ok: false, error: result.error, stopped: result.stopped };
  return { ok: true, text: result.text, label: result.via };
}

export const deepenPack = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }): Promise<
    { ok: true; pack: GeneratedPack; label: string } | { ok: false; error: string }
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
    const writer = writerOf(record?.writer);
    const sealedKey = sealedOf(record?.sealed);
    const channelNote = typeof record?.channelNote === "string" ? record.channelNote.slice(0, 800) : "";

    const lang = brief.language === "en" ? "English" : "Turkish";
    const system = [
      "You are a senior YouTube writer and showrunner. The pack must be shootable tomorrow.",
      `Write every audience-facing string in ${lang}.`,
      "Return one JSON object and nothing else. A json code fence is allowed if the tool requires it.",
      "Spoken lines sound like a film, not a blog. No greetings, no 'bu videoda', no filler, no fake cliffhanger.",
      "Open on a concrete image or a checkable fact. Every beat changes what the viewer sees.",
      "The video must be able to pay every claim. No fake curiosity, no fear in children's films, no sarcasm aimed at a child.",
      "For belgesel: claim and evidence live in different sentences. Do not invent sources beyond the ones given.",
      "For cocuk: 3–6 age, warm, a repeatable line, no monster, no death.",
      "For shorts: spoken draft fits about 45 seconds, one claim, a loop back to the first frame.",
      "Voice is narration only. Directing notes go in visual, screen, cut, face, layout — never in voice.",
      "Thumbnail words: at most 5, and they must not repeat the video title.",
      `Spoken voice across the beats of this first section should be about ${Math.min(700, Math.max(120, Math.round((brief.minutes <= 5 ? 650 : brief.minutes <= 10 ? 1300 : brief.minutes <= 20 ? 2600 : 3900) / 3)))} words. Stop at a clean beat if the full runtime is longer.`,
      "Chapters start at 0:00 and match beat times. Description is written for a person, not a keyword list.",
      "shot.n is a short string. shot.must is a boolean. Put constraints in do, not in must.",
      "Schema keys: titles[{text,angle,why}], hooks[{window,line,visual,cut}], beats[{time,title,voice,screen,visual}], shots[{n,kind,frame,do,sec,must}], thumb{words,face,layout,contrast,ban}, seo{description,chapters[{time,title}],tags,pinned,end}.",
      "shot.kind is exactly one of: A-roll, B-roll, Grafik, Ses.",
      channelNote,
    ]
      .filter(Boolean)
      .join(" ");

    try {
      const result = await draftText({
        writer,
        via: record?.via,
        model: textModel,
        system,
        user: JSON.stringify(brief),
        sealed: sealedKey,
      });
      if (!result.ok) return { ok: false, error: result.error };
      let parsedPack: ReturnType<typeof extractJson> | undefined;
      let text = result.text;
      let label = result.label;
      for (let attempt = 0; attempt < 2 && parsedPack == null; attempt += 1) {
        try {
          parsedPack = extractJson(text);
        } catch (error) {
          console.warn(error);
          if (attempt === 1) {
            return { ok: false, error: error instanceof Error ? error.message : "JSON yok" };
          }
          const again = await draftText({
            writer,
            via: record?.via,
            model: textModel,
            system,
            user: `${JSON.stringify(brief)}\n\nSadece JSON döndür.`,
            sealed: sealedKey,
          });
          if (!again.ok) return { ok: false, error: again.error };
          text = again.text;
          label = again.label;
        }
      }
      if (parsedPack == null) return { ok: false, error: "JSON yok" };
      const pack = parseGeneratedPack(parsedPack);
      if (!pack.success) {
        return { ok: false, error: "Paket eksik döndü. Senaryoda Devam et ya da masa kalıbında kal." };
      }
      return { ok: true, pack: pack.data, label };
    } catch (error) {
      console.warn(error);
      return { ok: false, error: error instanceof Error ? error.message : "Bağlantı koptu. Masa kalıbı duruyor." };
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
    const key = sealed.success ? sealed.data : undefined;
    const route = row?.route === "gemini" ? "gemini" : "xai";
    if (route === "gemini") {
      const { geminiImage } = await import("./ai-runtime");
      const chosen = model.startsWith("imagen") || model.startsWith("gemini") ? model : "gemini-2.5-flash-image";
      return geminiImage(prompt, chosen, key);
    }
    const { imagineImage } = await import("./ai-runtime");
    return imagineImage(prompt, model, key);
  });

export const startSceneVideo = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const prompt = typeof row?.prompt === "string" ? row.prompt.slice(0, 2000) : "";
    const model = typeof row?.model === "string" ? row.model : "grok-imagine-video-1.5-lite";
    if (prompt.length < 8) return { ok: false as const, error: "Prompt kısa." };
    const sealed = SealedSchema.safeParse(row?.sealed);
    const key = sealed.success ? sealed.data : undefined;
    const route = row?.route === "gemini" ? "gemini" : "xai";
    if (route === "gemini") {
      const { startVeo } = await import("./ai-runtime");
      return startVeo(prompt, row?.resolution === "1080p" ? "1080p" : "720p", key);
    }
    const { startVideo } = await import("./ai-runtime");
    return startVideo(prompt, model, key);
  });

export const pollSceneVideo = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const requestId = typeof row?.requestId === "string" ? row.requestId : "";
    const sealed = SealedSchema.safeParse(row?.sealed);
    const key = sealed.success ? sealed.data : undefined;
    if (row?.route === "gemini") {
      const { pollVeo } = await import("./ai-runtime");
      return pollVeo(requestId, key);
    }
    const { pollVideo } = await import("./ai-runtime");
    return pollVideo(requestId, key);
  });

export const grokLink = createServerFn({ method: "GET" }).handler(async () => {
  const { describeGrok } = await import("./ai-runtime");
  return describeGrok();
});

export const probeLocalClis = createServerFn({ method: "GET" }).handler(async () => {
  const { probeClis } = await import("./ai-runtime");
  return probeClis({ fresh: true });
});

export const planTextSource = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const { chooseTextRoute } = await import("./ai-runtime");
    return chooseTextRoute({
      writer: writerOf(row?.writer),
      model: typeof row?.textModel === "string" ? row.textModel : "grok-4.5",
      sealed: sealedOf(row?.sealed),
    });
  });

export const speakScript = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const text = typeof row?.text === "string" ? row.text.slice(0, 3000) : "";
    const voiceId = typeof row?.voiceId === "string" ? row.voiceId : "eve";
    const speed = typeof row?.speed === "number" ? row.speed : 1;
    const language = row?.language === "en" ? "en" : "tr";
    const sealed = SealedSchema.safeParse(row?.sealed);
    const { speakText } = await import("./ai-runtime");
    return speakText({
      text,
      voiceId,
      speed,
      language,
      sealed: sealed.success ? sealed.data : undefined,
    });
  });

export const sendToKarevo = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const scenes = Array.isArray(row?.scenes) ? row.scenes : [];
    if (!row || typeof row.folderName !== "string" || typeof row.name !== "string" || scenes.length === 0) {
      return { ok: false as const, error: "Paket boş.", missing: [] as string[] };
    }
    const { sendKarevo } = await import("./karevo-write");
    const parsed = [];
    for (const item of scenes.slice(0, 24)) {
      const scene = asRecord(item);
      if (!scene || typeof scene.n !== "number" || typeof scene.imageUrl !== "string" || typeof scene.audioBase64 !== "string") {
        return { ok: false as const, error: "Paket eksik.", missing: ["Bir sahne okunamadı."] };
      }
      parsed.push({
        n: scene.n,
        title: typeof scene.title === "string" ? scene.title : "Sahne",
        text: typeof scene.text === "string" ? scene.text : "",
        simulation: scene.simulation === true,
        duration: typeof scene.duration === "number" ? scene.duration : 0,
        imageUrl: scene.imageUrl,
        videoUrl: typeof scene.videoUrl === "string" && scene.videoUrl ? scene.videoUrl : undefined,
        audioBase64: scene.audioBase64,
      });
    }
    return sendKarevo({
      folderName: row.folderName,
      name: row.name,
      channel: typeof row.channel === "string" ? row.channel : "Kanal",
      resolution: typeof row.resolution === "string" ? row.resolution : "1920x1080",
      scenes: parsed,
    });
  });

const ContinueBeat = z.object({
  time: z.string().min(1).max(16),
  title: z.string().min(1).max(80),
  voice: z.string().min(1).max(1800),
  screen: z.string().min(1).max(160),
  visual: z.string().min(1).max(240),
});

export const continueBeats = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const title = typeof row?.title === "string" ? row.title.slice(0, 120) : "";
    const soFar = typeof row?.soFar === "number" ? row.soFar : 0;
    const target = typeof row?.target === "number" ? row.target : 650;
    const last = typeof row?.last === "string" ? row.last.slice(0, 500) : "";
    const language = row?.language === "en" ? "English" : "Turkish";
    if (title.length < 2) return { ok: false as const, error: "Başlık yok.", cut: false };
    const writer = writerOf(row?.writer);
    const textModel = typeof row?.textModel === "string" ? row.textModel : "grok-4.5";
    const sealedKey = sealedOf(row?.sealed);
    const system = [
      "Continue a YouTube script. Return one JSON object and nothing else.",
      `Write audience-facing strings in ${language}.`,
      `The film still needs spoken words. So far ${soFar} of ${target}.`,
      "Add only the next section, about 350 spoken words, split across beats.",
      "Each voice field stays under 700 characters. End on a finished sentence.",
      "Schema: {beats:[{time,title,voice,screen,visual}]}. time is m:ss. voice is narration only. No directing inside voice.",
      "Do not repeat the previous beat.",
    ].join(" ");
    const user = `Title: ${title}\nLast beat:\n${last}`;
    try {
      const result = await draftText({
        writer,
        via: row?.via,
        model: textModel,
        system,
        user,
        sealed: sealedKey,
        maxTokens: 2200,
      });
      if (!result.ok) return { ok: false as const, error: result.error, cut: true };
      let raw: unknown;
      try {
        raw = extractJson(result.text);
      } catch (error) {
      console.warn(error);
        raw = null;
      }
      const root = asRecord(raw);
      const list = Array.isArray(root?.beats) ? root.beats : Array.isArray(raw) ? raw : [];
      const beats = list.flatMap((item) => {
        const row = asRecord(item);
        const parsed = ContinueBeat.safeParse(
          row
            ? {
                time: clip(row.time, 16, "0:00"),
                title: clip(row.title, 80, "Devam"),
                voice: clip(row.voice, 1800, ""),
                screen: clip(row.screen, 160, "Anlatı"),
                visual: clip(row.visual, 240, "Sahne sürer."),
              }
            : item,
        );
        return parsed.success && parsed.data.voice !== "…" ? [parsed.data] : [];
      });
      if (!beats.length) {
        const again = await draftText({
          writer,
          via: row?.via,
          model: textModel,
          system,
          user: `${user}\n\nSadece JSON döndür.`,
          sealed: sealedKey,
          maxTokens: 2200,
        });
        if (!again.ok) return { ok: false as const, error: again.error, cut: true };
        try {
          raw = extractJson(again.text);
        } catch (error) {
          console.warn(error);
          raw = null;
        }
        const retryRoot = asRecord(raw);
        const retryList = Array.isArray(retryRoot?.beats) ? retryRoot.beats : Array.isArray(raw) ? raw : [];
        const retryBeats = retryList.flatMap((item) => {
          const beat = asRecord(item);
          const parsed = ContinueBeat.safeParse(
            beat
              ? {
                  time: clip(beat.time, 16, "0:00"),
                  title: clip(beat.title, 80, "Devam"),
                  voice: clip(beat.voice, 1800, ""),
                  screen: clip(beat.screen, 160, "Anlatı"),
                  visual: clip(beat.visual, 240, "Sahne sürer."),
                }
              : item,
          );
          return parsed.success && parsed.data.voice !== "…" ? [parsed.data] : [];
        });
        if (retryBeats.length) return { ok: true as const, beats: retryBeats, cut: false };
        const prose = salvageNarration(again.text) || result.text.replace(/```json|```/g, "").trim();
        if (prose.length < 80 || prose.startsWith("{")) {
          return { ok: false as const, error: "Metin kesildi. Yine Devam et.", cut: true };
        }
        return {
          ok: true as const,
          beats: [{ time: "devam", title: "Devam", voice: clip(prose, 1800), screen: "Anlatı", visual: "Önceki sahne sürer." }],
          cut: true,
        };
      }
      const cut = result.text.trim().endsWith("}") ? false : true;
      return { ok: true as const, beats, cut };
    } catch (error) {
      console.warn(error);
      return { ok: false as const, error: error instanceof Error ? error.message : "Bağlantı koptu.", cut: true };
    }
  });

export const writeNarration = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const title = typeof row?.title === "string" ? row.title.slice(0, 120) : "";
    if (title.length < 2) return { ok: false as const, error: "Başlık yok." };
    const sources = typeof row?.sources === "string" ? row.sources.slice(0, 2000) : "";
    if (row?.needsSources && !sources.trim()) return { ok: false as const, error: "Belgeselde önce kaynak alanını doldur." };
    const target = typeof row?.target === "number" ? row.target : 650;
    const soFar = typeof row?.soFar === "number" ? row.soFar : 0;
    const ask = Math.min(420, Math.max(140, target - soFar));
    const previous = typeof row?.previous === "string" ? row.previous.slice(-1800) : "";
    const language = row?.language === "en" ? "English" : "Turkish";
    const writer = writerOf(row?.writer);
    const textModel = typeof row?.textModel === "string" ? row.textModel : "grok-4.5";
    const system = [
      "You are a professional voice-over writer for YouTube.",
      `Write in ${language}.`,
      `This pass is about ${ask} spoken words.`,
      "Write the film, not an outline. Short sentences. One idea each. Concrete nouns. Room to breathe.",
      "No greetings, no 'bu videoda', no titles, no timecodes, no shot lists, no markdown.",
      "Do not write [GÖRSEL], [EKRAN] or [ANİMASYON].",
      "Separate paragraphs with a blank line. The listener hears every word.",
      "Do not invent sources or claim a fact you were not given.",
      previous ? "Continue after the text already written. Do not repeat it." : "Start with the opening image, said out loud.",
      'Return one JSON object: {"text":"the narration"}',
    ].join(" ");
    const user = [
      `Title: ${title}`,
      `Promise: ${typeof row?.promise === "string" ? row.promise.slice(0, 400) : ""}`,
      `Audience: ${typeof row?.audience === "string" ? row.audience.slice(0, 80) : ""}`,
      `Tone: ${typeof row?.tone === "string" ? row.tone.slice(0, 40) : ""}`,
      `Channel: ${typeof row?.channelNote === "string" ? row.channelNote.slice(0, 500) : ""}`,
      sources ? `Sources:\n${sources}` : "",
      previous ? `Already written:\n${previous}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const result = await draftText({
        writer,
        via: row?.via,
        model: textModel,
        system,
        user,
        sealed: sealedOf(row?.sealed),
        maxTokens: 2200,
      });
      if (!result.ok) return { ok: false as const, error: result.error };
      let text = "";
      let cut = false;
      try {
        const parsed = asRecord(extractJson(result.text));
        if (typeof parsed?.text === "string") text = parsed.text.trim();
      } catch (error) {
      console.warn(error);
        text = salvageNarration(result.text);
        cut = Boolean(text);
      }
      if (text.length < 40) {
        const again = await draftText({
          writer,
          via: row?.via,
          model: textModel,
          system,
          user: `${user}\n\nSadece JSON döndür.`,
          sealed: sealedOf(row?.sealed),
          maxTokens: 2200,
        });
        if (!again.ok) return { ok: false as const, error: again.error };
        try {
          const parsed = asRecord(extractJson(again.text));
          if (typeof parsed?.text === "string") text = parsed.text.trim();
        } catch (error) {
          console.warn(error);
          text = salvageNarration(again.text);
        }
        if (text.length < 40) {
          const plain = again.text.replace(/```json|```/g, "").trim();
          if (plain.length > 40 && !plain.startsWith("{")) text = plain;
        }
        if (text.length < 40) return { ok: false as const, error: "Metin kesildi. Yine Devam et." };
        return { ok: true as const, text, label: again.label, cut: !again.text.trim().endsWith("}") };
      }
      if (!result.text.trim().endsWith("}")) cut = true;
      return { ok: true as const, text, label: result.label, cut };
    } catch (error) {
      console.warn(error);
      return { ok: false as const, error: error instanceof Error ? error.message : "Bağlantı koptu." };
    }
  });

export const startSesleJob = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const chunks = Array.isArray(row?.chunks) ? row.chunks.filter((item): item is string => typeof item === "string").slice(0, 12) : [];
    const folder = typeof row?.folder === "string" ? row.folder.replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 80) : "";
    if (!folder || chunks.length === 0) return { ok: false as const, error: "Sesle için metin yok." };
    const { startSesle } = await import("./sesle-run");
    return startSesle({
      folder,
      voice: typeof row?.voice === "string" ? row.voice.slice(0, 40) : "Ultra Epic",
      speed: typeof row?.speed === "number" ? row.speed : 1,
      chunks,
      only: typeof row?.only === "number" ? row.only : undefined,
    });
  });

export const pollSesleJob = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const id = typeof row?.jobId === "string" ? row.jobId : "";
    const { sesleJob } = await import("./sesle-run");
    const job = sesleJob(id);
    if (!job) return { ok: false as const, error: "İş yok." };
    return { ok: true as const, job };
  });
