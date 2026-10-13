import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { SESLE_SELECTORS, SESLE_URL } from "./sesle-selectors";
import { trackJob } from "./ai-runtime.server";

export type SesleChunk = {
  index: number;
  status: "bekliyor" | "yaziliyor" | "tamam" | "hata";
  detail: string;
  file?: string;
  audioBase64?: string;
};

export type SesleJob = {
  id: string;
  status: "giris" | "calisiyor" | "bitti" | "hata";
  note: string;
  chunks: SesleChunk[];
};

type Handle = {
  count: () => Promise<number>;
  click: () => Promise<void>;
  fill: (value: string) => Promise<void>;
  waitFor: (opts: { timeout: number }) => Promise<void>;
  getAttribute: (name: string) => Promise<string | null>;
  evaluate: (fn: (node: Element, value: number) => void, value: number) => Promise<void>;
  first: () => Handle;
  filter: (opts: { hasText: string }) => Handle;
};

type Page = {
  goto: (url: string, opts: { waitUntil: "domcontentloaded"; timeout: number }) => Promise<void>;
  locator: (selector: string) => Handle;
  waitForEvent: (name: "download", opts: { timeout: number }) => Promise<{ saveAs: (path: string) => Promise<void> }>;
  request: { get: (url: string) => Promise<{ body: () => Promise<Uint8Array> }> };
};

type Context = { pages: () => Page[]; newPage: () => Promise<Page>; close: () => Promise<void> };

const jobs = new Map<string, SesleJob>();

export function sesleJob(id: string) {
  return jobs.get(id) ?? null;
}

async function loadPlaywright() {
  try {
    const loader = new Function("return import('playwright')") as () => Promise<{
      chromium: { launchPersistentContext: (dir: string, opts: object) => Promise<Context> };
    }>;
    return await loader();
  } catch (error) {
    console.warn("Playwright yok.", error);
    return null;
  }
}

function runFile(bin: string, args: string[]) {
  return new Promise<boolean>((resolve) => {
    execFile(bin, args, { timeout: 120_000 }, (error) => resolve(!error));
  });
}

async function loudnorm(source: string, target: string) {
  const ok = await runFile("ffmpeg", ["-y", "-i", source, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "44100", target]);
  if (!ok) await writeFile(target, await readFile(source));
  return ok;
}

async function clickNamed(page: Page, names: string[]) {
  for (const name of names) {
    const button = page.locator("button").filter({ hasText: name }).first();
    if ((await button.count()) > 0) {
      await button.click();
      return true;
    }
  }
  return false;
}

export async function startSesle(input: { folder: string; voice: string; speed: number; chunks: string[]; only?: number }) {
  const id = `${Date.now()}`;
  const job: SesleJob = {
    id,
    status: "calisiyor",
    note: "Sesle açılıyor.",
    chunks: input.chunks.map((text, index) => ({
      index,
      status: input.only != null && input.only !== index ? "tamam" : "bekliyor",
      detail: text.slice(0, 80),
    })),
  };
  jobs.set(id, job);
  void runJob(job, input).catch((error: unknown) => {
    job.status = "hata";
    job.note = error instanceof Error ? error.message : "Sesle durdu.";
  });
  return { ok: true as const, jobId: id };
}

async function runJob(job: SesleJob, input: { folder: string; voice: string; speed: number; chunks: string[]; only?: number }) {
  const playwright = await loadPlaywright();
  if (!playwright) {
    job.status = "hata";
    job.note = "Playwright kurulu değil. npx playwright install chromium";
    return;
  }
  const profile = join(homedir(), ".reji", "sesle-profile");
  await mkdir(profile, { recursive: true });
  const media = join(homedir(), "Documents", "REJI-Export", input.folder, "medya");
  await mkdir(media, { recursive: true });
  const headed = !existsSync(join(profile, "Default", "Cookies"));
  const context = await playwright.chromium.launchPersistentContext(profile, {
    headless: !headed,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  const release = trackJob(() => {
    job.status = "hata";
    job.note = "Durduruldu.";
    void context.close().catch((error) => console.warn("Sesle penceresi kapanmadı.", error));
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(SESLE_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if ((await page.locator(SESLE_SELECTORS.login).count()) > 0) {
      job.status = "giris";
      job.note = headed
        ? "Açılan pencerede Sesle'ye gir. Şifre saklanmaz."
        : "Oturum yok. İlk seferde görünür tarayıcı gerekir.";
      await page.locator(SESLE_SELECTORS.text).first().waitFor({ timeout: 180_000 });
      job.status = "calisiyor";
    }
    for (const chunk of job.chunks) {
      if (input.only != null && chunk.index !== input.only) continue;
      const text = input.chunks[chunk.index];
      if (!text) continue;
      chunk.status = "yaziliyor";
      job.note = `${chunk.index + 1}/${job.chunks.length} parça`;
      await page.locator(SESLE_SELECTORS.text).first().fill(text);
      const voice = page.locator("button").filter({ hasText: input.voice }).first();
      if ((await voice.count()) > 0) await voice.click();
      const speed = page.locator(SESLE_SELECTORS.speed).first();
      if ((await speed.count()) > 0) {
        await speed.evaluate((node, value) => {
          const field = node as HTMLInputElement;
          field.value = String(value);
          field.dispatchEvent(new Event("input", { bubbles: true }));
        }, input.speed);
      }
      const downloadWait = page.waitForEvent("download", { timeout: 90_000 }).catch((error) => {
        console.warn("Sesle indirmesi gelmedi.", error);
        return null;
      });
      if (!(await clickNamed(page, SESLE_SELECTORS.generateNames))) {
        chunk.status = "hata";
        chunk.detail = "Seslendir düğmesi yok.";
        continue;
      }
      const download = await downloadWait;
      const raw = join(media, `${String(chunk.index + 1).padStart(2, "0")}.raw.mp3`);
      const finalPath = join(media, `${String(chunk.index + 1).padStart(2, "0")}.mp3`);
      if (download) await download.saveAs(raw);
      else {
        const src = await page.locator(SESLE_SELECTORS.audio).first().getAttribute("src");
        if (!src) {
          chunk.status = "hata";
          chunk.detail = "MP3 gelmedi.";
          continue;
        }
        const response = await page.request.get(src);
        await writeFile(raw, Buffer.from(await response.body()));
      }
      const leveled = await loudnorm(raw, finalPath);
      const bytes = await readFile(finalPath);
      chunk.status = "tamam";
      chunk.file = finalPath;
      chunk.audioBase64 = bytes.toString("base64");
      chunk.detail = leveled ? "−16 LUFS" : "ffmpeg yok, ham MP3 yazıldı";
    }
    job.status = job.chunks.some((chunk) => chunk.status === "hata") ? "hata" : "bitti";
    job.note = job.status === "bitti" ? "Sesle bitti." : "Bazı parçalar yazılamadı.";
  } finally {
    release();
    await context.close().catch((error) => console.warn("Sesle penceresi kapanmadı.", error));
  }
}
