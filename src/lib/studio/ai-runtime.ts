import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export type ProviderId = "xai" | "gemini" | "openai" | "anthropic";

export type CliProbe = {
  id: "grok" | "codex" | "claude" | "gemini";
  status: "bagli" | "kurulu-giris-yok" | "kurulu-degil";
  login: string;
  detail: string;
};

const TEXT_MODELS: Record<string, ProviderId> = {
  "grok-4.5": "xai",
  "gemini-2.5-flash": "gemini",
  "gpt-4.1-mini": "openai",
  "claude-sonnet-4-5": "anthropic",
};

function vaultKey() {
  const base = process.env.XAI_API_KEY;
  if (!base) return null;
  return scryptSync(base, "reji-vault-v1", 32);
}

export function sealSecret(plain: string) {
  const key = vaultKey();
  if (!key) return { ok: false as const, error: "Anahtar kasası kapalı. Platform xAI anahtarı yok." };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const hint = plain.slice(-4);
  return {
    ok: true as const,
    hint,
    iv: iv.toString("base64"),
    ciphertext: Buffer.concat([ciphertext, tag]).toString("base64"),
  };
}

export function openSecret(iv: string, ciphertext: string) {
  const key = vaultKey();
  if (!key) return null;
  try {
    const ivBuf = Buffer.from(iv, "base64");
    const packed = Buffer.from(ciphertext, "base64");
    const tag = packed.subarray(packed.length - 16);
    const data = packed.subarray(0, packed.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, ivBuf);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function resolveKey(provider: ProviderId, sealed?: { iv: string; ciphertext: string }) {
  if (sealed?.iv && sealed.ciphertext) {
    const opened = openSecret(sealed.iv, sealed.ciphertext);
    if (opened) return opened;
  }
  if (provider === "xai") return process.env.XAI_API_KEY ?? null;
  return null;
}

export function describeGrok() {
  return process.env.XAI_API_KEY
    ? { connected: true as const, via: "platform" as const }
    : { connected: false as const, via: "yok" as const };
}

function clipError(status: number, body: string) {
  const clean = body.replace(/sk-[a-zA-Z0-9_-]{8,}/g, "…").replace(/xai-[a-zA-Z0-9_-]{8,}/g, "…").slice(0, 180);
  if (status === 429 || /quota|credit|billing|insufficient|rate limit|resource_exhausted/i.test(clean)) {
    return "Kota doldu.";
  }
  return `Yanıt ${status}. ${clean}`;
}

export async function completeText(input: {
  model: string;
  system: string;
  user: string;
  sealed?: { iv: string; ciphertext: string };
  maxTokens?: number;
  json?: boolean;
}) {
  const model = TEXT_MODELS[input.model] ? input.model : "grok-4.5";
  const provider = TEXT_MODELS[model];
  const key = resolveKey(provider, input.sealed);
  if (!key) return { ok: false as const, error: "Bu model için kayıtlı anahtar yok." };
  try {
    if (provider === "xai" || provider === "openai") {
      const url =
        provider === "xai" ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: input.maxTokens ?? 3800,
          ...(input.json && provider === "xai" ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
        }),
      });
      if (!res.ok) return { ok: false as const, error: clipError(res.status, await res.text()) };
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return { ok: true as const, text: body.choices?.[0]?.message?.content ?? "" };
    }
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: input.maxTokens ?? 3800,
          system: input.system,
          messages: [{ role: "user", content: input.user }],
        }),
      });
      if (!res.ok) return { ok: false as const, error: clipError(res.status, await res.text()) };
      const body = (await res.json()) as { content?: { text?: string }[] };
      return { ok: true as const, text: body.content?.map((part) => part.text ?? "").join("") ?? "" };
    }
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${input.system}\n\n${input.user}` }] }],
          generationConfig: { maxOutputTokens: input.maxTokens ?? 3800 },
        }),
      },
    );
    if (!res.ok) return { ok: false as const, error: clipError(res.status, await res.text()) };
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    return { ok: true as const, text };
  } catch {
    return { ok: false as const, error: "Bağlantı koptu." };
  }
}

export async function testProvider(provider: ProviderId, sealed?: { iv: string; ciphertext: string }) {
  const model =
    provider === "xai"
      ? "grok-4.5"
      : provider === "gemini"
        ? "gemini-2.5-flash"
        : provider === "openai"
          ? "gpt-4.1-mini"
          : "claude-sonnet-4-5";
  const result = await completeText({
    model,
    system: "Yanıtın yalnızca TAMAM olsun.",
    user: "TAMAM",
    sealed,
    maxTokens: 16,
  });
  if (!result.ok) return result;
  return { ok: true as const, text: "Bağlantı doğrulandı." };
}

export async function imagineImage(prompt: string, model: string, sealed?: { iv: string; ciphertext: string }) {
  const key = resolveKey("xai", sealed);
  if (!key) return { ok: false as const, error: "Görsel için xAI anahtarı yok." };
  const chosen = model === "grok-imagine-image-quality" ? model : "grok-imagine-image";
  try {
    const res = await fetch("https://api.x.ai/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: chosen, prompt, n: 1, response_format: "url" }),
    });
    if (!res.ok) return { ok: false as const, error: clipError(res.status, await res.text()) };
    const body = (await res.json()) as { data?: { url?: string }[] };
    const url = body.data?.[0]?.url;
    if (!url) return { ok: false as const, error: "Görsel adresi gelmedi." };
    return { ok: true as const, url };
  } catch {
    return { ok: false as const, error: "Görsel isteği koptu." };
  }
}

export async function startVideo(prompt: string, model: string, sealed?: { iv: string; ciphertext: string }) {
  const key = resolveKey("xai", sealed);
  if (!key) return { ok: false as const, error: "Video için xAI anahtarı yok." };
  const chosen = model === "grok-imagine-video-1.5" ? model : "grok-imagine-video-1.5-lite";
  try {
    const res = await fetch("https://api.x.ai/v1/videos/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: chosen,
        prompt,
        duration: 6,
        aspect_ratio: "16:9",
        resolution: "720p",
      }),
    });
    if (!res.ok) return { ok: false as const, error: clipError(res.status, await res.text()) };
    const body = (await res.json()) as { request_id?: string };
    if (!body.request_id) return { ok: false as const, error: "Video isteği açılmadı." };
    return { ok: true as const, requestId: body.request_id };
  } catch {
    return { ok: false as const, error: "Video isteği koptu." };
  }
}

const SPEAK_VOICES: Record<string, string> = {
  merak: "helios",
  "ultra-epic": "atlas",
  destan: "lumen",
  eve: "eve",
  ara: "ara",
  luna: "luna",
  carina: "carina",
  altair: "altair",
  celeste: "celeste",
  orion: "orion",
  leo: "leo",
  helix: "helix",
  rex: "rex",
  lux: "lux",
  sirius: "sirius",
};

export type SpokenWord = { text: string; start: number; end: number };

function wordsFromGraph(chars: string[], times: number[][]) {
  const words: SpokenWord[] = [];
  let buf = "";
  let start = 0;
  let end = 0;
  const flush = () => {
    const text = buf.trim();
    buf = "";
    if (!text || /^[[<]/.test(text)) return;
    words.push({ text, start, end });
  };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? "";
    const span = times[i] ?? [end, end];
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    if (!buf) start = Number(span[0]) || 0;
    buf += ch;
    end = Number(span[1]) || start;
  }
  flush();
  return words;
}

export async function speakText(input: {
  text: string;
  voiceId: string;
  speed: number;
  language: string;
  sealed?: { iv: string; ciphertext: string };
}) {
  const key = resolveKey("xai", input.sealed);
  if (!key) return { ok: false as const, error: "Ses için xAI anahtarı yok." };
  const text = input.text.trim().slice(0, 3000);
  if (text.length < 2) return { ok: false as const, error: "Önce bir metin yaz." };
  const voice = SPEAK_VOICES[input.voiceId] ?? "eve";
  const speed = Math.min(1.5, Math.max(0.7, Number(input.speed) || 1));
  const language = input.language === "en" ? "en" : "tr";
  try {
    const res = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        text,
        voice_id: voice,
        language,
        speed,
        with_timestamps: true,
        output_format: { codec: "mp3", sample_rate: 24000, bit_rate: 96000 },
      }),
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok) return { ok: false as const, error: clipError(res.status, await res.text()) };
    if (type.includes("audio")) {
      const audioBase64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      return {
        ok: true as const,
        audioBase64,
        contentType: type.split(";")[0] || "audio/mpeg",
        duration: 0,
        words: [] as SpokenWord[],
      };
    }
    const body = (await res.json()) as {
      audio?: string;
      content_type?: string;
      duration?: number;
      audio_timestamps?: { graph_chars?: string[]; graph_times?: number[][] };
    };
    if (!body.audio) return { ok: false as const, error: "Ses dosyası gelmedi." };
    const words = wordsFromGraph(body.audio_timestamps?.graph_chars ?? [], body.audio_timestamps?.graph_times ?? []);
    return {
      ok: true as const,
      audioBase64: body.audio,
      contentType: body.content_type || "audio/mpeg",
      duration: Number(body.duration) || 0,
      words,
    };
  } catch {
    return { ok: false as const, error: "Ses isteği koptu." };
  }
}

export async function pollVideo(requestId: string, sealed?: { iv: string; ciphertext: string }) {
  const key = resolveKey("xai", sealed);
  if (!key) return { ok: false as const, error: "Video için xAI anahtarı yok." };
  if (!/^[a-zA-Z0-9_-]{8,}$/.test(requestId)) return { ok: false as const, error: "Geçersiz istek." };
  try {
    const res = await fetch(`https://api.x.ai/v1/videos/${requestId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return { ok: false as const, error: clipError(res.status, await res.text()) };
    const body = (await res.json()) as { status?: string; video?: { url?: string }; error?: string };
    if (body.status === "done" && body.video?.url) return { ok: true as const, status: "done" as const, url: body.video.url };
    if (body.status === "failed" || body.status === "expired") {
      return { ok: false as const, error: body.error || "Video üretilemedi." };
    }
    return { ok: true as const, status: "pending" as const };
  } catch {
    return { ok: false as const, error: "Video durumu okunamadı." };
  }
}

