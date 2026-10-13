import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { needsSources, NEUTRAL_COVER, type Channel, type ChannelKind } from "@/lib/studio/channels";
import { SEEDS } from "@/lib/studio/engine";
import { suggestIdeas } from "@/lib/studio/produce";
import type { Idea } from "@/lib/studio/prompts";
import { DEFAULT_MODELS, useStudio, type KeyBlob, type ModelPrefs } from "@/lib/studio/store";
import { notify } from "@/lib/studio/toast";
import { FORMATS, formatLabel, type Brief, type FormatId, type Lang } from "@/lib/studio/types";
import { Button, Chip, Field, ScrollRow, fieldClass } from "./bits";

function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(30, Math.max(1, Math.trunc(value)));
}

function MinutesField({ value, onCommit }: { value: number; onCommit: (minutes: number) => void }) {
  const [text, setText] = useState(() => String(value));
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setText(String(value));
  }, [value]);

  return (
    <input
      className={`${fieldClass} nums h-11`}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={text}
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(e) => {
        const next = e.target.value.replace(/\D/g, "");
        setText(next);
        if (next !== "") onCommit(Number(next));
      }}
      onBlur={() => {
        editing.current = false;
        const next = clampMinutes(Number(text));
        setText(String(next));
        onCommit(next);
      }}
    />
  );
}

function blankFrom(channel: Channel): Brief {
  return {
    title: "",
    format: channel.format,
    audience: channel.audience,
    minutes: channel.minutes,
    tone: channel.tone,
    promise: "",
    language: "tr",
    sources: "",
  };
}

