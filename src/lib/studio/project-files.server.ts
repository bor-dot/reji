import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

function projectsRoot() {
  return join(homedir(), "Documents", "REJI-Projects");
}

function safeId(value: string) {
  const id = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  if (id.length < 4) throw new Error("Proje kimliği geçersiz.");
  return id;
}

function safeName(folder: string, name: string) {
  if (!["ses", "gorsel", "video"].includes(folder)) throw new Error("Klasör geçersiz.");
  if (!/^[\w.-]{1,40}$/.test(name)) throw new Error("Dosya adı geçersiz.");
  return { folder, name };
}

export function projectDir(id: string) {
  return join(projectsRoot(), safeId(id));
}

export async function writeProjectBytes(id: string, folder: string, name: string, bytes: Buffer) {
  const parts = safeName(folder, name);
  const dir = join(projectDir(id), parts.folder);
  await mkdir(dir, { recursive: true });
  const path = join(dir, parts.name);
  await writeFile(path, bytes);
  return path;
}

function run(bin: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    execFile(bin, args, { timeout: 180_000 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).slice(0, 240)));
      else resolve();
    });
  });
}

function rowOf(data: unknown) {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

export async function saveProjectMediaFile(data: unknown) {
  const row = rowOf(data);
  const id = typeof row?.projectId === "string" ? row.projectId : "";
  const folder = typeof row?.folder === "string" ? row.folder : "";
  const name = typeof row?.name === "string" ? row.name : "";
  const base64 = typeof row?.base64 === "string" ? row.base64.replace(/^data:[^,]*,/, "") : "";
  if (base64.length < 16) return { ok: false as const, error: "Dosya boş." };
  try {
    const path = await writeProjectBytes(id, folder, name, Buffer.from(base64, "base64"));
    return { ok: true as const, path };
  } catch (error) {
    console.error("Medya yazılamadı.", error);
    return { ok: false as const, error: error instanceof Error ? error.message : "Medya yazılamadı." };
  }
}

export async function readProjectMediaFile(data: unknown) {
  const row = rowOf(data);
  const path = typeof row?.path === "string" ? row.path : "";
  const root = projectsRoot();
  if (!path.startsWith(root) || path.includes("..")) return { ok: false as const, error: "Yol geçersiz." };
  try {
    const bytes = await readFile(path);
    return { ok: true as const, base64: bytes.toString("base64") };
  } catch (error) {
    console.error("Medya okunamadı.", error);
    return { ok: false as const, error: error instanceof Error ? error.message : "Medya okunamadı." };
  }
}

export async function keepRemoteMediaFile(data: unknown) {
  const row = rowOf(data);
  const id = typeof row?.projectId === "string" ? row.projectId : "";
  const folder = typeof row?.folder === "string" ? row.folder : "";
  const name = typeof row?.name === "string" ? row.name : "";
  const url = typeof row?.url === "string" ? row.url : "";
  try {
    let bytes: Buffer;
    if (url.startsWith("data:")) {
      bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    } else if (url.startsWith("http")) {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) return { ok: false as const, error: `Dosya inmedi: ${res.status}` };
      bytes = Buffer.from(await res.arrayBuffer());
    } else return { ok: false as const, error: "Adres kaydedilemedi." };
    if (bytes.length < 32) return { ok: false as const, error: "Dosya çok küçük." };
    const path = await writeProjectBytes(id, folder, name, bytes);
    return { ok: true as const, path };
  } catch (error) {
    console.error("Uzak medya yazılamadı.", error);
    return { ok: false as const, error: error instanceof Error ? error.message : "Medya yazılamadı." };
  }
}

export async function mixProjectAudioFile(data: unknown) {
  const row = rowOf(data);
  const id = typeof row?.projectId === "string" ? row.projectId : "";
  const paths = Array.isArray(row?.paths) ? row.paths.filter((item): item is string => typeof item === "string") : [];
  const root = projectDir(id);
  if (!paths.length || paths.some((path) => !path.startsWith(root) || path.includes(".."))) {
    return { ok: false as const, error: "Birleştirilecek ses yok." };
  }
  try {
    const out = join(root, "ses", "birlesik.mp3");
    await mkdir(join(root, "ses"), { recursive: true });
    const list = join(root, "ses", "liste.txt");
    await writeFile(list, paths.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join("\n"));
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "44100", out]);
    return { ok: true as const, path: out };
  } catch (error) {
    console.error("Ses birleşmedi.", error);
    return { ok: false as const, error: error instanceof Error ? error.message : "Ses birleşmedi." };
  }
}

export async function levelAudio(base64: string) {
  const dir = await mkdtemp(join(tmpdir(), "reji-ses-"));
  try {
    const raw = join(dir, "in.mp3");
    const out = join(dir, "out.mp3");
    await writeFile(raw, Buffer.from(base64, "base64"));
    const ok = await new Promise<boolean>((resolve) => {
      execFile("ffmpeg", ["-y", "-i", raw, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "44100", out], { timeout: 120_000 }, (error) => resolve(!error));
    });
    const bytes = await readFile(ok ? out : raw);
    return bytes.toString("base64");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch((error) => console.warn("Geçici ses klasörü silinemedi.", error));
  }
}

export async function saveVoiceFile(row: Record<string, unknown> | null, audioBase64: string) {
  const projectId = typeof row?.projectId === "string" ? row.projectId : "";
  const index = typeof row?.index === "number" ? row.index : -1;
  if (!projectId || index < 0) return "";
  try {
    return await writeProjectBytes(projectId, "ses", `${String(index + 1).padStart(2, "0")}.mp3`, Buffer.from(audioBase64, "base64"));
  } catch (error) {
    console.error("Ses dosyası yazılamadı.", error);
    return "";
  }
}
