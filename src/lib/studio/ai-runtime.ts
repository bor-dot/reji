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

function clipError(status: number, body: string) {
  const clean = body.replace(/sk-[a-zA-Z0-9_-]{8,}/g, "…").replace(/xai-[a-zA-Z0-9_-]{8,}/g, "…").slice(0, 180);
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

function run(bin: string, args: string[]) {
  return new Promise<{ code: number; out: string; missing: boolean }>((resolve) => {
    execFile(bin, args, { timeout: 8000, env: { ...process.env, NO_COLOR: "1" } }, (error, stdout, stderr) => {
      const missing = (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
      const code = typeof error?.code === "number" ? error.code : error ? 1 : 0;
      resolve({ code, out: `${stdout}\n${stderr}`.slice(0, 600), missing });
    });
  });
}

async function findBin(name: string) {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
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

export async function probeClis(): Promise<{ platform: string; items: CliProbe[] }> {
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
  return { platform: process.platform, items };
}
