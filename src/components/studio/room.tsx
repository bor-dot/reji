import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { needsSources, type Channel } from "@/lib/studio/channels";
import { briefKey, chaptersFromBeats, critique, scenesFor, scoreOf, toMarkdown, voiceMinutes } from "@/lib/studio/engine";
import { continueBeats, deepenPack, imagineScene, planTextSource, pollSceneVideo, startSceneVideo, writeNarration } from "@/lib/studio/generate";
import { countWords, docxBytes, narrationText, plainText, spreadNarration, targetWords } from "@/lib/studio/narration";
import { keepRemoteMedia, readProjectMedia } from "@/lib/studio/project-files";
import { putSceneVideo } from "@/lib/studio/scene-audio";
import { useStudio } from "@/lib/studio/store";
import { notify } from "@/lib/studio/toast";
import { formatLabel, type Beat, type Hook, type Pack, type Project, type Scene, type Shot } from "@/lib/studio/types";
import { Button, Chip, CopyButton, fieldClass } from "./bits";
import { KarevoSend } from "./karevo";
import { ProduceScreen } from "./produce";
import { VoiceStage } from "./voice";

const STAGES = [
  ["brief", "Brief"],
  ["baslik", "Başlık"],
  ["kanca", "Kanca"],
  ["senaryo", "Senaryo"],
  ["metin", "Metin"],
  ["ses", "Ses"],
  ["cekim", "Çekim"],
  ["kapak", "Kapak"],
  ["gorsel", "Görsel"],
  ["yayin", "Yayın"],
  ["kontrol", "Kontrol"],
] as const;

type StageId = (typeof STAGES)[number][0];

function mediaNote(error: string) {
  if (/kota|429|quota|credit|billing/i.test(error)) {
    return "Grok kotası doldu. Yedek API’ye geç ya da dosyayı bırak.";
  }
  return error;
}

function GrokRail({
  project,
  busy,
  onWrite,
  onOpen,
}: {
  project: Project;
  busy: boolean;
  onWrite: () => void;
  onOpen: (stage: StageId) => void;
}) {
  const scenes = project.pack.scenes ?? [];
  const words = countWords(narrationText(project.pack.beats));
  const target = targetWords(project.brief.minutes);
  const written = project.pack.source === "grok";
  const narration = words >= Math.round(target * 0.7);
  const images = scenes.filter((scene) => scene.imageUrl).length;
  const videos = scenes.filter((scene) => scene.videoUrl).length;
  const voices = scenes.filter((scene) => scene.audioDuration).length;
  const cover = Boolean(project.pack.thumb.imageUrl);
  const steps: { label: string; ok: boolean }[] = [
    { label: "Yazı", ok: written },
    { label: "Metin", ok: narration },
    { label: "Kapak", ok: cover },
    { label: `Görsel ${images}/${scenes.length}`, ok: scenes.length > 0 && images === scenes.length },
    { label: `Video ${videos}/${scenes.length}`, ok: videos > 0 },
    { label: `Ses ${voices}/${scenes.length}`, ok: scenes.length > 0 && voices === scenes.length },
    { label: "Çıktı", ok: written && narration && cover && images === scenes.length && voices === scenes.length },
  ];
  const next = !written
    ? { label: "Grok ile yaz", run: onWrite }
    : !narration
      ? { label: "Metni Grok yazsın", run: () => onOpen("metin") }
      : !cover
        ? { label: "Kapağı Imagine çizsin", run: () => onOpen("kapak") }
        : images < scenes.length
          ? { label: "Sıradaki sahneyi Imagine çizsin", run: () => onOpen("gorsel") }
          : voices < scenes.length
            ? { label: "Sesi Grok okusun", run: () => onOpen("ses") }
            : videos < scenes.length
              ? { label: "Videoyu Imagine çeksin", run: () => onOpen("gorsel") }
              : { label: "Çıktıyı al", run: () => onOpen("yayin") };

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-elevated p-4 ring-1 ring-line">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg">Grok süreci</h2>
        <p className="text-sm text-faint">Önce Grok. Kota bitince yedek.</p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {steps.map((step) => (
          <span
            key={step.label}
            className={`nums shrink-0 rounded-full px-3 py-2 text-sm ${step.ok ? "bg-paper text-ink" : "text-muted ring-1 ring-line"}`}
          >
            {step.ok ? "Tamam · " : ""}
            {step.label}
          </span>
        ))}
      </div>
      <Button onClick={next.run} disabled={busy}>
        {busy ? "Yazıyor…" : next.label}
      </Button>
    </div>
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(message));
      },
    );
  });
}

