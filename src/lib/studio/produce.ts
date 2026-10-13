import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { openExportFolder, writeShootFiles, type ShootFile } from "./karevo-write";
import { acceptStep, mediaPromptProblem, promptFor, readModelJson, sectionCount, type StepName } from "./prompts";

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

const STEP_IDS: StepName[] = ["baslik", "kanca", "senaryo", "metin", "sahneler", "gorsel", "video", "kapak", "kontrol"];

function stepOf(value: unknown): StepName {
  return STEP_IDS.includes(value as StepName) ? (value as StepName) : "baslik";
}

export const produceStep = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const step = stepOf(row?.step);
    const title = typeof row?.title === "string" ? row.title.slice(0, 160) : "";
    if (title.length < 2 && step === "baslik") return { ok: false as const, error: "Başlık yok." };
    const minutes = typeof row?.minutes === "number" ? row.minutes : 8;
    const vars: Record<string, string> = {
      kanal: typeof row?.kanal === "string" ? row.kanal : "Kanal",
      "konu_türü": typeof row?.konu === "string" ? row.konu : "Belgesel",
      kitle: typeof row?.audience === "string" ? row.audience : "",
      ton: typeof row?.tone === "string" ? row.tone : "",
      stil: typeof row?.stil === "string" ? row.stil : "",
      konu: title,
      vaat: typeof row?.promise === "string" ? row.promise.slice(0, 400) : "",
      baslik: typeof row?.pickedTitle === "string" && row.pickedTitle ? row.pickedTitle.slice(0, 80) : title,
      kanca: typeof row?.hook === "string" ? row.hook.slice(0, 500) : "",
      kaynaklar: typeof row?.sources === "string" ? row.sources.slice(0, 1500) : "",
      dakika: String(minutes),
      bolum_sayisi: String(typeof row?.bolum === "number" ? row.bolum : sectionCount(minutes)),
      senaryo: typeof row?.senaryo === "string" ? row.senaryo.slice(0, 6000) : "",
      parcalar: typeof row?.parcalar === "string" ? row.parcalar.slice(0, 4000) : "",
      anlatim: typeof row?.anlatim === "string" ? row.anlatim.slice(0, 500) : "",
      onceki: typeof row?.onceki === "string" ? row.onceki.slice(0, 500) : "yok",
      gorsel_prompt: typeof row?.gorsel === "string" ? row.gorsel.slice(0, 700) : "",
      ses: typeof row?.ses === "string" ? row.ses : "Ultra Epic",
      hız: "1.00×",
      kapak_stili: typeof row?.kapak === "string" ? row.kapak.slice(0, 400) : "",
      oran: row?.oran === "9:16" ? "9:16" : "16:9",
    };
    const { chooseProduceText, completeText, runCliText } = await import("./ai-runtime");
    const route = await chooseProduceText({
      model: typeof row?.model === "string" ? row.model : "grok-4.5",
      sealed: sealedOf(row?.sealed),
    });
    if (!route.ok) return route;
    const prompt = promptFor(step, vars);
    const ask = async (extra: string) => {
      const user = extra ? `${prompt}\n\n${extra}` : prompt;
      const written =
        route.via === "api"
          ? await completeText({
              model: route.model,
              system: "Sadece istenen JSON nesnesini ver.",
              user,
              sealed: sealedOf(row?.sealed),
              json: true,
              maxTokens: step === "senaryo" || step === "metin" || step === "sahneler" ? 2800 : 1400,
            })
          : await runCliText(route.via, user);
      return written.ok ? written.text : "";
    };
    let text = await ask("");
    let parsed = text ? readModelJson(text) : null;
    const ctx = { konu: vars.konu, anlatim: vars.anlatim };
    let accepted = parsed ? acceptStep(step, parsed, ctx) : null;
    if (!accepted) {
      const why =
        parsed && (step === "gorsel" || step === "video")
          ? mediaPromptProblem(step, parsed, ctx)
          : "Önceki yanıt bozuktu. Yalnızca şemadaki JSON'u ver, başka cümle yazma.";
      text = await ask(why || "Önceki yanıt bozuktu. Yalnızca şemadaki JSON'u ver, başka cümle yazma.");
      parsed = text ? readModelJson(text) : null;
      accepted = parsed ? acceptStep(step, parsed, ctx) : null;
    }
    if (!accepted) return { ok: false as const, error: "Bu adımın JSON'u okunamadı. Yine dene." };
    return { ok: true as const, label: route.label, step, ...accepted };
  });
