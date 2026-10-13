import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { needsSources, type Channel } from "@/lib/studio/channels";
import { briefKey, critique, scoreOf, toMarkdown, voiceMinutes } from "@/lib/studio/engine";
import { deepenPack, imagineScene, pollSceneVideo, startSceneVideo } from "@/lib/studio/generate";
import { useStudio } from "@/lib/studio/store";
import { notify } from "@/lib/studio/toast";
import { formatLabel, type Beat, type Hook, type Pack, type Project, type Scene, type Shot } from "@/lib/studio/types";
import { Button, CopyButton, fieldClass } from "./bits";
import { VoiceStage } from "./voice";

const STAGES = [
  ["brief", "Brief"],
  ["baslik", "Başlık"],
  ["kanca", "Kanca"],
  ["senaryo", "Senaryo"],
  ["ses", "Ses"],
  ["cekim", "Çekim"],
  ["kapak", "Kapak"],
  ["gorsel", "Görsel"],
  ["yayin", "Yayın"],
  ["kontrol", "Kontrol"],
] as const;

type StageId = (typeof STAGES)[number][0];

function providerForModel(model: string) {
  if (model.startsWith("gemini")) return "gemini" as const;
  if (model.startsWith("gpt")) return "openai" as const;
  if (model.startsWith("claude")) return "anthropic" as const;
  return "xai" as const;
}