function cliPathDirs() {
  const extras = [join(homedir(), ".grok", "bin"), "/usr/local/bin"];
  const fromEnv = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const dir of [...extras, ...fromEnv]) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    dirs.push(dir);
  }
  return dirs;
}

function cliEnv(): NodeJS.ProcessEnv {
  return { ...process.env, NO_COLOR: "1", PATH: cliPathDirs().join(delimiter) };
}

function run(bin: string, args: string[]) {
  return new Promise<{ code: number; out: string; missing: boolean }>((resolve) => {
    execFile(bin, args, { timeout: 8000, env: cliEnv() }, (error, stdout, stderr) => {
      const missing = (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
      const code = typeof error?.code === "number" ? error.code : error ? 1 : 0;
      resolve({ code, out: `${stdout}\n${stderr}`.slice(0, 600), missing });
    });
  });
}

async function findBin(name: string) {
  for (const dir of cliPathDirs()) {
    const full = join(dir, name);
    try {
      await access(full, constants.X_OK);
      return full;
    } catch {
      /* next */
    }
  }
  return null;
}

async function fileExists(path: string) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function loggedOut(text: string) {
  return /not logged|log in|login required|sign in|authenticate|unauthorized|no credentials|giriş/i.test(text);
}

let probeCache: { at: number; value: { platform: string; items: CliProbe[] } } | null = null;

export async function probeClis(opts?: { fresh?: boolean }): Promise<{ platform: string; items: CliProbe[] }> {
  if (!opts?.fresh && probeCache && Date.now() - probeCache.at < 15_000) return probeCache.value;
  const specs: { id: CliProbe["id"]; login: string }[] = [
    { id: "grok", login: "grok login" },
    { id: "codex", login: "codex login" },
    { id: "claude", login: "claude auth login" },
    { id: "gemini", login: "gemini" },
  ];
  const items: CliProbe[] = [];
  for (const spec of specs) {
    const bin = await findBin(spec.id);
    if (!bin) {
      items.push({ id: spec.id, status: "kurulu-degil", login: spec.login, detail: "Komut bulunamadı." });
      continue;
    }
    if (spec.id === "codex") {
      const status = await run(bin, ["login", "status"]);
      items.push({
        id: spec.id,
        status: status.code === 0 && !loggedOut(status.out) ? "bagli" : "kurulu-giris-yok",
        login: spec.login,
        detail: status.code === 0 ? "codex login status onayladı." : "codex login status giriş görmedi.",
      });
      continue;
    }
    if (spec.id === "claude") {
      const status = await run(bin, ["auth", "status"]);
      items.push({
        id: spec.id,
        status: status.code === 0 && !loggedOut(status.out) ? "bagli" : "kurulu-giris-yok",
        login: spec.login,
        detail: status.code === 0 ? "claude auth status onayladı." : "claude auth status giriş görmedi.",
      });
      continue;
    }
    if (spec.id === "gemini") {
      const cred = await fileExists(join(homedir(), ".gemini", "oauth_creds.json"));
      const keyed = Boolean(process.env.GEMINI_API_KEY);
      items.push({
        id: spec.id,
        status: cred || keyed ? "bagli" : "kurulu-giris-yok",
        login: spec.login,
        detail: cred || keyed ? "Yerel kimlik dosyası ya da GEMINI_API_KEY var." : "Kimlik dosyası yok.",
      });
      continue;
    }
    const models = await run(bin, ["models"]);
    const ok = models.code === 0 && !loggedOut(models.out) && models.out.trim().length > 0;
    items.push({
      id: spec.id,
      status: ok ? "bagli" : "kurulu-giris-yok",
      login: spec.login,
      detail: ok ? "grok models yanıt verdi." : "grok models giriş doğrulamadı.",
    });
  }
  const value = { platform: process.platform, items };
  probeCache = { at: Date.now(), value };
  return value;
}

export async function geminiImage(prompt: string, model: string, sealed?: { iv: string; ciphertext: string }) {
  const key = resolveKey("gemini", sealed);
  if (!key) return { ok: false as const, error: "Görsel için Gemini anahtarı yok." };
  const chosen = model.startsWith("imagen") || model.startsWith("gemini") ? model : "gemini-2.5-flash-image";
  try {
    if (chosen.startsWith("imagen")) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${chosen}:predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          instances: [{ prompt: prompt.slice(0, 1800) }],
          parameters: { sampleCount: 1, aspectRatio: "16:9" },
        }),
      });
      if (!res.ok) return { ok: false as const, error: clipError(res.status, await res.text()) };
      const body = (await res.json()) as { predictions?: { bytesBase64Encoded?: string; mimeType?: string }[] };
      const row = body.predictions?.[0];
      if (!row?.bytesBase64Encoded) return { ok: false as const, error: "Görsel gelmedi." };
      return { ok: true as const, url: `data:${row.mimeType || "image/png"};base64,${row.bytesBase64Encoded}` };
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${chosen}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt.slice(0, 1800) }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    });
    if (!res.ok) return { ok: false as const, error: clipError(res.status, await res.text()) };
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
    };
    const inline = body.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
    if (!inline?.data) return { ok: false as const, error: "Görsel gelmedi." };
    return { ok: true as const, url: `data:${inline.mimeType || "image/png"};base64,${inline.data}` };
  } catch {
    return { ok: false as const, error: "Gemini görsel isteği koptu." };
  }
}

