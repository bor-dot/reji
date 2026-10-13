import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { GROK_IMAGINE_SELECTORS, GROK_IMAGINE_URL } from "./selectors";

type Locator = {
  count: () => Promise<number>;
  click: (opts?: { timeout?: number }) => Promise<void>;
  fill: (value: string) => Promise<void>;
  first: () => Locator;
  filter: (opts: { hasText: string }) => Locator;
  evaluateAll: (fn: (nodes: Element[]) => string[]) => Promise<string[]>;
  screenshot: () => Promise<Buffer>;
  nth: (index: number) => Locator;
};

type Page = {
  goto: (url: string, opts: { waitUntil: "domcontentloaded"; timeout: number }) => Promise<void>;
  locator: (selector: string) => Locator;
  getByRole: (role: "button" | "textbox", opts: { name: string }) => Locator;
  keyboard: { press: (key: string) => Promise<void> };
  waitForTimeout: (ms: number) => Promise<void>;
  url: () => string;
  request: {
    get: (url: string) => Promise<{ ok: () => boolean; body: () => Promise<Uint8Array> }>;
  };
};

type Context = { pages: () => Page[]; newPage: () => Promise<Page>; close: () => Promise<void> };

async function loadPlaywright() {
  try {
    const loader = new Function("return import('playwright')") as () => Promise<{
      chromium: { launchPersistentContext: (dir: string, opts: object) => Promise<Context> };
    }>;
    return await loader();
  } catch {
    return null;
  }
}

async function clickNamed(page: Page, name: string) {
  const button = page.getByRole("button", { name }).first();
  if ((await button.count()) < 1) return false;
  await button.click({ timeout: 8_000 }).catch(() => undefined);
  return true;
}

export async function grokImagine(input: {
  prompt: string;
  kind: "image" | "video";
  aspect: "16:9" | "9:16";
  timeoutMs: number;
}): Promise<{ ok: true; url: string; source: "Grok Imagine" } | { ok: false; error: string }> {
  const playwright = await loadPlaywright();
  if (!playwright) return { ok: false, error: "Playwright kurulu değil." };
  const profile = join(homedir(), ".reji", "grok-profile");
  await mkdir(profile, { recursive: true });
  const headed = !existsSync(join(profile, "Default", "Cookies"));
  let context: Context;
  try {
    context = await playwright.chromium.launchPersistentContext(profile, {
      headless: !headed,
      viewport: { width: 1280, height: 900 },
      acceptDownloads: true,
    });
  } catch {
    if (!headed) return { ok: false, error: "Grok oturumu açılamadı." };
    try {
      context = await playwright.chromium.launchPersistentContext(profile, {
        headless: true,
        viewport: { width: 1280, height: 900 },
      });
    } catch {
      return { ok: false, error: "Grok penceresi açılamadı." };
    }
  }
  const deadline = Date.now() + input.timeoutMs;
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(GROK_IMAGINE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1200);
    await clickNamed(page, GROK_IMAGINE_SELECTORS.rejectCookies);
    const signedOut = async () => (await page.getByRole("button", { name: GROK_IMAGINE_SELECTORS.signIn }).count()) > 0;
    if (await signedOut()) {
      if (!headed) return { ok: false, error: "Grok oturumu yok." };
      while (Date.now() < deadline && (await signedOut())) await page.waitForTimeout(1500);
      if (await signedOut()) return { ok: false, error: "Grok oturumu yok. Görünür pencerede giriş gerekir." };
    }
    const composer = page.locator(GROK_IMAGINE_SELECTORS.composer).first();
    if ((await composer.count()) < 1) return { ok: false, error: "Grok oturumu yok." };
    await clickNamed(page, input.kind === "video" ? GROK_IMAGINE_SELECTORS.video : GROK_IMAGINE_SELECTORS.image);
    await clickNamed(page, GROK_IMAGINE_SELECTORS.aspect);
    await page.waitForTimeout(400);
    const ratio = page.locator("button").filter({ hasText: input.aspect === "9:16" ? GROK_IMAGINE_SELECTORS.ratioTall : GROK_IMAGINE_SELECTORS.ratioWide }).first();
    if ((await ratio.count()) > 0) await ratio.click({ timeout: 5_000 }).catch(() => undefined);
    const before = new Set(await page.locator("img").evaluateAll((nodes) => nodes.map((node) => (node as HTMLImageElement).currentSrc || (node as HTMLImageElement).src)));
    await composer.click({ timeout: 5_000 }).catch(() => undefined);
    await composer.fill(input.prompt.slice(0, 1800));
    const submitted = await clickNamed(page, GROK_IMAGINE_SELECTORS.submit);
    if (!submitted) await page.keyboard.press("Enter");
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      if (/sign-in|login|accounts/.test(page.url()) || (await page.locator("input[type='password']").count()) > 0) {
        if (!headed) return { ok: false, error: "Grok oturumu yok. İlk seferde görünür pencerede giriş gerekir." };
        continue;
      }
      if (input.kind === "video") {
        const video = page.locator("video").first();
        if ((await video.count()) > 0) {
          const src = (await page.locator("video").evaluateAll((nodes) => nodes.map((node) => (node as HTMLVideoElement).currentSrc || (node as HTMLVideoElement).src)))[0];
          if (src && !src.startsWith("blob:")) {
            const file = await page.request.get(src);
            if (file.ok()) {
              const bytes = Buffer.from(await file.body());
              if (bytes.length > 1000) return { ok: true, url: `data:video/mp4;base64,${bytes.toString("base64")}`, source: "Grok Imagine" };
            }
          }
          const shot = await video.screenshot().catch(() => null);
          if (shot && shot.length > 1000) return { ok: true, url: `data:image/png;base64,${shot.toString("base64")}`, source: "Grok Imagine" };
        }
      }
      const now = await page.locator("img").evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLImageElement).currentSrc || (node as HTMLImageElement).src),
      );
      const fresh = now.find((src) => src && !before.has(src) && !src.includes("svg") && !src.startsWith("data:image/svg"));
      if (!fresh) continue;
      if (fresh.startsWith("http")) {
        const file = await page.request.get(fresh);
        if (file.ok()) {
          const bytes = Buffer.from(await file.body());
          if (bytes.length > 1000) {
            const mime = bytes[0] === 0xff ? "image/jpeg" : "image/png";
            return { ok: true, url: `data:${mime};base64,${bytes.toString("base64")}`, source: "Grok Imagine" };
          }
        }
      }
      const shot = await page.locator("img").nth(Math.max(0, now.indexOf(fresh))).screenshot().catch(() => null);
      if (shot && shot.length > 1000) return { ok: true, url: `data:image/png;base64,${shot.toString("base64")}`, source: "Grok Imagine" };
    }
    return { ok: false, error: input.kind === "video" ? "Grok video süresi doldu." : "Grok görsel süresi doldu." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 160) : "Grok Imagine açılamadı." };
  } finally {
    await context.close().catch(() => undefined);
  }
}