export function Room({ project }: { project: Project }) {
  const { channels, patchBrief, patchPack, rebuild, applyGenerated, addSeries, models, keyFor } = useStudio();
  const deepen = useServerFn(deepenPack);
  const [stage, setStage] = useState<StageId>("baslik");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [armRebuild, setArmRebuild] = useState(false);
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
    setError("");
    try {
      const res = await deepen({
        data: {
          brief: project.brief,
          needsSources: needsSources(channel),
          textModel: models.text,
          sealed: sealedFor(models.text),
          channelNote: `${channel.name}. ${channel.topic}. ${channel.visualStyle}. ${channel.coverStyle}. Ton: ${channel.tone}.`,
        },
      });
      if (!res.ok) {
        setError(res.error);
        notify(res.error);
      } else {
        applyGenerated(project.id, res.pack);
        setStage("baslik");
        notify("Grok paketi yazıldı.");
      }
    } catch {
      const text = "İstek tamamlanamadı. Masa kalıbı duruyor.";
      setError(text);
      notify(text);
    } finally {
      setBusy(false);
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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
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
            <Button onClick={() => void onGrok()} disabled={busy}>
              {busy ? "Grok yazıyor" : "Grok ile yaz"}
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
        <p className="text-sm text-faint">Grok tek istek atar. Aynı brief’i tekrar yazdırmak kotayı yer.</p>
      </header>

      <nav className="flex gap-2 overflow-x-auto lg:hidden" aria-label="Aşamalar">
        {STAGES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setStage(id)}
            className={`press h-11 shrink-0 rounded-lg px-3 text-sm font-medium ring-1 ${
              stage === id ? "bg-paper text-ink ring-paper" : "text-fg ring-line"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

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
          {stage === "senaryo" ? (
            <ScriptStage pack={project.pack} onPatch={(patch) => patchPack(project.id, patch)} />
          ) : null}
          {stage === "ses" && channel ? <VoiceStage project={project} channel={channel} /> : null}
          {stage === "cekim" ? (
            <ShotsStage pack={project.pack} onPatch={(patch) => patchPack(project.id, patch)} />
          ) : null}
          {stage === "kapak" && channel ? (
            <ThumbStage channel={channel} pack={project.pack} onPatch={(patch) => patchPack(project.id, patch)} />
          ) : null}
          {stage === "gorsel" && channel ? (
            <VisualStage project={project} channel={channel} />
          ) : null}
          {stage === "yayin" ? (
            <SeoStage pack={project.pack} onPatch={(patch) => patchPack(project.id, patch)} />
          ) : null}
          {stage === "kontrol" ? (
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
            value={brief.minutes}
            disabled={brief.format === "shorts"}
            onChange={(e) => onPatch({ minutes: Number(e.target.value) || 1 })}
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

function ScriptStage({ pack, onPatch }: { pack: Pack; onPatch: (patch: Partial<Pack>) => void }) {
  function edit(index: number, patch: Partial<Beat>) {
    onPatch({
      beats: pack.beats.map((beat, i) => (i === index ? { ...beat, ...patch } : beat)),
    });
  }
  const script = pack.beats.map((b) => `${b.time} ${b.title}\n${b.voice}`).join("\n\n");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl">Senaryo</h2>
        <CopyButton text={script} />
      </div>
      {pack.beats.map((beat, index) => (
        <article key={`${beat.time}-${index}`} className="grid gap-3 rounded-xl bg-elevated p-4 ring-1 ring-line sm:grid-cols-[4.5rem_minmax(0,1fr)]">
          <p className="nums text-sm text-faint">{beat.time}</p>
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-lg">{beat.title}</h3>
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
  const thumb = pack.thumb;
  const paint = channel.cover;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl">Kapak</h2>
        <CopyButton
          text={`${thumb.words}\n${thumb.face}\n${thumb.layout}\n${thumb.contrast}\nYasak: ${thumb.ban}`}
        />
      </div>
      <div className="aspect-video overflow-hidden rounded-xl" style={{ background: paint.bg }}>
        <div className="grid h-full grid-cols-2">
          <div className="flex items-start p-3 sm:p-5" style={{ background: paint.panel }}>
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
          <div className="flex items-start justify-center p-4" style={{ background: paint.scene }}>
            <div
              className="mt-1 h-14 w-14 rounded-full sm:h-24 sm:w-24"
              style={{ background: paint.bg }}
              aria-hidden
            />
          </div>
        </div>
      </div>
      <p className="text-sm text-faint">
        Kadraj kılavuzu, fotoğraf değil. Yazı üst yarıda, kalın ve konturlu, en fazla beş kelime. Tek karakter.
        Başlık tekrarlanmaz.
      </p>
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
  const [busy, setBusy] = useState("");
  const alive = useRef(true);
  const scenes = project.pack.scenes ?? [];

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function sealed() {
    const blob = keyFor("xai");
    return blob ? { iv: blob.iv, ciphertext: blob.ciphertext } : undefined;
  }

  function writeScene(id: string, patch: Partial<Scene>) {
    patchPack(project.id, {
      scenes: scenes.map((scene) => (scene.id === id ? { ...scene, ...patch } : scene)),
    });
  }

  async function onImage(scene: Scene) {
    setBusy(`${scene.id}-img`);
    try {
      const res = await imagine({
        data: { prompt: scene.imagePrompt, model: models.image, sealed: sealed() },
      });
      if (!alive.current) return;
      if (!res.ok) notify(res.error);
      else {
        writeScene(scene.id, { imageUrl: res.url });
        notify("Görsel geldi.");
      }
    } catch {
      if (alive.current) notify("Görsel üretilemedi.");
    } finally {
      if (alive.current) setBusy("");
    }
  }

  async function onVideo(scene: Scene) {
    setBusy(`${scene.id}-vid`);
    try {
      const started = await start({
        data: { prompt: scene.videoPrompt, model: models.video, sealed: sealed() },
      });
      if (!alive.current) return;
      if (!started.ok) {
        notify(started.error);
        return;
      }
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        if (!alive.current) return;
        const status = await poll({ data: { requestId: started.requestId, sealed: sealed() } });
        if (!alive.current) return;
        if (!status.ok) {
          notify(status.error);
          return;
        }
        if (status.status === "done" && status.url) {
          writeScene(scene.id, { videoUrl: status.url });
          notify("Video geldi.");
          return;
        }
      }
      notify("Video hâlâ işleniyor. Birazdan aynı sahneyi tekrar dene.");
    } catch {
      if (alive.current) notify("Video başlatılamadı.");
    } finally {
      if (alive.current) setBusy("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-2xl">Görsel</h2>
        <p className="mt-1 text-sm text-muted">
          {channel.name} stili. Her sahne tek tek. Video 6 saniye, 720p, kota harcar.
        </p>
      </div>
      {scenes.length === 0 ? (
        <p className="text-sm text-muted">Sahne yok. Kalıbı kurunca promptlar gelir.</p>
      ) : null}
      {scenes.map((scene) => (
        <article key={scene.id} className="grid gap-4 rounded-xl bg-elevated p-4 ring-1 ring-line">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg">{scene.title}</h3>
            {scene.simulation ? <span className="text-sm text-fg">yapay zekâ simülasyonu</span> : null}
          </div>
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
            <Button disabled={Boolean(busy)} onClick={() => void onImage(scene)}>
              {busy === `${scene.id}-img` ? "Üretiliyor" : "Görsel üret"}
            </Button>
            <Button variant="line" disabled={Boolean(busy)} onClick={() => void onVideo(scene)}>
              {busy === `${scene.id}-vid` ? "Video işleniyor" : "Video üret"}
            </Button>
          </div>
          {scene.imageUrl ? (
            <img src={scene.imageUrl} alt="" className="aspect-video w-full rounded-lg object-cover" />
          ) : null}
          {scene.videoUrl ? <video src={scene.videoUrl} controls className="aspect-video w-full rounded-lg" /> : null}
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
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl">Yayın</h2>
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
        <h3 className="text-lg">Bölümler</h3>
        <ul className="mt-2 flex flex-col gap-1">
          {seo.chapters.map((chapter) => (
            <li key={chapter.time + chapter.title} className="nums text-sm text-muted">
              {chapter.time} {chapter.title}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-lg">Etiketler</h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {seo.tags.map((item) => (
            <li key={item}>
              <button
                type="button"
                className="press h-10 rounded-lg px-3 text-sm text-fg ring-1 ring-line"
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
    </div>
  );
}