export async function startVeo(prompt: string, resolution: "720p" | "1080p", sealed?: { iv: string; ciphertext: string }) {
  const key = resolveKey("gemini", sealed);
  if (!key) return { ok: false as const, error: "Video için Gemini anahtarı yok." };
  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-lite-generate-preview:predictLongRunning",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          instances: [{ prompt: prompt.slice(0, 1800) }],
          parameters: { sampleCount: 1, durationSeconds: 8, aspectRatio: "16:9", resolution },
        }),
      },
    );
    if (!res.ok) return { ok: false as const, error: clipError(res.status, await res.text()) };
    const body = (await res.json()) as { name?: string };
    if (!body.name) return { ok: false as const, error: "Veo isteği açılmadı." };
    return { ok: true as const, requestId: body.name };
  } catch {
    return { ok: false as const, error: "Veo isteği koptu." };
  }
}

export async function pollVeo(name: string, sealed?: { iv: string; ciphertext: string }) {
  const key = resolveKey("gemini", sealed);
  if (!key) return { ok: false as const, error: "Video için Gemini anahtarı yok." };
  if (!name || name.includes("..") || !/^[\w./:-]+$/.test(name)) return { ok: false as const, error: "Geçersiz istek." };
  try {
    const url = name.startsWith("http") ? name : `https://generativelanguage.googleapis.com/v1beta/${name}`;
    const res = await fetch(url, { headers: { "x-goog-api-key": key } });
    if (!res.ok) return { ok: false as const, error: clipError(res.status, await res.text()) };
    const body = (await res.json()) as {
      done?: boolean;
      error?: { message?: string };
      response?: {
        generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] };
        generatedVideos?: { video?: { uri?: string } }[];
      };
    };
    if (body.error?.message) return { ok: false as const, error: body.error.message.slice(0, 180) };
    if (!body.done) return { ok: true as const, status: "pending" as const };
    const uri =
      body.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
      body.response?.generatedVideos?.[0]?.video?.uri;
    if (!uri) return { ok: false as const, error: "Video adresi gelmedi." };
    const file = await fetch(uri, { headers: { "x-goog-api-key": key } });
    if (!file.ok) return { ok: false as const, error: clipError(file.status, await file.text()) };
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length < 32 || bytes.length > 12_000_000) return { ok: false as const, error: "Video dosyası kullanılamadı." };
    return { ok: true as const, status: "done" as const, url: `data:video/mp4;base64,${bytes.toString("base64")}` };
  } catch {
    return { ok: false as const, error: "Veo durumu okunamadı." };
  }
}

