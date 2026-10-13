import { createServerFn } from "@tanstack/react-start";
import { acceptIdeas, promptFor, readModelAny, readSections, readStep, sectionCount, stepRetryHint, targetWords, type StepName } from "./prompts";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function sealedOf(value: unknown) {
  const row = asRecord(value);
  if (!row || typeof row.iv !== "string" || typeof row.ciphertext !== "string") return undefined;
  return { iv: row.iv, ciphertext: row.ciphertext };
}

export const haltProduce = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async () => {
    const { stopTrackedJobs } = await import("./ai-runtime.server");
    return { ok: true as const, stopped: stopTrackedJobs() };
  });

export const planProduceText = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const { chooseProduceText } = await import("./ai-runtime.server");
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
    const { grokImagine } = await import("./grok-imagine-run.server");
    const { currentWave } = await import("./ai-runtime.server");
    const wave = currentWave();
    const timeoutMs = kind === "video" ? 600_000 : 180_000;
    const web = await grokImagine({ prompt, kind, aspect, timeoutMs });
    if (currentWave() !== wave || (!web.ok && /durdur/i.test(web.error))) {
      return { ok: false as const, error: "Durduruldu.", copy: false };
    }
    if (web.ok) return { ok: true as const, url: web.url, source: web.source };
    if (kind === "image") {
      const { imagineImage, geminiImage } = await import("./ai-runtime.server");
      const model = typeof row?.imageModel === "string" ? row.imageModel : "grok-imagine-image";
      const xaiImage = await imagineImage(prompt, model, xai);
      if (xaiImage.ok) return { ok: true as const, url: xaiImage.url, source: "xAI" };
      const gem = await geminiImage(prompt, "gemini-2.5-flash-image", gemini);
      if (gem.ok) return { ok: true as const, url: gem.url, source: "Gemini" };
      return { ok: false as const, error: `${web.error} ${xaiImage.error}`, copy: true };
    }
    const { startVideo, pollVideo, startVeo, pollVeo } = await import("./ai-runtime.server");
    const videoModel = typeof row?.videoModel === "string" ? row.videoModel : "grok-imagine-video-1.5-lite";
    const started = await startVideo(prompt, videoModel, xai);
    if (started.ok) {
      const until = Date.now() + 540_000;
      while (Date.now() < until) {
        if (currentWave() !== wave) return { ok: false as const, error: "Durduruldu.", copy: false };
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
        if (currentWave() !== wave) return { ok: false as const, error: "Durduruldu.", copy: false };
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
    const { startSesle, sesleJob } = await import("./sesle-run.server");
    const { currentWave } = await import("./ai-runtime.server");
    const { saveVoiceFile, levelAudio } = await import("./project-files.server");
    const wave = currentWave();
    const started = await startSesle({ folder, voice, speed: 1, chunks: [text] });
    if (currentWave() !== wave) return { ok: false as const, error: "Durduruldu." };
    if (started.ok) {
      const until = Date.now() + 150_000;
      while (Date.now() < until) {
        if (currentWave() !== wave) return { ok: false as const, error: "Durduruldu." };
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const job = sesleJob(started.jobId);
        const chunk = job?.chunks[0];
        if (chunk?.status === "tamam" && chunk.audioBase64) {
          const path = await saveVoiceFile(row, chunk.audioBase64);
          return { ok: true as const, audioBase64: chunk.audioBase64, source: "Sesle", duration: 0, path };
        }
        if (job?.note === "Durduruldu." || currentWave() !== wave) return { ok: false as const, error: "Durduruldu." };
        if (job?.status === "hata" || chunk?.status === "hata") break;
      }
    }
    if (currentWave() !== wave) return { ok: false as const, error: "Durduruldu." };
    const { speakText } = await import("./ai-runtime.server");
    const spoken = await speakText({
      text,
      voiceId: typeof row?.xai === "string" ? row.xai : "ultra-epic",
      speed: 1,
      language: row?.language === "en" ? "en" : "tr",
      sealed: sealedOf(row?.sealed),
    });
    if (!spoken.ok) return { ok: false as const, error: spoken.error };
    const audioBase64 = await levelAudio(spoken.audioBase64);
    const path = await saveVoiceFile(row, audioBase64);
    return { ok: true as const, audioBase64, source: "xAI Ses", duration: spoken.duration || 0, path };
  });

export const saveShoot = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { writeShootFiles } = await import("./karevo-write.server");
    const row = asRecord(data);
    const scenes = Array.isArray(row?.scenes) ? row.scenes : [];
    const parsed = [];
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
    const { openExportFolder } = await import("./karevo-write.server");
    const row = asRecord(data);
    const folder = typeof row?.folderName === "string" ? row.folderName : "";
    return openExportFolder(folder);
  });