export function Desk() {
  const {
    projects,
    channels,
    active,
    setActive,
    create,
    remove,
    restoreSeeds,
    addChannel,
    updateChannel,
    removeChannel,
    restoreChannels,
    models,
    keys,
    snapshot,
    replaceVault,
    keyFor,
  } = useStudio();
  const suggest = useServerFn(suggestIdeas);
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Brief>(blankFrom(active));
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [ideaBusy, setIdeaBusy] = useState(false);
  const [error, setError] = useState("");
  const visible = projects.filter((project) => project.channelId === active.id);
  const readyCount = visible.filter((p) => p.pack.checks.every((c) => c.done)).length;

  function set<K extends keyof Brief>(key: K, value: Brief[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  useEffect(() => {
    setIdeas([]);
  }, [active.id]);

  async function loadIdeas() {
    setIdeaBusy(true);
    setError("");
    try {
      const recent = projects
        .filter((project) => project.channelId === active.id)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((project) => project.brief.title.trim())
        .filter((title, index, all) => title.length > 1 && all.indexOf(title) === index)
        .slice(0, 20);
      const saved = keyFor("xai");
      const res = await suggest({
        data: {
          kanal: active.name,
          aciklama: active.description?.trim() || `${active.topic}. ${active.audience}`,
          stil: active.tone,
          konu: active.topic,
          kitle: active.audience,
          konular: recent.join("\n"),
          model: models.text,
          sealed: saved ? { iv: saved.iv, ciphertext: saved.ciphertext } : undefined,
        },
      });
      if (!res.ok) throw new Error(res.error);
      setIdeas(res.ideas);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Fikir gelmedi.";
      setError(message);
      notify(message);
    } finally {
      setIdeaBusy(false);
    }
  }

  function takeIdea(idea: Idea) {
    setDraft((prev) => ({
      ...prev,
      title: idea.baslik_onerisi,
      promise: idea.seri_olur_mu ? `${idea.konu} Seri olabilir.` : idea.konu,
      audience: active.audience,
      tone: active.tone,
      format: active.format,
      minutes: active.minutes,
      sources: needsSources(active) ? idea.kaynak_arama : prev.sources,
    }));
    setError("");
  }

  function submit() {
    const title = draft.title.trim();
    const promise = draft.promise.trim();
    const audience = draft.audience.trim() || active.audience;
    const tone = draft.tone.trim() || active.tone;
    if (title.length < 2 || promise.length < 8) {
      setError("Başlık ve en az bir cümlelik vaat gerekli.");
      return;
    }
    if (needsSources(active) && !(draft.sources ?? "").trim()) {
      setError("Bu kanal belgesel. Önce kaynakları yaz.");
      notify("Bu kanal belgesel. Önce kaynakları yaz.");
      return;
    }
    const id = create(
      {
        ...draft,
        title,
        promise,
        audience,
        tone,
        sources: (draft.sources ?? "").trim(),
        minutes: draft.format === "shorts" ? 1 : Math.min(30, Math.max(1, draft.minutes)),
      },
      active.id,
    );
    setDraft(blankFrom(active));
    setOpen(false);
    setError("");
    void navigate({ to: "/proje/$id", params: { id } });
  }

  function exportVault() {
    const blob = new Blob([JSON.stringify({ version: 3, ...snapshot() }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "reji.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importVault(file: File) {
    try {
      const data = JSON.parse(await file.text()) as {
        version?: number;
        channels?: Channel[];
        projects?: unknown;
        models?: ModelPrefs;
        keys?: KeyBlob[];
        activeId?: string;
      };
      if (!Array.isArray(data.channels) || !Array.isArray(data.projects)) {
        notify("Dosya kanal ve proje listesi içermiyor.");
        return;
      }
      replaceVault({
        channels: data.channels,
        projects: data.projects as typeof projects,
        activeId: data.activeId || data.channels[0]?.id || active.id,
        models: { ...DEFAULT_MODELS, ...(data.models ?? models) },
        keys: Array.isArray(data.keys) ? data.keys : keys,
      });
      notify("İçe aktarıldı. Anahtarlar şifreli paketse aynı sunucuda açılır.");
    } catch {
      notify("JSON okunamadı.");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 pb-28 sm:px-6 sm:py-10 sm:pb-10">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xl">
          <p className="text-sm font-medium text-faint">Dört kanallı yayın masası</p>
          <h1 className="mt-1 text-4xl text-fg sm:text-5xl">REJİ</h1>
          <p className="mt-3 text-base text-muted">
            Kanal profili brief’i, kapağı ve görseli belirler. Ses sekmesi metni Sesle sesleriyle okur.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/ayarlar"
            className="press inline-flex h-11 min-h-11 items-center rounded-lg px-4 text-sm font-medium text-fg ring-1 ring-line"
          >
            Ayarlar
          </Link>
          <Button
            variant="line"
            onClick={() => {
              setEditing(false);
              setCreating((value) => {
                const next = !value;
                if (next) {
                  requestAnimationFrame(() => {
                    document.getElementById("yeni-kanal")?.scrollIntoView({ block: "start" });
                  });
                }
                return next;
              });
            }}
          >
            {creating ? "Vazgeç" : "Yeni kanal"}
          </Button>
          <span className="hidden sm:inline-flex">
            <Button
              onClick={() => {
                setDraft(blankFrom(active));
                setOpen((value) => !value);
              }}
            >
              {open ? "Kapat" : "Yeni çekim"}
            </Button>
          </span>
        </div>
      </header>

      <ScrollRow label="Kanallar">
        {channels.map((channel) => (
          <Chip key={channel.id} active={channel.id === active.id} onClick={() => setActive(channel.id)}>
            {channel.name}
          </Chip>
        ))}
      </ScrollRow>

      <section className="flex flex-col gap-3 rounded-2xl bg-elevated p-4 ring-1 ring-line">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl">{active.name}</h2>
            <p className="mt-1 text-sm text-muted">
              {active.topic} · {active.audience} · {active.palette}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="line" onClick={() => setEditing((value) => !value)}>
              {editing ? "Kapat" : "Kanalı düzenle"}
            </Button>
          </div>
        </div>
        <p className="text-sm text-faint">{active.coverStyle}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="quiet" className="h-11 px-3" onClick={exportVault}>
            Dışa aktar
          </Button>
          <Button variant="quiet" className="h-11 px-3" onClick={() => fileRef.current?.click()}>
            İçe aktar
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importVault(file);
              event.target.value = "";
            }}
          />
          <Button variant="quiet" className="h-11 px-3" onClick={restoreChannels}>
            Eksik varsayılanları getir
          </Button>
        </div>
        {editing ? (
          <ChannelForm
            initial={active}
            onCancel={() => setEditing(false)}
            onDelete={() => {
              removeChannel(active.id);
              setEditing(false);
              notify("Kanal silindi. Çekimler duruyor.");
            }}
            onSave={(channel) => {
              updateChannel(active.id, channel);
              setEditing(false);
            }}
          />
        ) : null}
        {creating ? (
          <div id="yeni-kanal">
            <NewChannel
              onCreate={(channel) => {
                addChannel(channel);
                setCreating(false);
                notify("Kanal eklendi.");
              }}
            />
          </div>
        ) : null}
      </section>

      <p className="nums text-sm text-faint">
        {active.name}: {visible.length} çekim
        {readyCount ? ` · ${readyCount} yayına hazır` : ""}
      </p>

      {open ? (
        <form
          id="yeni-cekim"
          className="rise grid gap-4 rounded-2xl bg-elevated p-4 ring-1 ring-line sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="line" disabled={ideaBusy} onClick={() => void loadIdeas()}>
              {ideaBusy ? "Fikir aranıyor…" : ideas.length ? "Yenile" : "Fikir öner"}
            </Button>
            <span className="text-sm text-faint">{active.name} için. Son çekimler tekrar edilmez.</span>
          </div>
          {ideas.length ? (
            <ul className="grid gap-2">
              {ideas.map((idea) => (
                <li key={`${idea.baslik_onerisi}-${idea.konu}`}>
                  <button
                    type="button"
                    className="press w-full rounded-xl bg-subtle px-3 py-3 text-left ring-1 ring-line"
                    onClick={() => takeIdea(idea)}
                  >
                    <span className="block text-base text-fg">{idea.baslik_onerisi}</span>
                    <span className="mt-1 block text-sm text-muted">{idea.konu}</span>
                    <span className="mt-1 block text-sm text-faint">
                      {idea.neden_tutar}
                      {idea.seri_olur_mu ? " · Seri olur" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {SEEDS.map((seed) => (
              <Chip
                key={seed.id}
                onClick={() => {
                  setActive(seed.channelId);
                  setDraft(seed.brief);
                  setError("");
                }}
              >
                {seed.brief.title}
              </Chip>
            ))}
          </div>
          <Field label="Çalışma başlığı">
            <input
              className={`${fieldClass} h-11`}
              value={draft.title}
              maxLength={120}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Videonun adı"
            />
          </Field>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted">Biçim</span>
            <div className="flex flex-wrap gap-2">
              {FORMATS.map((item) => (
                <Chip
                  key={item.id}
                  active={draft.format === item.id}
                  onClick={() => set("format", item.id as FormatId)}
                >
                  {item.label}
                </Chip>
              ))}
            </div>
            <span className="text-sm text-faint">
              {FORMATS.find((f) => f.id === draft.format)?.hint}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="İzleyici">
              <input
                className={`${fieldClass} h-11`}
                value={draft.audience}
                maxLength={80}
                onChange={(e) => set("audience", e.target.value)}
                placeholder="Kime"
              />
            </Field>
            <Field label="Ton">
              <input
                className={`${fieldClass} h-11`}
                value={draft.tone}
                maxLength={40}
                onChange={(e) => set("tone", e.target.value)}
                placeholder="Sakin, net, sıcak"
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={draft.format === "shorts" ? "Süre" : "Hedef süre (dk)"}>
              {draft.format === "shorts" ? (
                <p className="flex h-11 items-center text-fg">45 saniye</p>
              ) : (
                <MinutesField value={draft.minutes} onCommit={(minutes) => set("minutes", minutes)} />
              )}
            </Field>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-muted">Paket dili</span>
              <div className="flex gap-2">
                {(
                  [
                    ["tr", "Türkçe"],
                    ["en", "English"],
                  ] as const
                ).map(([id, label]) => (
                  <Chip key={id} active={draft.language === id} onClick={() => set("language", id as Lang)}>
                    {label}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
          <Field label="Vaat" hint="Videonun ödeyeceği tek cümle.">
            <textarea
              className={`${fieldClass} min-h-24 py-3`}
              value={draft.promise}
              maxLength={400}
              onChange={(e) => set("promise", e.target.value)}
              placeholder="İzleyici bitirdiğinde elinde ne kalacak?"
            />
          </Field>
          {needsSources(active) || draft.format === "belgesel" ? (
            <Field label="Kaynaklar" hint="Belgeselde metin bu alandan önce yazılmaz. Uydurma kaynak yok.">
              <textarea
                className={`${fieldClass} min-h-24 py-3`}
                value={draft.sources ?? ""}
                maxLength={800}
                onChange={(e) => set("sources", e.target.value)}
                placeholder="Makale, kurum, tarih. Her satır bir kaynak."
              />
            </Field>
          ) : null}
          {error ? <p className="text-sm text-fg">{error}</p> : null}
          <div className="flex justify-end">
            <Button type="submit">Masayı kur</Button>
          </div>
        </form>
      ) : null}

      {visible.length === 0 ? (
        <section className="rounded-2xl bg-elevated p-6 ring-1 ring-line">
          <h2 className="text-2xl text-fg">Bu kanalda çekim yok</h2>
          <p className="mt-2 max-w-lg text-muted">
            {active.name} için yeni bir çekim aç
            {projects.length === 0 ? " ya da hazır örnekleri geri koy." : "."}
          </p>
          {projects.length === 0 ? (
            <Button className="mt-5" variant="line" onClick={restoreSeeds}>
              Örnekleri geri koy
            </Button>
          ) : null}
        </section>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((project) => (
            <Card key={project.id} id={project.id} onRemove={() => remove(project.id)} />
          ))}
        </ul>
      )}
      <button
        type="button"
        className="press fixed right-4 bottom-5 z-40 flex size-14 items-center justify-center rounded-full bg-paper text-ink sm:hidden"
        aria-label={open ? "Formu kapat" : "Yeni çekim"}
        onClick={() => {
          setDraft(blankFrom(active));
          setOpen((value) => {
            const next = !value;
            if (next) {
              requestAnimationFrame(() => {
                document.getElementById("yeni-cekim")?.scrollIntoView({ block: "start" });
              });
            }
            return next;
          });
        }}
      >
        <svg viewBox="0 0 24 24" className="size-7" aria-hidden="true" fill="none">
          {open ? (
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          ) : (
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          )}
        </svg>
      </button>
    </main>
  );
}

function Card({ id, onRemove }: { id: string; onRemove: () => void }) {
  const { projects } = useStudio();
  const project = projects.find((p) => p.id === id);
  const [armed, setArmed] = useState(false);
  if (!project) return null;
  const done = project.pack.checks.filter((c) => c.done).length;
  const total = project.pack.checks.length;
  return (
    <li className="flex flex-col rounded-2xl bg-elevated p-4 ring-1 ring-line">
      <Link
        to="/proje/$id"
        params={{ id: project.id }}
        className="flex flex-1 flex-col gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-paper"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted">{formatLabel(project.brief.format)}</span>
          <span className="nums text-sm text-faint">
            {project.brief.format === "shorts" ? "45 sn" : `${project.brief.minutes} dk`}
          </span>
        </div>
        <h2 className="text-2xl text-fg">{project.brief.title}</h2>
        <p className="line-clamp-3 text-sm text-muted">{project.brief.promise}</p>
        <p className="nums mt-auto text-sm text-faint">
          {done}/{total} kontrol
          {project.pack.source === "grok" ? " · Grok" : " · Masa"}
        </p>
      </Link>
      <button
        type="button"
        className="press mt-4 h-11 self-start rounded-lg px-3 text-sm text-muted ring-1 ring-line"
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          onRemove();
        }}
      >
        {armed ? "Silinsin" : "Sil"}
      </button>
    </li>
  );
}

function ChannelFields({
  draft,
  set,
}: {
  draft: {
    name: string;
    topic: string;
    audience: string;
    description: string;
    palette: string;
    coverStyle: string;
    tone: string;
    minutes: number;
    format: FormatId;
  };
  set: (patch: Partial<typeof draft>) => void;
}) {
  return (
    <div className="grid gap-4">
      <Field label="Ad">
        <input className={`${fieldClass} h-11`} value={draft.name} maxLength={48} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="Konu">
        <input className={`${fieldClass} h-11`} value={draft.topic} maxLength={80} onChange={(e) => set({ topic: e.target.value })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Hedef kitle">
          <input className={`${fieldClass} h-11`} value={draft.audience} maxLength={80} onChange={(e) => set({ audience: e.target.value })} />
        </Field>
        <Field label="Ses tonu">
          <input className={`${fieldClass} h-11`} value={draft.tone} maxLength={40} onChange={(e) => set({ tone: e.target.value })} />
        </Field>
      </div>
      <Field label="Kanal açıklaması / kitle" hint="Fikir önerisi bu metni kullanır. Alanın dışına çıkmasın.">
        <textarea
          className={`${fieldClass} min-h-20 py-3`}
          value={draft.description}
          maxLength={400}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="Bilim, uzay, biyoloji. Meraklı yetişkin."
        />
      </Field>
      <Field label="Renk paleti">
        <input className={`${fieldClass} h-11`} value={draft.palette} maxLength={80} onChange={(e) => set({ palette: e.target.value })} />
      </Field>
      <Field label="Kapak stili" hint="Yazı en fazla beş kelime, kalın ve konturlu, üst yarı, tek karakter.">
        <textarea
          className={`${fieldClass} min-h-20 py-3`}
          value={draft.coverStyle}
          maxLength={280}
          onChange={(e) => set({ coverStyle: e.target.value })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Video süresi (dk)">
          <MinutesField value={draft.minutes} onCommit={(minutes) => set({ minutes })} />
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-muted">Biçim</span>
          <div className="flex flex-wrap gap-2">
            {FORMATS.map((item) => (
              <Chip key={item.id} active={draft.format === item.id} onClick={() => set({ format: item.id })}>
                {item.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChannelForm({
  initial,
  onSave,
  onDelete,
  onCancel,
}: {
  initial: Channel;
  onSave: (patch: Partial<Channel>) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({
    name: initial.name,
    topic: initial.topic,
    audience: initial.audience,
    description: initial.description ?? "",
    palette: initial.palette,
    coverStyle: initial.coverStyle,
    tone: initial.tone,
    minutes: initial.minutes,
    format: initial.format,
  });
  const [armed, setArmed] = useState(false);

  function save() {
    if (draft.name.trim().length < 2) {
      notify("Kanal adı kısa.");
      return;
    }
    onSave({
      name: draft.name.trim(),
      topic: draft.topic.trim() || initial.topic,
      audience: draft.audience.trim() || initial.audience,
      description: draft.description.trim(),
      palette: draft.palette.trim() || initial.palette,
      coverStyle: draft.coverStyle.trim() || initial.coverStyle,
      tone: draft.tone.trim() || initial.tone,
      minutes: Math.min(30, Math.max(1, draft.minutes)),
      format: draft.format,
      needsSources: draft.format === "belgesel" || initial.kind === "belgesel",
      visualStyle: initial.builtin
        ? initial.visualStyle
        : `${draft.palette.trim()}. ${draft.coverStyle.trim()}. Tek ana karakter, üst yarı, karede yazı yok.`,
    });
  }

  return (
    <div className="grid gap-4 border-t border-line pt-4">
      <ChannelFields draft={draft} set={(patch) => setDraft((prev) => ({ ...prev, ...patch }))} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={save}>Kaydet</Button>
        <Button variant="line" onClick={onCancel}>
          Vazgeç
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            onDelete();
          }}
        >
          {armed ? "Kanal silinsin" : "Kanalı sil"}
        </Button>
      </div>
    </div>
  );
}

function slugId(name: string) {
  const base =
    name
      .toLocaleLowerCase("tr")
      .replace(/ı/g, "i")
      .replace(/ğ/g, "g")
      .replace(/ü/g, "u")
      .replace(/ş/g, "s")
      .replace(/ö/g, "o")
      .replace(/ç/g, "c")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24) || "kanal";
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

function NewChannel({ onCreate }: { onCreate: (channel: Channel) => void }) {
  const [draft, setDraft] = useState({
    name: "",
    topic: "",
    audience: "",
    description: "",
    palette: "",
    coverStyle: "Üst yarıda en fazla beş kelime, kalın konturlu yazı, tek karakter. Başlığı tekrarlama.",
    tone: "",
    minutes: 8,
    format: "uzun" as FormatId,
  });

  function create() {
    if (draft.name.trim().length < 2 || draft.topic.trim().length < 2) {
      notify("Ad ve konu gerekli.");
      return;
    }
    const format = draft.format;
    const kind: ChannelKind = format === "cocuk" ? "cocuk" : format === "belgesel" ? "belgesel" : "ozel";
    onCreate({
      id: slugId(draft.name),
      name: draft.name.trim(),
      topic: draft.topic.trim(),
      audience: draft.audience.trim() || "genel izleyici",
      description: draft.description.trim(),
      palette: draft.palette.trim() || "nötr",
      coverStyle: draft.coverStyle.trim(),
      tone: draft.tone.trim() || "sakin",
      minutes: Math.min(30, Math.max(1, draft.minutes)),
      format,
      kind,
      builtin: false,
      needsSources: format === "belgesel",
      visualStyle: `${draft.palette.trim() || "nötr"}. ${draft.coverStyle.trim()}. Tek ana karakter, üst yarı, karede yazı yok.`,
      face: "Tek ana karakter. İkinci yüz yok.",
      cover: NEUTRAL_COVER,
    });
  }

  return (
    <div className="grid gap-4 border-t border-line pt-4">
      <h3 className="text-lg">Yeni kanal</h3>
      <ChannelFields draft={draft} set={(patch) => setDraft((prev) => ({ ...prev, ...patch }))} />
      <div>
        <Button onClick={create}>Kanalı ekle</Button>
      </div>
    </div>
  );
}