export type CliId = CliProbe["id"];

const CLI_FALLBACK: CliId[] = ["codex", "grok", "claude", "gemini"];

export function sourceLabel(id: "api" | CliId): string {
  if (id === "api") return "API";
  if (id === "codex") return "Codex";
  if (id === "grok") return "Grok";
  if (id === "claude") return "Claude";
  return "Gemini";
}

export async function chooseTextRoute(input: {
  writer: string;
  model: string;
  sealed?: { iv: string; ciphertext: string };
}): Promise<{ ok: true; via: "api" | CliId; label: string } | { ok: false; error: string }> {
  const specific = CLI_FALLBACK.includes(input.writer as CliId) ? (input.writer as CliId) : null;
  const provider = TEXT_MODELS[input.model] ?? "xai";
  const hasKey = Boolean(resolveKey(provider, input.sealed));
  if (input.writer !== "cli" && !specific && hasKey) return { ok: true, via: "api", label: "API" };
  const probe = await probeClis();
  const bagli = new Set(probe.items.filter((row) => row.status === "bagli").map((row) => row.id));
  const order: CliId[] = [];
  if (specific) order.push(specific);
  for (const id of CLI_FALLBACK) if (!order.includes(id)) order.push(id);
  const via = order.find((id) => bagli.has(id));
  if (!via) return { ok: false, error: "Bağlı CLI yok. Ayarlar'dan giriş yap ya da API anahtarı ekle." };
  return { ok: true, via, label: sourceLabel(via) };
}

