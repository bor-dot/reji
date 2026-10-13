import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { grokLink, probeLocalClis, sealProviderKey, testProviderKey } from "@/lib/studio/generate";
import { useStudio, type ProviderId } from "@/lib/studio/store";
import { notify } from "@/lib/studio/toast";
import { Button, fieldClass } from "./bits";

const PROVIDERS: { id: ProviderId; label: string; href: string; note: string }[] = [
  {
    id: "xai",
    label: "Grok",
    href: "https://console.x.ai/team/default/api-keys",
    note: "Metin, görsel, video ve xAI ses bu bağlantıyı kullanır. Diğer girişler onu kesmez.",
  },
  {
    id: "gemini",
    label: "Gemini",
    href: "https://aistudio.google.com/apikey",
    note: "Imagen ve Veo bu anahtarla çalışır.",
  },
  {
    id: "openai",
    label: "OpenAI",
    href: "https://platform.openai.com/api-keys",
    note: "Metin modeli GPT ise bu anahtar gerekir.",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    href: "https://console.anthropic.com/settings/keys",
    note: "Metin modeli Claude ise bu anahtar gerekir.",
  },
];

const TEXT_MODELS = [
  ["grok-4.5", "Grok 4.5"],
  ["gemini-2.5-flash", "Gemini 2.5 Flash"],
  ["gpt-4.1-mini", "GPT-4.1 mini"],
  ["claude-sonnet-4-5", "Claude Sonnet 4.5"],
];

const IMAGE_MODELS = [
  ["grok-imagine-image", "Grok Imagine"],
  ["grok-imagine-image-quality", "Grok Imagine kalite"],
  ["gemini-2.5-flash-image", "Gemini görsel"],
  ["imagen-4.0-generate-001", "Imagen 4"],
];

const VIDEO_MODELS = [
  ["grok-imagine-video-1.5-lite", "Grok Imagine video, hafif"],
  ["grok-imagine-video-1.5", "Grok Imagine video 1.5"],
  ["veo-3.1-lite-generate-preview", "Veo 3.1 Lite"],
];

const WRITERS = [
  ["api", "API"],
  ["cli", "CLI (otomatik)"],
  ["codex", "Codex"],
  ["grok", "Grok"],
  ["claude", "Claude"],
  ["gemini", "Gemini"],
];

const STATUS_LABEL = {
  bagli: "Bağlı",
  "kurulu-giris-yok": "Kurulu, giriş yok",
  "kurulu-degil": "Kurulu değil",
} as const;

