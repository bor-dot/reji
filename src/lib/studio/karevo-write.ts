import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";

export type KarevoSceneFile = {
  n: number;
  text: string;
  simulation: boolean;
  duration: number;
  image: Buffer;
  imageExt: "png" | "jpg" | "webp";
  video?: Buffer;
  audio: Buffer;
};

export type KarevoPackage = {
  name: string;
  channel: string;
  resolution: string;
  scenes: KarevoSceneFile[];
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function srtStamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hour = Math.floor(ms / 3_600_000);
  const minute = Math.floor((ms % 3_600_000) / 60_000);
  const second = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(hour)}:${two(minute)}:${two(second)},${String(milli).padStart(3, "0")}`;
}

export function exportRoot(): string {
  return join(homedir(), "Documents", "REJI-Export");
}

export type IncomingScene = {
  n: number;
  title: string;
  text: string;
  simulation: boolean;
  duration: number;
  imageUrl: string;
  videoUrl?: string;
  audioBase64: string;
};

const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_VIDEO = 80 * 1024 * 1024;
const MAX_AUDIO = 12 * 1024 * 1024;

function imageExt(bytes: Buffer, type: string): "png" | "jpg" | "webp" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "webp";
  if (type.includes("png")) return "png";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  return null;
}

async function pull(url: string, max: number): Promise<{ bytes: Buffer; type: string } | { error: string }> {
  try {
    if (url.startsWith("data:")) {
      const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url);
      if (!match) return { error: "adres bozuk" };
      const type = match[1] || "application/octet-stream";
      const bytes = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]));
      if (bytes.length < 16 || bytes.length > max) return { error: "dosya okunamadı" };
      return { bytes, type };
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return { error: "indirilemedi" };
    const type = res.headers.get("content-type") ?? "";
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 16 || bytes.length > max) return { error: "dosya okunamadı" };
    return { bytes, type };
  } catch {
    return { error: "indirilemedi" };
  }
}

export async function sendKarevo(input: {
  folderName: string;
  name: string;
  channel: string;
  resolution: string;
  scenes: IncomingScene[];
}): Promise<{ ok: true; path: string } | { ok: false; error: string; missing: string[] }> {
  if (!input.folderName || input.folderName.includes("/") || input.folderName.includes("\\") || input.folderName.includes("..")) {
    return { ok: false, error: "Proje adı klasöre yazılamıyor.", missing: [] };
  }
  const missing: string[] = [];
  const ready: KarevoSceneFile[] = [];
  for (const scene of input.scenes) {
    const label = `${String(scene.n).padStart(2, "0")} · ${scene.title}`;
    const problems: string[] = [];
    const image = await pull(scene.imageUrl, MAX_IMAGE);
    const ext = "error" in image ? null : imageExt(image.bytes, image.type);
    if ("error" in image || !ext) problems.push("görsel indirilemedi");
    let video: Buffer | undefined;
    if (scene.videoUrl) {
      const pulled = await pull(scene.videoUrl, MAX_VIDEO);
      if ("error" in pulled) problems.push("video indirilemedi");
      else video = pulled.bytes;
    }
    let audio: Buffer | null = null;
    try {
      audio = Buffer.from(scene.audioBase64, "base64");
    } catch {
      audio = null;
    }
    if (!audio || audio.length < 32 || audio.length > MAX_AUDIO) problems.push("ses yok");
    if (!Number.isFinite(scene.duration) || scene.duration <= 0) problems.push("ses süresi yok");
    if (problems.length || !ext || !audio) {
      missing.push(`${label}: ${problems.join(", ") || "eksik"}`);
      continue;
    }
    ready.push({
      n: scene.n,
      text: scene.text,
      simulation: scene.simulation,
      duration: scene.duration,
      image: "error" in image ? Buffer.alloc(0) : image.bytes,
      imageExt: ext,
      video,
      audio,
    });
  }
  if (missing.length) return { ok: false, error: "Eksik dosya var. Gönderilmedi.", missing };
  const path = await writeKarevoPackage(input.folderName, {
    name: input.name,
    channel: input.channel,
    resolution: input.resolution,
    scenes: ready,
  });
  return { ok: true, path: displayPath(path) };
}

export function displayPath(absolute: string): string {
  const home = homedir();
  return absolute.startsWith(home) ? `~${absolute.slice(home.length)}` : absolute;
}

export async function writeKarevoPackage(folderName: string, pack: KarevoPackage): Promise<string> {
  const root = exportRoot();
  const dest = join(root, folderName);
  if (dest !== root && !dest.startsWith(root + sep)) throw new Error("Klasör adı güvenli değil.");
  const media = join(dest, "medya");
  await mkdir(media, { recursive: true });

  let cursor = 0;
  const srt: string[] = [];
  const scenes = pack.scenes.map((scene) => {
    const nn = pad(scene.n);
    const imageName = `${nn}-gorsel.${scene.imageExt}`;
    const audioName = `${nn}.mp3`;
    const videoName = scene.video ? `${nn}-video.mp4` : null;
    const start = cursor;
    cursor += scene.duration;
    const body = scene.text.replace(/\r\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
    srt.push(`${scene.n}\n${srtStamp(start)} --> ${srtStamp(cursor)}\n${body}`);
    return { scene, nn, imageName, audioName, videoName };
  });

  for (const item of scenes) {
    for (const ext of ["png", "jpg", "webp"]) {
      await rm(join(media, `${item.nn}-gorsel.${ext}`), { force: true });
    }
    await rm(join(media, `${item.nn}-video.mp4`), { force: true });
    await writeFile(join(media, item.imageName), item.scene.image);
    await writeFile(join(media, item.audioName), item.scene.audio);
    if (item.videoName && item.scene.video) await writeFile(join(media, item.videoName), item.scene.video);
  }

  const json = {
    projeAdi: pack.name,
    kanal: pack.channel,
    cozunurluk: pack.resolution,
    fps: 24,
    sahneler: scenes.map((item) => ({
      sira: item.scene.n,
      metin: item.scene.text,
      gorsel: `medya/${item.imageName}`,
      video: item.videoName ? `medya/${item.videoName}` : null,
      ses: `medya/${item.audioName}`,
      sesSuresi: Math.round(item.scene.duration * 1000) / 1000,
      yapayZekaSimulasyonu: item.scene.simulation,
    })),
  };
  await writeFile(join(dest, "karevo-paket.json"), `${JSON.stringify(json, null, 2)}\n`);
  await writeFile(join(dest, "altyazi.srt"), `${srt.join("\n\n")}\n`);
  return dest;
}