function StageDock({ stage, onPick }: { stage: StageId; onPick: (id: StageId) => void }) {
  const [open, setOpen] = useState(false);
  const current = STAGES.find(([id]) => id === stage)?.[1] ?? "Aşama";
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
      {open ? (
        <button type="button" aria-label="Aşamaları kapat" className="fixed inset-0 bg-bg/70" onClick={() => setOpen(false)} />
      ) : null}
      <div className="relative border-t border-line bg-bg px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {open ? (
          <div className="mb-2 grid max-h-[60dvh] grid-cols-2 gap-2 overflow-y-auto" role="listbox" aria-label="Aşamalar">
            {STAGES.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={stage === id}
                className={`press min-h-11 rounded-lg px-3 text-left text-sm font-medium ring-1 ${
                  stage === id ? "bg-paper text-ink ring-paper" : "bg-elevated text-fg ring-line"
                }`}
                onClick={() => {
                  onPick(id);
                  setOpen(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className="press flex min-h-11 w-full items-center justify-between rounded-lg bg-elevated px-4 text-sm font-medium text-fg ring-1 ring-line"
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => setOpen((value) => !value)}
        >
          <span>{current}</span>
          <span className="text-faint">{open ? "Kapat" : "Aşamalar"}</span>
        </button>
      </div>
    </div>
  );
}

function providerForModel(model: string) {
  if (model.startsWith("gemini") || model.startsWith("imagen") || model.startsWith("veo")) return "gemini" as const;
  if (model.startsWith("gpt")) return "openai" as const;
  if (model.startsWith("claude")) return "anthropic" as const;
  return "xai" as const;
}

export function Room({ project }: { project: Project }) {
  const { channels, patchBrief, patchPack, rebuild, applyGenerated, addSeries, models, keyFor } = useStudio();
  const deepen = useServerFn(deepenPack);
  const plan = useServerFn(planTextSource);
  const [stage, setStage] = useState<StageId>("baslik");
  const [busy, setBusy] = useState(false);
  const [writeLabel, setWriteLabel] = useState("");
  const [error, setError] = useState("");
  const [armRebuild, setArmRebuild] = useState(false);
  const [producing, setProducing] = useState<null | "adim" | "tek">(null);
  const channel = channels.find((item) => item.id === project.channelId) ?? channels[0];
  const blocked = Boolean(channel && needsSources(channel) && !(project.brief.sources ?? "").trim());

  const dirty = briefKey(project.brief) !== project.pack.briefKey;
  const spoken = voiceMinutes(project.pack);
  const markdown = toMarkdown(project);

  function sealedFor(model: string) {
    const blob = keyFor(providerForModel(model));
    return blob ? { iv: blob.iv, ciphertext: blob.ciphertext } : undefined;
  }

  function refuseSources() {
    const text = "Bu kanal belgesel. Önce kaynak alanını doldur.";
    setError(text);
    notify(text);
    setStage("brief");
  }

  async function onGrok() {
    if (!channel || blocked) {
      refuseSources();
      return;
    }
    setBusy(true);
    setWriteLabel("Yazıyor…");
    setError("");
    try {
      const sealed = sealedFor(models.text);
      const planned = await withTimeout(
        plan({ data: { writer: models.writer, textModel: models.text, sealed } }),
        45_000,
        "Süre doldu. CLI yoklanamadı.",
      );
      if (!planned.ok) {
        setError(planned.error);
        notify(planned.error);
        return;
      }
      setWriteLabel(`Yazıyor… (${planned.label})`);
      const res = await withTimeout(
        deepen({
          data: {
            brief: project.brief,
            needsSources: needsSources(channel),
            textModel: models.text,
            sealed,
            channelNote: `${channel.name}. ${channel.topic}. ${channel.visualStyle}. ${channel.coverStyle}. Ton: ${channel.tone}.`,
            writer: models.writer,
            via: planned.via,
          },
        }),
        190_000,
        "Süre doldu. Yazım durduruldu.",
      );
      if (!res.ok) {
        setError(res.error);
        notify(res.error);
      } else {
        applyGenerated(project.id, res.pack);
        setStage("baslik");
        notify(planned.label === "API" ? "Grok paketi yazıldı." : `${planned.label} paketi yazıldı.`);
      }
    } catch (error) {
      const text = error instanceof Error && error.message.startsWith("Süre") ? error.message : "İstek tamamlanamadı. Masa kalıbı duruyor.";
      setError(text);
      notify(text);
    } finally {
      setBusy(false);
      setWriteLabel("");
    }
  }

  function onRebuild() {
    if (blocked) {
      refuseSources();
      return;
    }
    if (project.pack.source === "grok" && !armRebuild) {
      setArmRebuild(true);
      return;
    }
    rebuild(project.id);
    setArmRebuild(false);
  }

  function onSeries() {
    const count = addSeries(project.id);
    notify(count ? `${count} çekim aynı konudan eklendi.` : "Seri kurulamadı.");
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 pb-28 sm:px-6 sm:py-10 lg:pb-10">
      <header className="flex flex-col gap-4">
        <Link to="/" className="w-fit text-sm text-muted outline-none focus-visible:text-fg">
          Masaya dön
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-faint">
              {channel?.name ?? "Kanal"}
              {" · "}
              {formatLabel(project.brief.format)}
              {" · "}
              {project.pack.source === "grok" ? "Grok" : "Masa kalıbı"}
              {" · "}
              <span className="nums">
                {spoken.words} kelime · ~{spoken.minutes} dk
              </span>
            </p>
            <h1 className="mt-1 text-3xl text-fg sm:text-4xl">{project.brief.title}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="line" onClick={onSeries} disabled={busy}>
              Seri yap
            </Button>
            <Button variant="line" onClick={onRebuild} disabled={busy}>
              {armRebuild ? "Grok metninin üstüne yaz" : "Kalıbı kur"}
            </Button>
            <Button
              variant="line"
              onClick={() => {
                if (blocked) {
                  refuseSources();
                  return;
                }
                setProducing("tek");
              }}
              disabled={busy}
            >
              Tek tuşla üret
            </Button>
            <Button
              onClick={() => {
                if (blocked) {
                  refuseSources();
                  return;
                }
                setProducing("adim");
              }}
              disabled={busy}
            >
              Adım adım
            </Button>
            <Button onClick={() => void onGrok()} disabled={busy}>
              {busy ? writeLabel || "Yazıyor…" : "Grok ile yaz"}
            </Button>
          </div>
        </div>
        {dirty ? (
          <p className="text-sm text-muted">
            Brief değişti. Paket eski brief’e göre. Kalıbı kur ya da Grok ile yeniden yaz.
          </p>
        ) : null}
        {blocked ? (
          <p className="text-sm text-fg">Kaynak boş. Belgeselde metin, kaynak yazılmadan kurulmaz.</p>
        ) : null}
        {error ? <p className="text-sm text-fg">{error}</p> : null}
        <GrokRail project={project} busy={busy} onWrite={() => void onGrok()} onOpen={setStage} />
      </header>

      <StageDock stage={stage} onPick={setStage} />
      {producing && channel ? (
        <ProduceScreen project={project} channel={channel} auto={producing === "tek"} onClose={() => setProducing(null)} />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-8">
        <nav className="hidden flex-col gap-1 lg:flex" aria-label="Aşamalar">
          {STAGES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setStage(id)}
              className={`press h-11 rounded-lg px-3 text-left text-sm font-medium ${
                stage === id ? "bg-subtle text-fg" : "text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <section className="min-w-0">
          {stage === "brief" ? (
            <BriefStage
              project={project}
              documentary={Boolean(channel && needsSources(channel))}
              onPatch={(patch) => patchBrief(project.id, patch)}
            />
          ) : null}
          {stage === "baslik" ? (
            <TitlesStage pack={project.pack} onPatch={(patch) => patchPack(project.id, patch)} />
          ) : null}
          {stage === "kanca" ? (
            <HooksStage pack={project.pack} onPatch={(patch) => patchPack(project.id, patch)} />
          ) : null}
          {stage === "senaryo" && channel ? (
            <ScriptStage project={project} channel={channel} pack={project.pack} onPatch={(patch) => patchPack(project.id, patch)} />
          ) : null}
          {stage === "metin" && channel ? (
            <TextStage
              project={project}
              channel={channel}
              blocked={blocked}
              onRefuse={refuseSources}
              onPatch={(patch) => patchPack(project.id, patch)}
            />
          ) : null}
          {stage === "ses" && channel ? <VoiceStage project={project} channel={channel} /> : null}
          {stage === "cekim" ? (
            <ShotsStage pack={project.pack} onPatch={(patch) => patchPack(project.id, patch)} />
          ) : null}
          {stage === "kapak" && channel ? (
            <ThumbStage
              channel={channel}
              pack={project.pack}
              onPatch={(patch) => patchPack(project.id, patch)}
            />
          ) : null}
          {stage === "gorsel" && channel ? (
            <VisualStage project={project} channel={channel} />
          ) : null}
          {stage === "yayin" ? (
            <div className="flex flex-col gap-6">
              <SeoStage pack={project.pack} onPatch={(patch) => patchPack(project.id, patch)} />
              <KarevoSend project={project} channelName={channel?.name ?? "Kanal"} />
            </div>
          ) : null}
          {stage === "kontrol" ? (
            <div className="flex flex-col gap-6">
              <ControlStage
                project={project}
                markdown={markdown}
                onToggle={(checkId) =>
                  patchPack(project.id, {
                    checks: project.pack.checks.map((item) =>
                      item.id === checkId ? { ...item, done: !item.done } : item,
                    ),
                  })
                }
              />
              <KarevoSend project={project} channelName={channel?.name ?? "Kanal"} />
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function BriefStage({
  project,
  documentary,
  onPatch,
}: {
  project: Project;
  documentary: boolean;
  onPatch: (patch: Partial<Project["brief"]>) => void;
}) {
  const { brief } = project;
  const [minutesText, setMinutesText] = useState(String(brief.minutes));
  return (
    <div className="grid gap-4">
      <h2 className="text-2xl">Brief</h2>
      {documentary ? (
        <label className="flex flex-col gap-2 text-sm text-muted">
          Kaynaklar
          <textarea
            className={`${fieldClass} min-h-28 py-3 text-fg`}
            value={brief.sources ?? ""}
            maxLength={800}
            placeholder="Önce kaynak. Metin bundan sonra yazılır."
            onChange={(e) => onPatch({ sources: e.target.value })}
          />
          <span className="text-sm text-faint">Boş kaynakla kalıp ve Grok yazımı kapanır.</span>
        </label>
      ) : null}
      <label className="flex flex-col gap-2 text-sm text-muted">
        Başlık
        <input
          className={`${fieldClass} h-11 text-fg`}
          value={brief.title}
          maxLength={120}
          onChange={(e) => onPatch({ title: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-2 text-sm text-muted">
        İzleyici
        <input
          className={`${fieldClass} h-11 text-fg`}
          value={brief.audience}
          maxLength={80}
          onChange={(e) => onPatch({ audience: e.target.value })}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm text-muted">
          Ton
          <input
            className={`${fieldClass} h-11 text-fg`}
            value={brief.tone}
            maxLength={40}
            onChange={(e) => onPatch({ tone: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Dakika
          <input
            className={`${fieldClass} nums h-11 text-fg`}
            type="number"
            min={1}
            max={30}
            value={minutesText}
            disabled={brief.format === "shorts"}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, "");
              setMinutesText(raw);
              if (raw !== "") onPatch({ minutes: Number(raw) });
            }}
          />
        </label>
      </div>
      <label className="flex flex-col gap-2 text-sm text-muted">
        Vaat
        <textarea
          className={`${fieldClass} min-h-28 py-3 text-fg`}
          value={brief.promise}
          maxLength={400}
          onChange={(e) => onPatch({ promise: e.target.value })}
        />
      </label>
    </div>
  );
}

function TitlesStage({ pack, onPatch }: { pack: Pack; onPatch: (patch: Partial<Pack>) => void }) {
  const picked = pack.titles[pack.pick];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl">Başlık</h2>
        {picked ? <CopyButton text={picked.text} /> : null}
      </div>
      <ul className="flex flex-col gap-2">
        {pack.titles.map((item, index) => {
          const on = index === pack.pick;
          return (
            <li key={`${item.angle}-${index}`} className="rounded-xl bg-elevated p-3 ring-1 ring-line">
              <button
                type="button"
                className="flex w-full items-start gap-3 text-left"
                onClick={() => onPatch({ pick: index })}
              >
                <span
                  className={`mt-1 h-4 w-4 shrink-0 rounded-full ring-1 ${on ? "bg-paper ring-paper" : "ring-line"}`}
                  aria-hidden
                />
                <span>
                  <span className="block text-sm text-faint">{item.angle}</span>
                  <span className="mt-1 block text-base text-fg">{item.text}</span>
                  <span className="mt-1 block text-sm text-muted">{item.why}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {picked ? (
        <label className="flex flex-col gap-2 text-sm text-muted">
          Seçili başlığı düzelt
          <input
            className={`${fieldClass} h-11 text-fg`}
            value={picked.text}
            maxLength={120}
            onChange={(e) => {
              const text = e.target.value;
              onPatch({
                titles: pack.titles.map((item, i) => (i === pack.pick ? { ...item, text } : item)),
              });
            }}
          />
          <span className="nums text-faint">{[...picked.text].length} karakter</span>
        </label>
      ) : null}
    </div>
  );
}

function HooksStage({ pack, onPatch }: { pack: Pack; onPatch: (patch: Partial<Pack>) => void }) {
  function edit(index: number, patch: Partial<Hook>) {
    onPatch({
      hooks: pack.hooks.map((hook, i) => (i === index ? { ...hook, ...patch } : hook)),
    });
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl">Kanca</h2>
        <CopyButton text={pack.hooks.map((h) => `${h.window}\n${h.line}`).join("\n\n")} />
      </div>
      <p className="text-sm text-muted">Üç açılış. Birini çek. Hepsi ilk 8 saniyeye sığsın.</p>
      {pack.hooks.map((hook, index) => (
        <article key={hook.window + index} className="flex flex-col gap-3 rounded-xl bg-elevated p-4 ring-1 ring-line">
          <h3 className="nums text-lg">{hook.window}</h3>
          <textarea
            className={`${fieldClass} min-h-24 py-3`}
            value={hook.line}
            onChange={(e) => edit(index, { line: e.target.value })}
          />
          <p className="text-sm text-muted">Görüntü: {hook.visual}</p>
          <p className="text-sm text-faint">Kes: {hook.cut}</p>
        </article>
      ))}
    </div>
  );
}

function ScriptStage({
  project,
  channel,
  pack,
  onPatch,
}: {
  project: Project;
  channel: Channel;
  pack: Pack;
  onPatch: (patch: Partial<Pack>) => void;
}) {
  const { models, keyFor, patchPack } = useStudio();
  const cont = useServerFn(continueBeats);
  const plan = useServerFn(planTextSource);
  const [busy, setBusy] = useState(false);
  const [writeLabel, setWriteLabel] = useState("");
  function edit(index: number, patch: Partial<Beat>) {
    onPatch({
      beats: pack.beats.map((beat, i) => (i === index ? { ...beat, ...patch } : beat)),
    });
  }
  const script = pack.beats.map((b) => `${b.time} ${b.title}\n${b.voice}`).join("\n\n");
  const words = countWords(pack.beats.map((beat) => beat.voice).join(" "));
  const target = targetWords(project.brief.minutes);
  const short = words < target * 0.85;

  async function resume() {
    const last = pack.beats[pack.beats.length - 1];
    const blob = keyFor(providerForModel(models.text));
    const sealed = blob ? { iv: blob.iv, ciphertext: blob.ciphertext } : undefined;
    setBusy(true);
    setWriteLabel("Yazıyor…");
    try {
      const planned = await withTimeout(
        plan({ data: { writer: models.writer, textModel: models.text, sealed } }),
        45_000,
        "Süre doldu. CLI yoklanamadı.",
      );
      if (!planned.ok) {
        notify(planned.error);
        return;
      }
      setWriteLabel(`Yazıyor… (${planned.label})`);
      const res = await withTimeout(
        cont({
          data: {
            title: project.brief.title,
            language: project.brief.language,
            soFar: words,
            target,
            last: last ? `${last.time} ${last.title}\n${last.voice}` : "",
            textModel: models.text,
            writer: models.writer,
            via: planned.via,
            sealed,
          },
        }),
        190_000,
        "Süre doldu. Yazım durduruldu.",
      );
      if (!res.ok) {
        notify(res.error);
        return;
      }
      const beats = [...pack.beats, ...res.beats];
      patchPack(project.id, {
        beats,
        scenes: scenesFor(project.brief, channel, beats, pack.scenes),
      });
      notify(res.cut ? "Bölüm eklendi. Yine Devam et." : "Bölüm eklendi.");
    } catch (error) {
      notify(error instanceof Error && error.message.startsWith("Süre") ? error.message : "Devam yazılamadı.");
    } finally {
      setBusy(false);
      setWriteLabel("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl">Senaryo</h2>
          <p className="nums mt-1 text-sm text-faint">
            {words} / {target} kelime · {project.brief.minutes} dk
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {short ? (
            <Button onClick={() => void resume()} disabled={busy}>
              {busy ? writeLabel || "Yazıyor…" : "Devam et"}
            </Button>
          ) : null}
          <CopyButton text={script} />
        </div>
      </div>
      {pack.beats.map((beat, index) => (
        <article key={`${beat.time}-${index}`} className="grid gap-3 rounded-xl bg-elevated p-4 ring-1 ring-line sm:grid-cols-[4.5rem_minmax(0,1fr)]">
          <p className="nums text-sm text-faint">{beat.time}</p>
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-lg">{beat.title}{beat.draft ? " · taslak" : ""}</h3>
            <textarea
              className={`${fieldClass} min-h-24 py-3`}
              value={beat.voice}
              onChange={(e) => edit(index, { voice: e.target.value })}
            />
            <p className="text-sm text-muted">Ekran: {beat.screen}</p>
            <p className="text-sm text-faint">Görüntü: {beat.visual}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function TextStage({
  project,
  channel,
  blocked,
  onRefuse,
  onPatch,
}: {
  project: Project;
  channel: Channel;
  blocked: boolean;
  onRefuse: () => void;
  onPatch: (patch: Partial<Pack>) => void;
}) {
  const { models, keyFor } = useStudio();
  const write = useServerFn(writeNarration);
  const plan = useServerFn(planTextSource);
  const spoken = narrationText(project.pack.beats);
  const [draft, setDraft] = useState(spoken);
  const [busy, setBusy] = useState(false);
  const [writeLabel, setWriteLabel] = useState("");
  const editing = useRef(false);
  const target = targetWords(project.brief.minutes);
  const words = countWords(draft);
  const short = words < target * 0.85;

  useEffect(() => {
    if (!editing.current) setDraft(spoken);
  }, [spoken]);

  function commit(text: string) {
    onPatch({ beats: spreadNarration(project.pack.beats, text) });
  }

  async function run(continuing: boolean) {
    if (blocked) {
      onRefuse();
      return;
    }
    const blob = keyFor(providerForModel(models.text));
    const sealed = blob ? { iv: blob.iv, ciphertext: blob.ciphertext } : undefined;
    setBusy(true);
    setWriteLabel("Yazıyor…");
    try {
      const planned = await withTimeout(
        plan({ data: { writer: models.writer, textModel: models.text, sealed } }),
        45_000,
        "Süre doldu. CLI yoklanamadı.",
      );
      if (!planned.ok) {
        notify(planned.error);
        return;
      }
      const who = planned.via === "api" && models.text.startsWith("grok") ? "Grok" : planned.label;
      setWriteLabel(`Yazıyor… (${who})`);
      const res = await withTimeout(
        write({
          data: {
            title: project.brief.title,
            promise: project.brief.promise,
            audience: project.brief.audience,
            tone: project.brief.tone,
            language: project.brief.language,
            sources: project.brief.sources ?? "",
            needsSources: needsSources(channel),
            channelNote: `${channel.name}. ${channel.topic}. Ton: ${channel.tone}.`,
            target,
            soFar: continuing ? words : 0,
            previous: continuing ? draft : "",
            textModel: models.text,
            writer: models.writer,
            via: planned.via,
            sealed,
          },
        }),
        190_000,
        "Süre doldu. Yazım durduruldu.",
      );
      if (!res.ok) {
        notify(res.error);
        return;
      }
      const next = continuing && draft.trim() ? `${draft.trim()}\n\n${res.text}` : res.text;
      editing.current = false;
      setDraft(next);
      commit(next);
      notify(res.cut ? "Bölüm geldi. Yine Devam et." : `${who} metni yazdı.`);
    } catch (error) {
      notify(error instanceof Error && error.message.startsWith("Süre") ? error.message : "Metin yazılamadı.");
    } finally {
      setBusy(false);
      setWriteLabel("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl">Metin</h2>
          <p className="nums mt-1 text-sm text-faint">
            {words} / {target} kelime · {project.brief.minutes} dk
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void run(false)} disabled={busy}>
            {busy ? writeLabel || "Yazıyor…" : "Grok yazsın"}
          </Button>
          {short ? (
            <Button variant="line" onClick={() => void run(true)} disabled={busy || words < 40}>
              Devam et
            </Button>
          ) : null}
          <CopyButton text={draft} />
        </div>
      </div>
      <p className="text-sm text-muted">
        İzleyicinin duyduğu anlatı. Senaryo zamanı ve görüntüyü tutar; bu metin seslendirmeye gider.
      </p>
      <textarea
        className={`${fieldClass} min-h-80 py-3`}
        value={draft}
        placeholder="Grok yazsın, ya da metni buraya yaz."
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          editing.current = false;
          if (draft.trim() !== spoken.trim()) commit(draft);
        }}
      />
    </div>
  );
}

function ShotsStage({ pack, onPatch }: { pack: Pack; onPatch: (patch: Partial<Pack>) => void }) {
  function edit(index: number, patch: Partial<Shot>) {
    onPatch({
      shots: pack.shots.map((shot, i) => (i === index ? { ...shot, ...patch } : shot)),
    });
  }
  const text = pack.shots
    .map((s) => `${s.n} ${s.kind} ${s.frame} ${s.sec}s ${s.must ? "zorunlu" : "yedek"} — ${s.do}`)
    .join("\n");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl">Çekim</h2>
        <CopyButton text={text} />
      </div>
      <ul className="flex flex-col gap-2">
        {pack.shots.map((shot, index) => (
          <li
            key={shot.n + index}
            className="grid gap-3 rounded-xl bg-elevated p-3 ring-1 ring-line sm:grid-cols-[5rem_minmax(0,1fr)_auto]"
          >
            <div>
              <p className="nums text-sm text-faint">{shot.n}</p>
              <p className="text-sm text-fg">{shot.kind}</p>
              <p className="nums text-sm text-muted">{shot.sec}s</p>
            </div>
            <label className="flex flex-col gap-2 text-sm text-muted">
              {shot.frame}
              <input
                className={`${fieldClass} h-11`}
                value={shot.do}
                onChange={(e) => edit(index, { do: e.target.value })}
              />
            </label>
            <button
              type="button"
              className={`press h-11 rounded-lg px-3 text-sm ring-1 ${shot.must ? "bg-paper text-ink ring-paper" : "text-muted ring-line"}`}
              onClick={() => edit(index, { must: !shot.must })}
            >
              {shot.must ? "Zorunlu" : "Yedek"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ThumbStage({
  pack,
  channel,
  onPatch,
}: {
  pack: Pack;
  channel: Channel;
  onPatch: (patch: Partial<Pack>) => void;
}) {
  const { models, keyFor } = useStudio();
  const imagine = useServerFn(imagineScene);
  const [busy, setBusy] = useState(false);
  const thumb = pack.thumb;
  const paint = channel.cover;
  const prompt = [
    channel.visualStyle,
    "YouTube kapak, 16:9, tek ana öğe, karede yazı yok, logo yok.",
    thumb.face,
    thumb.layout,
    thumb.contrast,
    `Yasak: ${thumb.ban}`,
  ].join(" ");

  async function draw() {
    setBusy(true);
    try {
      const blob = keyFor("xai");
      const res = await imagine({
        data: {
          prompt,
          model: models.image,
          route: "xai",
          sealed: blob ? { iv: blob.iv, ciphertext: blob.ciphertext } : undefined,
        },
      });
      if (!res.ok) notify(mediaNote(res.error));
      else {
        onPatch({ thumb: { ...thumb, imageUrl: res.url } });
        notify("Kapak Imagine’dan geldi.");
      }
    } catch (error) {
      console.warn(error);
      notify(error instanceof Error ? error.message : "Kapak üretilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function takeFile(file: File | undefined) {
    if (!file || !file.type.startsWith("image")) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    onPatch({ thumb: { ...thumb, imageUrl: `data:${file.type};base64,${btoa(binary)}` } });
    notify("Kapak dosyadan alındı.");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl">Kapak</h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void draw()} disabled={busy}>
            {busy ? "Imagine çiziyor…" : "Grok Imagine çizsin"}
          </Button>
          <CopyButton
            text={`${thumb.words}\n${thumb.face}\n${thumb.layout}\n${thumb.contrast}\nYasak: ${thumb.ban}`}
          />
        </div>
      </div>
      <div className="relative aspect-video overflow-hidden rounded-xl" style={{ background: paint.bg }}>
        {thumb.imageUrl ? <img src={thumb.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
        <div className="relative grid h-full grid-cols-2">
          <div className="flex items-start p-3 sm:p-5" style={{ background: thumb.imageUrl ? "transparent" : paint.panel }}>
            <p
              className="font-display text-2xl font-semibold leading-none sm:text-4xl"
              style={{
                color: paint.ink,
                WebkitTextStroke: `1px ${paint.stroke}`,
                paintOrder: "stroke fill",
              }}
            >
              {thumb.words}
            </p>
          </div>
          {thumb.imageUrl ? null : (
            <div className="flex items-start justify-center p-4" style={{ background: paint.scene }}>
              <div className="mt-1 h-14 w-14 rounded-full sm:h-24 sm:w-24" style={{ background: paint.bg }} aria-hidden />
            </div>
          )}
        </div>
      </div>
      <p className="text-sm text-faint">
        Imagine fotoğrafı çizer, yazı üstte kalır. Kota bitince kendi kapağını bırak.
      </p>
      <label className="flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm text-muted ring-1 ring-dashed ring-line">
        Kapak dosyası bırak
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            void takeFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      <label className="flex flex-col gap-2 text-sm text-muted">
        Kapak yazısı
        <input
          className={`${fieldClass} h-11`}
          value={thumb.words}
          maxLength={40}
          onChange={(e) => onPatch({ thumb: { ...thumb, words: e.target.value } })}
        />
      </label>
      <p className="text-sm text-muted">{thumb.face}</p>
      <p className="text-sm text-muted">{thumb.layout}</p>
      <p className="text-sm text-faint">{thumb.contrast}</p>
      <p className="text-sm text-faint">Yasak: {thumb.ban}</p>
    </div>
  );
}

function VisualStage({ project, channel }: { project: Project; channel: Channel }) {
  const { patchPack, models, keyFor } = useStudio();
  const imagine = useServerFn(imagineScene);
  const start = useServerFn(startSceneVideo);
  const poll = useServerFn(pollSceneVideo);
  const keep = useServerFn(keepRemoteMedia);
  const readMedia = useServerFn(readProjectMedia);
  const [images, setImages] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const alive = useRef(true);
  const scenes = project.pack.scenes ?? [];

  useEffect(() => {
    alive.current = true;
    let stop = false;
    for (const scene of project.pack.scenes ?? []) {
      if (!scene.imagePath) continue;
      void readMedia({ data: { path: scene.imagePath } }).then((res) => {
        if (!stop && res.ok) setImages((prev) => ({ ...prev, [scene.id]: `data:image/png;base64,${res.base64}` }));
      });
    }
    return () => {
      alive.current = false;
      stop = true;
    };
  }, [project.id, project.updatedAt, readMedia]);

  function sealed(route: "xai" | "gemini") {
    const blob = keyFor(route);
    return blob ? { iv: blob.iv, ciphertext: blob.ciphertext } : undefined;
  }

  function routeOf(scene: Scene): "xai" | "gemini" | "elle" {
    return scene.route ?? "xai";
  }

  async function persist(scene: Scene, folder: "gorsel" | "video", url: string) {
    const index = Math.max(1, scenes.findIndex((item) => item.id === scene.id) + 1);
    const saved = await keep({
      data: {
        projectId: project.id,
        folder,
        name: `${String(index).padStart(2, "0")}.${folder === "gorsel" ? "png" : "mp4"}`,
        url,
      },
    });
    if (!saved.ok) {
      notify(saved.error);
      return "";
    }
    return saved.path;
  }

  function writeScene(id: string, patch: Partial<Scene>) {
    patchPack(project.id, {
      scenes: scenes.map((scene) => (scene.id === id ? { ...scene, ...patch } : scene)),
    });
  }

  async function onImage(scene: Scene) {
    const route = routeOf(scene);
    if (route === "elle") return;
    setBusy(`${scene.id}-img`);
    try {
      const res = await imagine({
        data: { prompt: scene.imagePrompt, model: models.image, route, sealed: sealed(route) },
      });
      if (!alive.current) return;
      if (!res.ok) notify(mediaNote(res.error));
      else {
        const path = await persist(scene, "gorsel", res.url);
        writeScene(scene.id, { imagePath: path || scene.imagePath, imageUrl: path ? undefined : res.url });
        if (res.url) setImages((prev) => ({ ...prev, [scene.id]: res.url }));
        notify(path ? "Görsel kaydedildi." : "Görsel geldi ama dosyaya yazılamadı.");
      }
    } catch (error) {
      console.error(error);
      if (alive.current) notify(error instanceof Error ? error.message : "Görsel üretilemedi.");
    } finally {
      if (alive.current) setBusy("");
    }
  }

  async function onVideo(scene: Scene) {
    const route = routeOf(scene);
    if (route === "elle") return;
    setBusy(`${scene.id}-vid`);
    try {
      const started = await start({
        data: {
          prompt: scene.videoPrompt,
          model: models.video,
          route,
          resolution: models.videoSize,
          sealed: sealed(route),
        },
      });
      if (!alive.current) return;
      if (!started.ok) {
        notify(mediaNote(started.error));
        return;
      }
      const deadline = Date.now() + 600_000;
      writeScene(scene.id, { videoStatus: "işleniyor", videoJob: started.requestId });
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, route === "gemini" ? 8000 : 5000));
        if (!alive.current) return;
        const status = await poll({ data: { requestId: started.requestId, route, sealed: sealed(route) } });
        if (!alive.current) return;
        if (!status.ok) {
          notify(mediaNote(status.error));
          return;
        }
        if (status.status === "done" && status.url) {
          const path = await persist(scene, "video", status.url);
          writeScene(scene.id, { videoUrl: status.url, videoPath: path, videoStatus: path ? "hazır" : "adres geçici" });
          notify(path ? "Video kaydedildi." : "Video geldi ama dosyaya yazılamadı.");
          return;
        }
        writeScene(scene.id, { videoStatus: "işleniyor" });
      }
      notify("Video hâlâ işleniyor. Kart durumunu gösteriyor, sorgu sürer.");
      writeScene(scene.id, { videoStatus: "işleniyor" });
    } catch (error) {
      console.error(error);
      if (alive.current) notify(error instanceof Error ? error.message : "Video başlatılamadı.");
    } finally {
      if (alive.current) setBusy("");
    }
  }

  async function copyPrompt(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Kopyalandı.");
    } catch (error) {
      console.warn(error);
      notify(error instanceof Error ? error.message : "Kopyalanamadı.");
    }
  }

  async function takeFile(scene: Scene, file: File | undefined) {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    const b64 = btoa(binary);
    if (file.type.startsWith("video")) {
      await putSceneVideo(project.id, scene.id, b64);
      setPreviews((prev) => ({ ...prev, [scene.id]: URL.createObjectURL(file) }));
      writeScene(scene.id, { videoUrl: `idb:${scene.id}` });
      notify("Video sahneye alındı.");
      return;
    }
    writeScene(scene.id, { imageUrl: `data:${file.type || "image/png"};base64,${b64}` });
    notify("Görsel sahneye alındı.");
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-2xl">Görsel</h2>
        <p className="mt-1 text-sm text-muted">
          Önce Grok Imagine, {channel.name} stili. Kota bitince Yedek API ya da kendi dosyan. Video 6 sn, Veo 8 sn.
        </p>
      </div>
      {scenes.some((scene) => !scene.imageUrl) ? (
        <Button
          disabled={Boolean(busy)}
          onClick={() => {
            const next = scenes.find((scene) => !scene.imageUrl);
            if (next) void onImage({ ...next, route: "xai" });
          }}
        >
          {busy.endsWith("-img") ? "Imagine çiziyor…" : "Sıradaki sahneyi Imagine çizsin"}
        </Button>
      ) : null}
      {scenes.length === 0 ? (
        <p className="text-sm text-muted">Sahne yok. Kalıbı kurunca promptlar gelir.</p>
      ) : null}
      {scenes.map((scene) => (
        <article key={scene.id} className="grid gap-4 rounded-xl bg-elevated p-4 ring-1 ring-line">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg">{scene.title}{scene.draft ? " · taslak" : ""}</h3>
            {scene.videoStatus ? <span className="text-sm text-muted">{scene.videoStatus}</span> : null}
            {scene.simulation ? <span className="text-sm text-fg">yapay zekâ simülasyonu</span> : null}
          </div>
          {scene.spoken ? <p className="text-sm text-fg">{scene.spoken}</p> : null}
          {scene.summary ? <p className="text-sm text-muted">{scene.summary}</p> : null}
          <label className="flex flex-col gap-2 text-sm text-muted">
            Görsel prompt
            <textarea
              className={`${fieldClass} min-h-24 py-3`}
              value={scene.imagePrompt}
              maxLength={2000}
              onChange={(event) => writeScene(scene.id, { imagePrompt: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-muted">
            Video prompt, 5–10 sn
            <textarea
              className={`${fieldClass} min-h-24 py-3`}
              value={scene.videoPrompt}
              maxLength={2000}
              onChange={(event) => writeScene(scene.id, { videoPrompt: event.target.value })}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["xai", "Grok Imagine"],
                ["gemini", "Yedek API"],
                ["elle", "Dosya"],
              ] as const
            ).map(([id, label]) => (
              <Chip key={id} active={routeOf(scene) === id} onClick={() => writeScene(scene.id, { route: id })}>
                {label}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {routeOf(scene) === "elle" ? null : (
              <>
                <Button disabled={Boolean(busy)} onClick={() => void onImage(scene)}>
                  {busy === `${scene.id}-img` ? "Üretiliyor" : routeOf(scene) === "gemini" ? "Yedek görsel" : "Imagine çiz"}
                </Button>
                <Button variant="line" disabled={Boolean(busy)} onClick={() => void onVideo(scene)}>
                  {busy === `${scene.id}-vid`
                    ? "Video işleniyor"
                    : routeOf(scene) === "gemini"
                      ? "Veo üret"
                      : "Imagine video"}
                </Button>
              </>
            )}
            <Button variant="line" onClick={() => void copyPrompt(scene.imagePrompt)}>
              Grok için kopyala
            </Button>
            <Button variant="line" onClick={() => void copyPrompt(scene.videoPrompt)}>
              Flow için kopyala
            </Button>
            <Button variant="line" disabled={Boolean(busy)} onClick={() => void onImage(scene)}>
              Görseli tekrar dene
            </Button>
            <Button variant="line" disabled={Boolean(busy)} onClick={() => void onVideo(scene)}>
              Videoyu tekrar dene
            </Button>
            <Button
              variant="line"
              disabled={Boolean(busy)}
              onClick={() => {
                void (async () => {
                  const gemini = await imagine({
                    data: { prompt: scene.imagePrompt, model: models.image, route: "gemini", sealed: sealed("gemini") },
                  });
                  if (gemini.ok) {
                    const path = await persist(scene, "gorsel", gemini.url);
                    writeScene(scene.id, { imagePath: path, imageUrl: undefined, route: "gemini" });
                    setImages((prev) => ({ ...prev, [scene.id]: gemini.url }));
                    notify("Otomatik görsel kaydedildi.");
                    return;
                  }
                  const xai = await imagine({
                    data: { prompt: scene.imagePrompt, model: models.image, route: "xai", sealed: sealed("xai") },
                  });
                  if (!xai.ok) {
                    notify(`${gemini.error} ${xai.error}`);
                    return;
                  }
                  const path = await persist(scene, "gorsel", xai.url);
                  writeScene(scene.id, { imagePath: path, imageUrl: undefined, route: "xai" });
                  setImages((prev) => ({ ...prev, [scene.id]: xai.url }));
                  notify("Yedek xAI görseli kaydedildi.");
                })();
              }}
            >
              Otomatik üret
            </Button>
          </div>
          <label
            className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg px-3 py-4 text-sm text-muted ring-1 ring-dashed ring-line"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void takeFile(scene, event.dataTransfer.files[0]);
            }}
          >
            Dosyayı buraya bırak ya da seç
            <input
              type="file"
              accept="image/*,video/mp4,video/webm"
              className="sr-only"
              onChange={(event) => {
                void takeFile(scene, event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {images[scene.id] || scene.imageUrl ? (
            <img src={images[scene.id] || scene.imageUrl} alt="" className="aspect-video w-full rounded-lg object-cover" />
          ) : null}
          {previews[scene.id] || (scene.videoUrl && !scene.videoUrl.startsWith("idb:")) ? (
            <video src={previews[scene.id] || scene.videoUrl} controls className="aspect-video w-full rounded-lg" />
          ) : scene.videoUrl?.startsWith("idb:") ? (
            <p className="text-sm text-muted">Video yüklü. Karevo paketine gider.</p>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function SeoStage({ pack, onPatch }: { pack: Pack; onPatch: (patch: Partial<Pack>) => void }) {
  const seo = pack.seo;
  const [tag, setTag] = useState("");
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-fg">YouTube'a yüklerken kopyala-yapıştır</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl">Yayın</h2>
          <Button
            variant="line"
            onClick={() => {
              const chapters = chaptersFromBeats(pack.beats);
              const body = [
                pack.seo.description,
                "",
                ...chapters.map((chapter) => `${chapter.time} ${chapter.title}`),
                "",
                pack.seo.tags.join(", "),
                "",
                pack.seo.pinned,
              ].join("\n");
              const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = "yayin.txt";
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            Hepsini .txt indir
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg">Açıklama</h3>
        <CopyButton text={seo.description} label="Açıklamayı kopyala" />
      </div>
      <label className="flex flex-col gap-2 text-sm text-muted">
        Açıklama
        <textarea
          className={`${fieldClass} min-h-56 py-3`}
          value={seo.description}
          onChange={(e) => onPatch({ seo: { ...seo, description: e.target.value } })}
        />
      </label>
      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg">Bölümler</h3>
          <CopyButton text={seo.chapters.map((chapter) => `${chapter.time} ${chapter.title}`).join("\n")} label="Bölümleri kopyala" />
        </div>
        <ul className="mt-2 flex flex-col gap-1">
          {seo.chapters.map((chapter) => (
            <li key={chapter.time + chapter.title} className="nums text-sm text-muted">
              {chapter.time} {chapter.title}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg">Etiketler</h3>
          <CopyButton text={seo.tags.join(", ")} label="Etiketleri kopyala" />
        </div>
        <ul className="mt-2 flex flex-wrap gap-2">
          {seo.tags.map((item) => (
            <li key={item}>
              <button
                type="button"
                className="press inline-flex h-11 min-h-11 items-center rounded-lg px-3 text-sm text-fg ring-1 ring-line"
                onClick={() => onPatch({ seo: { ...seo, tags: seo.tags.filter((t) => t !== item) } })}
              >
                {item}
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const next = tag.trim();
            if (next.length < 2 || seo.tags.includes(next)) return;
            onPatch({ seo: { ...seo, tags: [...seo.tags, next].slice(0, 15) } });
            setTag("");
          }}
        >
          <input
            className={`${fieldClass} h-11`}
            value={tag}
            maxLength={32}
            placeholder="Etiket ekle"
            onChange={(e) => setTag(e.target.value)}
          />
          <Button variant="line" type="submit">
            Ekle
          </Button>
        </form>
      </div>
      <label className="flex flex-col gap-2 text-sm text-muted">
        Sabit yorum
        <textarea
          className={`${fieldClass} min-h-20 py-3`}
          value={seo.pinned}
          onChange={(e) => onPatch({ seo: { ...seo, pinned: e.target.value } })}
        />
      </label>
      <CopyButton text={seo.pinned} label="Yorumu kopyala" />
      <p className="text-sm text-muted">{seo.end}</p>
    </div>
  );
}

function saveFile(name: string, data: Blob | Uint8Array) {
  const blob = data instanceof Uint8Array ? new Blob([new Uint8Array(data)]) : data;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function ControlStage({
  project,
  markdown,
  onToggle,
}: {
  project: Project;
  markdown: string;
  onToggle: (id: string) => void;
}) {
  const notes = critique(project);
  const score = scoreOf(notes);
  const done = project.pack.checks.filter((c) => c.done).length;
  const slug = project.brief.title.replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 60) || "cekim";
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl">Kontrol</h2>
          <p className="nums mt-1 text-sm text-faint">
            {done}/{project.pack.checks.length} işaret
          </p>
        </div>
        <p className="nums font-display text-5xl leading-none">{score}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {notes.map((note) => (
          <li key={note.text} className="flex gap-3 text-sm">
            <span className={`w-14 shrink-0 ${note.tone === "ok" ? "text-ok" : "text-muted"}`}>
              {note.tone === "ok" ? "Tamam" : "Düzelt"}
            </span>
            <span className="text-fg">{note.text}</span>
          </li>
        ))}
      </ul>
      <ul className="flex flex-col gap-2">
        {project.pack.checks.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onToggle(item.id)}
              className="press flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm ring-1 ring-line"
            >
              <span
                className={`h-4 w-4 rounded-sm ring-1 ${item.done ? "bg-paper ring-paper" : "ring-line"}`}
                aria-hidden
              />
              <span className={item.done ? "text-muted" : "text-fg"}>{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <CopyButton text={markdown} label="Çekim dosyasını kopyala" />
      <div className="flex flex-wrap gap-2">
        <Button variant="line" onClick={() => saveFile(`${slug}.md`, new Blob([markdown], { type: "text/markdown" }))}>
          Markdown
        </Button>
        <Button variant="line" onClick={() => saveFile(`${slug}.txt`, new Blob([plainText(markdown)], { type: "text/plain" }))}>
          Metin
        </Button>
        <Button
          variant="line"
          onClick={() => saveFile(`${slug}.docx`, docxBytes(markdown))}
        >
          Word
        </Button>
      </div>
    </div>
  );
}