const STEP_IDS: StepName[] = ["baslik", "kanca", "senaryo", "metin", "sahneler", "gorsel", "video", "kapak", "kontrol", "altsahne", "yayin"];

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
      kelime: String(targetWords(minutes)),
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
    const { completeText } = await import("./ai-runtime.server");
    const model = typeof row?.model === "string" ? row.model : "grok-4.5";
    const sealed = sealedOf(row?.sealed);
    const prompt = promptFor(step, vars);
    const prose = step === "senaryo" || step === "metin" || step === "kanca";
    const ask = async (extra: string) => {
      const written = await completeText({
        model,
        system: prose && !extra ? "İstenen metni yaz. JSON varsa onu da kabul ederim." : "Sadece istenen JSON'u ver.",
        user: extra ? `${prompt}\n\n${extra}` : prompt,
        sealed,
        json: !prose || Boolean(extra),
        maxTokens: step === "senaryo" || step === "metin" || step === "sahneler" ? 2800 : 1400,
        writer: "cli",
      });
      if (!written.ok) return { ok: false as const, error: written.error, stopped: Boolean(written.stopped) };
      return { ok: true as const, text: written.text, label: written.via };
    };
    const ctx = { konu: vars.konu, anlatim: vars.anlatim, benzer: typeof row?.benzer === "string" ? row.benzer.slice(0, 700) : "" };
    let first = await ask("");
    if (!first.ok && first.stopped) return { ok: false as const, error: "Durduruldu." };
    let label = first.ok ? first.label : "API";
    let text = first.ok ? first.text : "";
    let accepted = text ? readStep(step, text, ctx) : null;
    if (!accepted) {
      const again = await ask(text ? stepRetryHint(step, text, ctx) : "Sadece JSON döndür.");
      if (!again.ok && again.stopped) return { ok: false as const, error: "Durduruldu." };
      if (again.ok) {
        text = again.text;
        label = again.label;
        accepted = readStep(step, text, ctx);
      }
    }
    if (!accepted) return { ok: false as const, error: first.ok ? "Bu adımın JSON'u okunamadı. Yine dene." : first.error };
    if (step === "senaryo" && accepted.bolumler && accepted.beats) {
      const goal = targetWords(minutes);
      let bolumler = accepted.bolumler;
      const words = () => bolumler.reduce((sum, item) => sum + item.metin.split(/\s+/).filter(Boolean).length, 0);
      let guard = 0;
      while (words() < goal * 0.85 && guard < 3) {
        guard += 1;
        const more = await ask(
          `Şu an ${words()} kelime var. Hedef ${goal}. Kalan bölümleri yaz, öncekileri tekrarlama. Yalnızca {"bolumler":[{"baslik":"","metin":""}]} ver. Metin yalnızca okunacak cümle olsun.`,
        );
        if (!more.ok) {
          if (more.stopped) return { ok: false as const, error: "Durduruldu." };
          break;
        }
        label = more.label;
        const parsed = readModelAny(more.text);
        const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
        const added = record ? readSections(record, 1) : null;
        if (!added) break;
        const seen = new Set(bolumler.map((item) => item.baslik));
        bolumler = [...bolumler, ...added.bolumler.filter((item) => !seen.has(item.baslik))];
      }
      const full = readSections({ bolumler }, Math.min(3, bolumler.length));
      if (full) accepted = { ...accepted, ...full };
    }
    return { ok: true as const, label, step, ...accepted };
  });

export const suggestIdeas = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const row = asRecord(data);
    const name = typeof row?.kanal === "string" ? row.kanal.slice(0, 80) : "";
    if (name.length < 2) return { ok: false as const, error: "Kanal yok." };
    const vars: Record<string, string> = {
      kanal: name,
      kanal_adi: name,
      "konu_türü": typeof row?.konu === "string" ? row.konu.slice(0, 80) : "",
      kitle: typeof row?.kitle === "string" ? row.kitle.slice(0, 80) : "",
      ton: typeof row?.stil === "string" ? row.stil.slice(0, 40) : "",
      stil: typeof row?.stil === "string" ? row.stil.slice(0, 40) : "",
      kanal_aciklama: typeof row?.aciklama === "string" ? row.aciklama.slice(0, 400) : "",
      son_konular: typeof row?.konular === "string" && row.konular.trim() ? row.konular.slice(0, 1200) : "yok",
    };
    const { completeText } = await import("./ai-runtime.server");
    const prompt = promptFor("fikir", vars);
    const model = typeof row?.model === "string" ? row.model : "grok-4.5";
    const sealed = sealedOf(row?.sealed);
    const ask = async (extra: string) => {
      const written = await completeText({
        model,
        system: "Sadece istenen JSON dizisini ver.",
        user: extra ? `${prompt}\n\n${extra}` : prompt,
        sealed,
        json: false,
        maxTokens: 1400,
        writer: "cli",
      });
      if (!written.ok) return { ok: false as const, error: written.error, stopped: Boolean(written.stopped), text: "", label: "" };
      return { ok: true as const, text: written.text, label: written.via, stopped: false };
    };
    let first = await ask("");
    if (!first.ok && first.stopped) return { ok: false as const, error: "Durduruldu." };
    let label = first.label || "API";
    let ideas = acceptIdeas(first.text ? readModelAny(first.text) : null);
    if (!ideas || ideas.length < 5) {
      const again = await ask("Sadece JSON döndür. Tam 5 fikir ver.");
      if (!again.ok && again.stopped) return { ok: false as const, error: "Durduruldu." };
      if (again.ok) {
        label = again.label;
        ideas = acceptIdeas(readModelAny(again.text));
      }
    }
    if (!ideas) return { ok: false as const, error: first.ok ? "Fikirler okunamadı. Yine dene." : first.error || "Fikirler okunamadı. Yine dene." };
    return { ok: true as const, label, ideas };
  });