export async function runCliText(cli: CliId, prompt: string) {
  if (!CLI_FALLBACK.includes(cli)) return { ok: false as const, error: "CLI yok." };
  const bin = await findBin(cli);
  if (!bin) return { ok: false as const, error: `${sourceLabel(cli)} kurulu değil.` };
  const args = cli === "codex" ? ["exec", "--skip-git-repo-check", prompt] : ["-p", prompt];
  const result = await new Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    execFile(
      bin,
      args,
      { timeout: 180_000, maxBuffer: 8_000_000, killSignal: "SIGKILL", env: cliEnv() },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        const timedOut = Boolean(err?.killed) || err?.code === "ETIMEDOUT";
        const code = typeof err?.code === "number" ? err.code : err ? 1 : 0;
        resolve({
          code,
          stdout: String(stdout ?? "").slice(0, 200_000),
          stderr: String(stderr ?? "").slice(0, 4_000),
          timedOut,
        });
      },
    );
  });
  if (result.timedOut) return { ok: false as const, error: `${sourceLabel(cli)} 180 sn içinde yanıt vermedi.` };
  const text = result.stdout.trim();
  const errText = result.stderr.trim();
  if (text.includes("{") && text.length > 40) return { ok: true as const, text };
  if (loggedOut(`${text}\n${errText}`)) return { ok: false as const, error: `${sourceLabel(cli)} giriş istiyor.` };
  if (text) return { ok: true as const, text };
  return { ok: false as const, error: `${sourceLabel(cli)} yanıt vermedi.` };
}

export async function completeWithCli(id: CliId, prompt: string) {
  return runCliText(id, prompt);
}
