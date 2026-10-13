import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { openExportFolder, writeShootFiles, type ShootFile } from "./karevo-write";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function sealedOf(value: unknown) {
  const row = asRecord(value);
  if (!row || typeof row.iv !== "string" || typeof row.ciphertext !== "string") return undefined;
  return { iv: row.iv, ciphertext: row.ciphertext };
}

function runFile(bin: string, args: string[]) {
  return new Promise<boolean>((resolve) => {
    execFile(bin, args, { timeout: 120_000 }, (error) => resolve(!error));
  });
}

async function levelAudio(base64: string) {
  const dir = await mkdtemp(join(tmpdir(), "reji-ses-"));
  try {
    const raw = join(dir, "in.mp3");
    const out = join(dir, "out.mp3");
    await writeFile(raw, Buffer.from(base64, "base64"));
    const ok = await runFile("ffmpeg", ["-y", "-i", raw, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "44100", out]);
    const bytes = await readFile(ok ? out : raw);
    return bytes.toString("base64");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export const planProduceText = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const { chooseProduceText } = await import("./ai-runtime");
    return chooseProduceText({
      model: typeof row?.model === "string" ? row.model : "grok-4.5",
      sealed: sealedOf(row?.sealed),
    });
  });

export const produceMedia = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const prompt = typeof row?.prompt === "string" ? row.prompt.slice(0, 1800) : "";
    const kind = row?.kind === "video" ? "video" : "image";
    const aspect = row?.aspect === "9:16" ? "9:16" : "16:9";
    if (prompt.length < 8) return { ok: false as const, error: "Prompt kısa.", copy: false };
    const xai = sealedOf(row?.xai);
    const gemini = sealedOf(row?.gemini);
    const timeoutMs = kind === "video" ? 600_000 : 180_000;
    const { grokImagine } = await import("./grok-imagine-run");
    const web = await grokImagine({ prompt, kind, aspect, timeoutMs });
    if (web.ok) return { ok: true as const, url: web.url, source: web.source };
    if (kind === "image") {
      const { imagineImage, geminiImage } = await import("./ai-runtime");
      const model = typeof row?.imageModel === "string" ? row.imageModel : "grok-imagine-image";
      const xaiImage = await imagineImage(prompt, model, xai);
      if (xaiImage.ok) return { ok: true as const, url: xaiImage.url, source: "xAI" };
      const gem = await geminiImage(prompt, "gemini-2.5-flash-image", gemini);
      if (gem.ok) return { ok: true as const, url: gem.url, source: "Gemini" };
      return { ok: false as const, error: `${web.error} ${xaiImage.error}`, copy: true };
    }
    const { startVideo, pollVideo, startVeo, pollVeo } = await import("./ai-runtime");
    const videoModel = typeof row?.videoModel === "string" ? row.videoModel : "grok-imagine-video-1.5-lite";
    const started = await startVideo(prompt, videoModel, xai);
    if (started.ok) {
      const until = Date.now() + 540_000;
      while (Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const status = await pollVideo(started.requestId, xai);
        if (!status.ok) return { ok: false as const, error: status.error, copy: true };
        if (status.status === "done" && status.url) return { ok: true as const, url: status.url, source: "xAI" };
      }
    }
    const veo = await startVeo(prompt, row?.resolution === "1080p" ? "1080p" : "720p", gemini);
    if (veo.ok) {
      const until = Date.now() + 240_000;
      while (Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        const status = await pollVeo(veo.requestId, gemini);
        if (!status.ok) return { ok: false as const, error: status.error, copy: true };
        if (status.status === "done" && status.url) return { ok: true as const, url: status.url, source: "Veo" };
      }
    }
    const reason = started.ok ? "Video süresi doldu." : started.error;
    return { ok: false as const, error: `${web.error} ${reason}`, copy: true };
  });