export function Settings() {
  const { models, setModels, keys, rememberKey, forgetKey, keyFor } = useStudio();
  const seal = useServerFn(sealProviderKey);
  const test = useServerFn(testProviderKey);
  const probe = useServerFn(probeLocalClis);
  const link = useServerFn(grokLink);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [clis, setClis] = useState<Awaited<ReturnType<typeof probe>> | null>(null);
  const [grok, setGrok] = useState<{ connected: boolean; via: "platform" | "yok" } | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void link()
      .then(setGrok)
      .catch(() => setGrok(null));
  }, [link]);

  async function save(provider: ProviderId) {
    const key = drafts[provider]?.trim() ?? "";
    setBusy(provider);
    try {
      const res = await seal({ data: { provider, key } });
      if (!res.ok) notify(res.error);
      else {
        rememberKey({ provider, hint: res.hint, iv: res.iv, ciphertext: res.ciphertext });
        setDrafts((prev) => ({ ...prev, [provider]: "" }));
        notify("Anahtar şifrelenip saklandı. Düz metin tarayıcıda durmuyor.");
      }
    } catch {
      notify("Anahtar saklanamadı.");
    } finally {
      setBusy("");
    }
  }

  async function check(provider: ProviderId) {
    const blob = keyFor(provider);
    setBusy(`test-${provider}`);
    try {
      const res = await test({
        data: {
          provider,
          sealed: blob ? { iv: blob.iv, ciphertext: blob.ciphertext } : undefined,
        },
      });
      notify(res.ok ? res.text : res.error);
    } catch {
      notify("Test tamamlanamadı.");
    } finally {
      setBusy("");
    }
  }

  async function scan() {
    setBusy("cli");
    try {
      const res = await probe();
      setClis(res);
    } catch {
      notify("CLI yoklanamadı.");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6 pb-28 sm:px-6 sm:py-10 sm:pb-10">
      <Link to="/" className="w-fit text-sm text-muted">
        Masaya dön
      </Link>
      <header>
        <p className="text-sm text-faint">Bağlantı</p>
        <h1 className="mt-1 text-4xl">Ayarlar</h1>
        <p className="mt-3 text-muted">
          Grok bağlantısı durur. Gemini, OpenAI ve Anthropic için giriş, Sesle’deki gibi sağlayıcının kendi
          sayfasında olur. Şifre buraya yazılmaz; yalnızca yapıştırdığın anahtarın son dört hanesi kalır.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl">Modeller</h2>
        <ModelSelect
          label="Metin"
          value={models.text}
          options={TEXT_MODELS}
          onChange={(text) => setModels({ text })}
        />
        <ModelSelect
          label="Görsel"
          value={models.image}
          options={IMAGE_MODELS}
          onChange={(image) => setModels({ image })}
        />
        <ModelSelect
          label="Video"
          value={models.video}
          options={VIDEO_MODELS}
          onChange={(video) => setModels({ video })}
        />
        <ModelSelect
          label="Video boyu"
          value={models.videoSize}
          options={[
            ["720p", "720p"],
            ["1080p", "1080p"],
          ]}
          onChange={(videoSize) => setModels({ videoSize: videoSize === "1080p" ? "1080p" : "720p" })}
        />
        <ModelSelect
          label="Metin kaynağı"
          value={models.writer}
          options={WRITERS}
          onChange={(value) => {
            const writer =
              value === "cli" || value === "grok" || value === "codex" || value === "claude" || value === "gemini" || value === "api"
                ? value
                : "api";
            setModels({ writer });
          }}
        />
        <p className="text-sm text-faint">
          Sahne, xAI, Gemini ya da elle kopyayı kendi seçer. Metin kaynağı API ise anahtar kullanılır. CLI (otomatik)
          bağlı olanı seçer. Belirli bir CLI seçiliyse o öne alınır, değilse sıra Codex, Grok, Claude, Gemini. Anahtar
          yoksa da CLI'ya düşer.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl">Girişler</h2>
        {PROVIDERS.map((provider) => {
          const saved = keys.find((key) => key.provider === provider.id);
          const grokOn = provider.id === "xai" && (Boolean(saved) || grok?.connected);
          const status = grokOn
            ? saved && grok?.connected
              ? "Bağlı · senin anahtarın, platform yedeği duruyor"
              : saved
                ? `Bağlı · ••••${saved.hint}`
                : "Bağlı · Grok"
            : saved
              ? `Bağlı · ••••${saved.hint}`
              : "Giriş yok";
          return (
            <form
              key={provider.id}
              className="flex flex-col gap-3 rounded-2xl bg-elevated p-4 ring-1 ring-line"
              onSubmit={(event) => {
                event.preventDefault();
                void save(provider.id);
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg">{provider.label}</h3>
                <span className={`text-sm ${grokOn || saved ? "text-fg" : "text-faint"}`}>{status}</span>
              </div>
              <p className="text-sm text-muted">{provider.note}</p>
              <div className="flex flex-wrap gap-2">
                <a
                  href={provider.href}
                  target="_blank"
                  rel="noreferrer"
                  className="press inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-medium text-fg ring-1 ring-line"
                >
                  {provider.id === "xai" ? "Konsolu aç" : "Giriş yap"}
                </a>
              </div>
              <input
                className={`${fieldClass} h-11`}
                type="password"
                autoComplete="off"
                value={drafts[provider.id] ?? ""}
                placeholder={provider.id === "xai" ? "İstersen kendi anahtarını yapıştır" : "Girişten sonra anahtarı yapıştır"}
                onChange={(event) => setDrafts((prev) => ({ ...prev, [provider.id]: event.target.value }))}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy === provider.id}>
                  Sakla
                </Button>
                <Button type="button" variant="line" disabled={busy === `test-${provider.id}`} onClick={() => void check(provider.id)}>
                  Test et
                </Button>
                {saved ? (
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => {
                      forgetKey(provider.id);
                      notify(
                        provider.id === "xai" && grok?.connected
                          ? "Kayıtlı anahtar silindi. Grok bağlantısı duruyor."
                          : "Anahtar silindi.",
                      );
                    }}
                  >
                    Unut
                  </Button>
                ) : null}
              </div>
            </form>
          );
        })}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-2xl">CLI</h2>
          <Button variant="line" disabled={busy === "cli"} onClick={() => void scan()}>
            {busy === "cli" ? "Yoklanıyor" : "Yokla"}
          </Button>
        </div>
        <p className="text-sm text-muted">
          Yoklama uygulamanın çalıştığı makinededir. Önizleme sunucusu senin Mac’in değil; orada kurulu olmayan
          araç “Kurulu değil” görünür. Sahte “Bağlı” yazılmaz.
        </p>
        {clis ? (
          <ul className="flex flex-col gap-3">
            <li className="text-sm text-faint">Ortam: {clis.platform}</li>
            {clis.items.map((item) => (
              <li key={item.id} className="rounded-xl bg-elevated p-4 ring-1 ring-line">
                <p className="text-base text-fg">{item.id}</p>
                <p className="mt-1 text-sm text-muted">{STATUS_LABEL[item.status]}</p>
                <p className="mt-1 text-sm text-faint">{item.detail}</p>
                {item.status !== "bagli" ? (
                  <p className="mt-2 text-sm text-fg">Giriş: {item.login}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-faint">Henüz yoklanmadı.</p>
        )}
      </section>
    </main>
  );
}

function ModelSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm text-muted">
      {label}
      <select className={`${fieldClass} h-11`} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