export const produceVoice = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const text = typeof row?.text === "string" ? row.text.trim().slice(0, 1800) : "";
    if (text.length < 2) return { ok: false as const, error: "Ses için metin yok." };
    const folder = typeof row?.folder === "string" ? row.folder.slice(0, 80) : "cekim";
    const voice = typeof row?.sesle === "string" ? row.sesle : "Ultra Epic";
    const { startSesle, sesleJob } = await import("./sesle-run");
    const started = await startSesle({ folder, voice, speed: 1, chunks: [text] });
    if (started.ok) {
      const until = Date.now() + 150_000;
      while (Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const job = sesleJob(started.jobId);
        const chunk = job?.chunks[0];
        if (chunk?.status === "tamam" && chunk.audioBase64) {
          return { ok: true as const, audioBase64: chunk.audioBase64, source: "Sesle", duration: 0 };
        }
        if (job?.status === "hata" || chunk?.status === "hata") break;
      }
    }
    const { speakText } = await import("./ai-runtime");
    const spoken = await speakText({
      text,
      voiceId: typeof row?.xai === "string" ? row.xai : "ultra-epic",
      speed: 1,
      language: row?.language === "en" ? "en" : "tr",
      sealed: sealedOf(row?.sealed),
    });
    if (!spoken.ok) return { ok: false as const, error: spoken.error };
    const audioBase64 = await levelAudio(spoken.audioBase64);
    return { ok: true as const, audioBase64, source: "xAI Ses", duration: spoken.duration || 0 };
  });

export const saveShoot = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const scenes = Array.isArray(row?.scenes) ? row.scenes : [];
    const parsed: ShootFile[] = [];
    for (const item of scenes.slice(0, 24)) {
      const scene = asRecord(item);
      if (!scene || typeof scene.n !== "number") continue;
      parsed.push({
        n: scene.n,
        title: typeof scene.title === "string" ? scene.title : "Sahne",
        text: typeof scene.text === "string" ? scene.text : "",
        simulation: scene.simulation === true,
        duration: typeof scene.duration === "number" ? scene.duration : 6,
        imageUrl: typeof scene.imageUrl === "string" ? scene.imageUrl : undefined,
        videoUrl: typeof scene.videoUrl === "string" ? scene.videoUrl : undefined,
        audioBase64: typeof scene.audioBase64 === "string" ? scene.audioBase64 : undefined,
      });
    }
    if (!parsed.length) return { ok: false as const, error: "Yazılacak sahne yok." };
    return writeShootFiles({
      folderName: typeof row?.folderName === "string" ? row.folderName : "cekim",
      name: typeof row?.name === "string" ? row.name : "Çekim",
      channel: typeof row?.channel === "string" ? row.channel : "Kanal",
      resolution: typeof row?.resolution === "string" ? row.resolution : "1920x1080",
      scenes: parsed,
    });
  });

export const openShoot = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const folder = typeof row?.folderName === "string" ? row.folderName : "";
    return openExportFolder(folder);
  });

function readJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return asRecord(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
}

function clip(value: unknown, max: number, fallback: string) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  const base = text || fallback;
  return base.length <= max ? base : `${base.slice(0, max - 1).trimEnd()}…`;
}

export const produceStep = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const step = row?.step === "kanca" || row?.step === "senaryo" ? row.step : "baslik";
    const title = typeof row?.title === "string" ? row.title.slice(0, 120) : "";
    if (title.length < 2) return { ok: false as const, error: "Başlık yok." };
    const language = row?.language === "en" ? "English" : "Turkish";
    const brief = [
      `Working title: ${title}`,
      `Promise: ${typeof row?.promise === "string" ? row.promise.slice(0, 400) : ""}`,
      `Audience: ${typeof row?.audience === "string" ? row.audience.slice(0, 80) : ""}`,
      `Tone: ${typeof row?.tone === "string" ? row.tone.slice(0, 40) : ""}`,
      `Minutes: ${typeof row?.minutes === "number" ? row.minutes : 8}`,
      `Format: ${typeof row?.format === "string" ? row.format : "uzun"}`,
      typeof row?.sources === "string" && row.sources.trim() ? `Sources:\n${row.sources.slice(0, 1500)}` : "",
      typeof row?.channelNote === "string" ? row.channelNote.slice(0, 500) : "",
      typeof row?.pickedTitle === "string" ? `Chosen title: ${row.pickedTitle.slice(0, 120)}` : "",
      typeof row?.hook === "string" ? `Chosen hook: ${row.hook.slice(0, 300)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const system =
      step === "baslik"
        ? `You are a senior YouTube titler. Write in ${language}. Return only JSON {"titles":[{"text","angle","why"}]}. Exactly 4 titles. No script, no scenes. Thumbnail words stay out. A title is speakable and does not fake curiosity.`
        : step === "kanca"
          ? `You are a senior YouTube opener. Write in ${language}. Return only JSON {"hooks":[{"window","line","visual","cut"}]}. Exactly 3 hooks. window is a short range like 0:00-0:08. line is spoken. visual and cut are directing, not spoken. No full script.`
          : `You are a senior YouTube editor. Write in ${language}. Return only JSON {"beats":[{"time","title","voice","screen","visual"}]}. 5 to 7 beats covering the film. time is m:ss. voice is one spoken sentence, not the full narration. screen and visual are directing notes. Do not write the whole script.`;
    const { chooseProduceText, completeText, runCliText } = await import("./ai-runtime");
    const route = await chooseProduceText({
      model: typeof row?.model === "string" ? row.model : "grok-4.5",
      sealed: sealedOf(row?.sealed),
    });
    if (!route.ok) return route;
    const written =
      route.via === "api"
        ? await completeText({
            model: route.model,
            system,
            user: brief,
            sealed: sealedOf(row?.sealed),
            json: true,
            maxTokens: step === "senaryo" ? 2200 : 1200,
          })
        : await runCliText(route.via, `${system}\n\n${brief}`);
    if (!written.ok) return { ok: false as const, error: written.error };
    const parsed = readJson(written.text);
    if (!parsed) return { ok: false as const, error: "Bu adım eksik döndü. Yine dene." };
    if (step === "baslik") {
      const titles = (Array.isArray(parsed.titles) ? parsed.titles : [])
        .map((item) => {
          const beat = asRecord(item);
          if (!beat) return null;
          return { text: clip(beat.text, 120, title), angle: clip(beat.angle, 40, "açı"), why: clip(beat.why, 280, "Vaadi taşır.") };
        })
        .filter((item): item is { text: string; angle: string; why: string } => Boolean(item))
        .slice(0, 5);
      if (titles.length < 3) return { ok: false as const, error: "Başlıklar eksik. Yine dene." };
      return { ok: true as const, label: route.label, titles };
    }
    if (step === "kanca") {
      const hooks = (Array.isArray(parsed.hooks) ? parsed.hooks : [])
        .map((item) => {
          const beat = asRecord(item);
          if (!beat) return null;
          return {
            window: clip(beat.window, 24, "0:00-0:08"),
            line: clip(beat.line, 400, title),
            visual: clip(beat.visual, 240, "Tek plan."),
            cut: clip(beat.cut, 180, "Kes."),
          };
        })
        .filter((item): item is { window: string; line: string; visual: string; cut: string } => Boolean(item))
        .slice(0, 4);
      if (hooks.length < 2) return { ok: false as const, error: "Kancalar eksik. Yine dene." };
      return { ok: true as const, label: route.label, hooks };
    }
    const beats = (Array.isArray(parsed.beats) ? parsed.beats : [])
      .map((item) => {
        const beat = asRecord(item);
        if (!beat) return null;
        return {
          time: clip(beat.time, 16, "0:00"),
          title: clip(beat.title, 80, "Sahne"),
          voice: clip(beat.voice, 400, "…"),
          screen: clip(beat.screen, 160, "Anlatı"),
          visual: clip(beat.visual, 240, "Tek plan."),
        };
      })
      .filter((item): item is { time: string; title: string; voice: string; screen: string; visual: string } => Boolean(item))
      .slice(0, 8);
    if (beats.length < 4) return { ok: false as const, error: "Senaryo eksik. Yine dene." };
    return { ok: true as const, label: route.label, beats };
  });

