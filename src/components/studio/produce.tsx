import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import type { Channel } from "@/lib/studio/channels";
import { scenesFor, chaptersFromBeats } from "@/lib/studio/engine";
import { exportFolderName } from "@/lib/studio/karevo";
import { productionLook, voiceCast } from "@/lib/studio/look";
import { narrationText, spreadNarration } from "@/lib/studio/narration";
import { haltProduce, openShoot, produceMedia, produceStep, produceVoice, saveShoot } from "@/lib/studio/produce";
import { keepRemoteMedia } from "@/lib/studio/project-files";
import { cleanSpeech } from "@/lib/studio/speech-clean";
import { useStudio } from "@/lib/studio/store";
import { notify } from "@/lib/studio/toast";
import type { Pack, Project } from "@/lib/studio/types";
import { Button } from "./bits";

type Status = "bekliyor" | "calisiyor" | "bitti" | "hata" | "durduruldu";

type Row = {
  id: string;
  label: string;
  status: Status;
  ms: number;
  source: string;
  detail: string;
  preview: string;
};

const STEPS = [
  ["baslik", "Başlık"],
  ["kanca", "Kanca"],
  ["senaryo", "Senaryo"],
  ["ses", "Ses"],
  ["altsahne", "Sahne promptu"],
  ["gorsel", "Görsel"],
  ["video", "Video"],
  ["yayin", "Yayın"],
  ["kontrol", "Kontrol"],
] as const;

type StepId = (typeof STEPS)[number][0];

const MARK: Record<Status, string> = {
  bekliyor: "·",
  calisiyor: "⏳",
  bitti: "✓",
  hata: "✗",
  durduruldu: "–",
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Süre doldu.")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function clock(ms: number) {
  if (!ms) return "";
  return `${Math.max(1, Math.round(ms / 1000))} sn`;
}

export function ProduceScreen({
  project,
  channel,
  auto = false,
  onClose,
}: {
  project: Project;
  channel: Channel;
  auto?: boolean;
  onClose: () => void;
}) {
  const { models, keyFor, patchPack } = useStudio();
  const stepCall = useServerFn(produceStep);
  const media = useServerFn(produceMedia);
  const voice = useServerFn(produceVoice);
  const save = useServerFn(saveShoot);
  const open = useServerFn(openShoot);
  const keep = useServerFn(keepRemoteMedia);
  const stopJobs = useServerFn(haltProduce);
  const look = productionLook(channel);
  const cast = voiceCast(channel);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [folder, setFolder] = useState("");
  const [parts, setParts] = useState<string[]>([]);
  const [speech, setSpeech] = useState("");
  const [removed, setRemoved] = useState<string[]>([]);
  const [speechReady, setSpeechReady] = useState(false);
  const [imageAt, setImageAt] = useState(0);
  const [videoAt, setVideoAt] = useState(0);
  const [voiceAt, setVoiceAt] = useState(0);
  const [audios, setAudios] = useState<string[]>([]);
  const stop = useRef(0);
  const flying = useRef(false);
  const [rows, setRows] = useState<Row[]>(() =>
    STEPS.map(([id, label]) => ({
      id,
      label,
      status: "bekliyor" as const,
      ms: 0,
      source: "",
      detail: "",
      preview: previewOf(id, project.pack),
    })),
  );

  function patch(id: string, next: Partial<Row>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...next } : row)));
  }

  function seal() {
    const saved = keyFor("xai");
    return saved ? { iv: saved.iv, ciphertext: saved.ciphertext } : undefined;
  }

  function geminiSeal() {
    const saved = keyFor("gemini");
    return saved ? { iv: saved.iv, ciphertext: saved.ciphertext } : undefined;
  }

  const step = STEPS[cursor][0];
  const pack = project.pack;
  const scenes = pack.scenes.length ? pack.scenes : scenesFor(project.brief, channel, pack.beats);

  function fields(extra: Record<string, unknown> = {}) {
    return {
      title: project.brief.title,
      promise: project.brief.promise,
      audience: project.brief.audience || channel.audience,
      tone: project.brief.tone || channel.tone,
      minutes: project.brief.minutes,
      sources: project.brief.sources ?? "",
      model: models.text,
      sealed: seal(),
      kanal: channel.name,
      konu: channel.topic,
      stil: channel.visualStyle,
      kapak: channel.coverStyle,
      ses: cast.sesle,
      oran: look.aspect,
      pickedTitle: pack.titles[pack.pick]?.text || project.brief.title,
      hook: pack.hooks[0]?.line ?? "",
      senaryo: pack.beats.map((beat) => `${beat.title}\n${beat.voice}`).join("\n\n"),
      parcalar: parts.join("\n\n"),
      ...extra,
    };
  }

  const pinned = useRef<StepId | null>(null);

  async function runStep() {
    if (flying.current) return;
    const step = pinned.current ?? STEPS[cursor][0];
    pinned.current = null;
    const mine = stop.current + 1;
    flying.current = true;
    stop.current = mine;
    const started = Date.now();
    setBusy(true);
    patch(step, { status: "calisiyor" });
    const fresh = () => stop.current === mine;
    try {
      if (step === "baslik" || step === "kanca" || step === "senaryo") {
        const res = await withTimeout(stepCall({ data: { step, ...fields() } }), 180_000);
        if (!fresh()) { patch(step, { status: "durduruldu", detail: "Durduruldu.", ms: Date.now() - started }); return; }
        if (!res.ok) throw new Error(res.error);
        if (step === "baslik" && "titles" in res && res.titles) {
          const pick = "secilen" in res && typeof res.secilen === "number" ? res.secilen : 0;
          patchPack(project.id, { titles: res.titles, pick, source: "grok" });
          patch(step, { status: "bitti", ms: Date.now() - started, source: res.label, preview: res.titles[pick]?.text ?? res.titles[0].text, detail: "neden" in res ? res.neden : res.titles[0].why });
        } else if (step === "kanca" && "hooks" in res && res.hooks) {
          const pick = "secilen" in res && typeof res.secilen === "number" ? res.secilen : 0;
          patchPack(project.id, { hooks: res.hooks, source: "grok" });
          patch(step, { status: "bitti", ms: Date.now() - started, source: res.label, preview: res.hooks[pick]?.line ?? res.hooks[0].line, detail: "İlk 15 saniye." });
        } else if (step === "senaryo" && "beats" in res && res.beats) {
          patchPack(project.id, { beats: res.beats, source: "grok" });
          setParts([]);
          setSpeechReady(false);
          patch(step, {
            status: "bitti",
            ms: Date.now() - started,
            source: res.label,
            preview: res.beats.map((beat) => `${beat.time} ${beat.title}`).join("\n"),
            detail: `${res.beats.length} bölüm. Taslak kalktı.`,
          });
        } else throw new Error("Bu adım boş döndü.");
        return;
      }
      if (step === "altsahne") {
        let list = scenes;
        if (scenes.every((scene) => scene.draft || !scene.spoken) && pack.beats.some((beat) => beat.voice && !beat.draft)) {
          list = [];
          for (const beat of pack.beats) {
            const groups = sentenceGroups(beat.voice);
            groups.forEach((spoken, group) => {
              list.push({
                id: `sahne-${list.length + 1}`,
                title: groups.length > 1 ? `${beat.title} ${group + 1}` : beat.title,
                spoken,
                imagePrompt: "",
                videoPrompt: "",
                summary: "",
                simulation: false,
                draft: false,
              });
            });
          }
          patchPack(project.id, { scenes: list });
        }
        const index = list.findIndex((scene) => !scene.imagePrompt);
        if (index < 0) {
          setImageAt(0);
          setVideoAt(0);
          patch(step, { status: "bitti", ms: Date.now() - started, detail: `${list.length} sahne promptu`, preview: list.map((scene) => scene.summary).filter(Boolean).join("\n") });
          return;
        }
        const scene = list[index];
        const asked = await withTimeout(
          stepCall({
            data: {
              step,
              ...fields({
                anlatim: scene.spoken || scene.title,
                onceki: list.slice(0, index).map((item) => item.summary).filter(Boolean).join(" | ") || "yok",
                benzer: list[index - 1]?.imagePrompt || "",
              }),
            },
          }),
          180_000,
        );
        if (!fresh()) { patch(step, { status: "durduruldu", detail: "Durduruldu.", ms: Date.now() - started }); return; }
        if (!asked.ok) throw new Error(asked.error);
        if (!("prompt" in asked) || !asked.prompt || !("video_prompt" in asked) || !asked.video_prompt) throw new Error("Sahne promptu gelmedi.");
        const ozet = "konu_ozeti" in asked && asked.konu_ozeti ? asked.konu_ozeti : scene.title;
        const next = list.map((item, itemIndex) =>
          itemIndex === index ? { ...item, summary: ozet, imagePrompt: asked.prompt || "", videoPrompt: asked.video_prompt || "", draft: false } : item,
        );
        patchPack(project.id, { scenes: next });
        const done = next.every((item) => item.imagePrompt);
        patch(step, {
          status: done ? "bitti" : "bekliyor",
          ms: Date.now() - started,
          source: asked.label,
          preview: "",
          detail: `${index + 1}/${next.length} · ${ozet}`,
        });
        return;
      }
      if (step === "gorsel" || step === "video") {
        const index = step === "gorsel" ? imageAt : videoAt;
        const scene = scenes[index];
        if (!scene) {
          patch(step, { status: "bitti", detail: "Sahne kalmadı.", ms: Date.now() - started });
          return;
        }
        if (step === "video" && (scene.mediaKind === "gorsel" || (look.videos === "first" && index > 0))) {
          setVideoAt(index + 1);
          patch(step, { status: index + 1 >= scenes.length ? "bitti" : "bekliyor", source: channel.name, detail: "Bu sahne görsel. Video yok.", preview: scene.title });
          return;
        }
        const ready = step === "gorsel" ? scene.imagePrompt : scene.videoPrompt;
        let prompt = ready;
        let ozet = scene.summary ?? "";
        if (!ready) {
          const onceki = scenes
            .slice(0, index)
            .map((item) => item.summary)
            .filter(Boolean)
            .join(" | ");
          const asked = await withTimeout(
            stepCall({
              data: {
                step,
                ...fields({
                  anlatim: scene.spoken || scene.title,
                  gorsel: scene.imagePrompt,
                  onceki: onceki || "yok",
                }),
              },
            }),
            180_000,
          );
          if (!fresh()) { patch(step, { status: "durduruldu", detail: "Durduruldu.", ms: Date.now() - started }); return; }
          if (!asked.ok) throw new Error(asked.error);
          if (!("prompt" in asked) || !asked.prompt) throw new Error("Prompt gelmedi.");
          prompt = asked.prompt;
          ozet = "konu_ozeti" in asked && asked.konu_ozeti ? asked.konu_ozeti : scene.title;
          const drafted = scenes.map((item, itemIndex) =>
            itemIndex === index
              ? { ...item, summary: ozet, ...(step === "gorsel" ? { imagePrompt: prompt } : { videoPrompt: prompt }) }
              : item,
          );
          patchPack(project.id, { scenes: drafted });
          if (!auto) {
            patch(step, {
              status: "bekliyor",
              ms: Date.now() - started,
              source: asked.label,
              preview: "",
              detail: ozet,
            });
            return;
          }
        }
        const res = await withTimeout(
          media({
            data: {
              kind: step === "gorsel" ? "image" : "video",
              prompt,
              aspect: look.aspect,
              imageModel: models.image,
              videoModel: models.video,
              resolution: models.videoSize,
              xai: seal(),
              gemini: geminiSeal(),
            },
          }),
          step === "video" ? 610_000 : 190_000,
        );
        if (!fresh()) { patch(step, { status: "durduruldu", detail: "Durduruldu.", ms: Date.now() - started }); return; }
        if (!res.ok) throw new Error(res.copy ? `${res.error} ${prompt}` : res.error);
        const stored = await keep({
          data: {
            projectId: project.id,
            folder: step === "gorsel" ? "gorsel" : "video",
            name: `${String(index + 1).padStart(2, "0")}.${step === "gorsel" ? "png" : "mp4"}`,
            url: res.url,
          },
        });
        if (!stored.ok) throw new Error(stored.error);
        const nextScenes = scenes.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                summary: ozet || item.summary,
                ...(step === "gorsel"
                  ? { imagePrompt: prompt, imagePath: stored.path, imageUrl: undefined }
                  : { videoPrompt: prompt, videoPath: stored.path, videoUrl: undefined, videoStatus: "hazır" }),
              }
            : item,
        );
        patchPack(project.id, { scenes: nextScenes });
        if (step === "gorsel") setImageAt(index + 1);
        else setVideoAt(index + 1);
        const done = index + 1 >= scenes.length;
        patch(step, {
          status: done ? "bitti" : "calisiyor",
          ms: Date.now() - started,
          source: res.source,
          preview: res.url,
          detail: `${index + 1}/${scenes.length} · ${ozet || scene.summary || scene.title}`,
        });
        return;
      }
      if (step === "ses") {
        const beat = pack.beats[voiceAt];
        if (!beat) {
          patch(step, { status: "bitti", detail: "Seslenecek bölüm kalmadı.", ms: Date.now() - started, source: cast.sesle });
          return;
        }
        if (beat.draft) throw new Error("Bölüm hâlâ taslak. Önce senaryo yazılsın.");
        const cleaned = cleanSpeech(beat.voice);
        if (cleaned.blocked) throw new Error(cleaned.blocked);
        const res = await withTimeout(
          voice({
            data: {
              text: cleaned.text.slice(0, 3000),
              sesle: cast.sesle,
              xai: cast.xai,
              language: project.brief.language,
              folder: exportFolderName(project.brief.title),
              projectId: project.id,
              index: voiceAt,
              sealed: seal(),
            },
          }),
          180_000,
        );
        if (!fresh()) { patch(step, { status: "durduruldu", detail: "Durduruldu.", ms: Date.now() - started }); return; }
        if (!res.ok) throw new Error(res.error);
        patchPack(project.id, {
          beats: pack.beats.map((item, index) =>
            index === voiceAt ? { ...item, voice: cleaned.text, audioPath: res.path, duration: res.duration || item.duration, draft: false } : item,
          ),
        });
        setVoiceAt(voiceAt + 1);
        const done = voiceAt + 1 >= pack.beats.length;
        patch(step, {
          status: done ? "bitti" : "bekliyor",
          ms: Date.now() - started,
          source: res.source,
          preview: `data:audio/mpeg;base64,${res.audioBase64}`,
          detail: `${voiceAt + 1}/${pack.beats.length} · ${res.path || beat.title}`,
        });
        return;
      }
      if (step === "yayin") {
        const asked = await withTimeout(stepCall({ data: { step, ...fields() } }), 180_000);
        if (!fresh()) { patch(step, { status: "durduruldu", detail: "Durduruldu.", ms: Date.now() - started }); return; }
        if (!asked.ok) throw new Error(asked.error);
        if (!("aciklama" in asked) || !asked.aciklama) throw new Error("Açıklama gelmedi.");
        patchPack(project.id, {
          seo: {
            ...pack.seo,
            description: asked.aciklama,
            tags: asked.etiketler ?? pack.seo.tags,
            pinned: asked.sabit_yorum || pack.seo.pinned,
            chapters: chaptersFromBeats(pack.beats),
          },
        });
        patch(step, { status: "bitti", ms: Date.now() - started, source: asked.label, preview: asked.aciklama.slice(0, 280), detail: "YouTube'a yüklerken kopyala-yapıştır" });
        return;
      }
      const checked = await withTimeout(stepCall({ data: { step: "kontrol", ...fields() } }), 180_000);
      if (!fresh()) { patch(step, { status: "durduruldu", detail: "Durduruldu.", ms: Date.now() - started }); return; }
      if (!checked.ok) throw new Error(checked.error);
      if (!("puan" in checked)) throw new Error("Puan gelmedi.");
      patch(step, {
        status: "bitti",
        ms: Date.now() - started,
        source: checked.label,
        preview: String(checked.puan),
        detail: (checked.duzeltmeler ?? []).join(" "),
      });
    } catch (error) {
      if (!fresh()) {
        patch(step, { status: "durduruldu", detail: "Durduruldu.", ms: Date.now() - started });
        return;
      }
      const message = error instanceof Error ? error.message : "Adım durdu.";
      patch(step, { status: "hata", ms: Date.now() - started, detail: message });
      notify(message);
    } finally {
      if (fresh()) {
        flying.current = false;
        setBusy(false);
      }
    }
  }

  async function writeFolder() {
    setBusy(true);
    try {
      const folderName = exportFolderName(project.brief.title);
      const saved = await save({
        data: {
          folderName,
          name: pack.titles[pack.pick]?.text || project.brief.title,
          channel: channel.name,
          resolution: look.aspect === "9:16" ? "1080x1920" : "1920x1080",
          scenes: scenes.map((scene, index) => ({
            n: index + 1,
            title: scene.title,
            text: pack.beats[index]?.voice ?? "",
            simulation: scene.simulation,
            duration: scene.audioDuration || look.seconds,
            imageUrl: scene.imageUrl,
            videoUrl: scene.videoUrl,
            audioBase64: audios[index],
          })),
        },
      });
      if (!saved.ok) throw new Error(saved.error);
      setFolder(folderName);
      notify("Çıktı klasöre yazıldı.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Klasör yazılamadı.");
    } finally {
      setBusy(false);
    }
  }

  function retry(id: StepId) {
    pinned.current = id;
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, status: "bekliyor", detail: "" } : row)));
    setCursor(STEPS.findIndex(([key]) => key === id));
    void runRef.current();
  }

  function retryFailed() {
    const failed = rows.find((row) => row.status === "hata" || row.status === "durduruldu");
    if (!failed) return;
    pinned.current = failed.id as StepId;
    setRows((prev) =>
      prev.map((row) => (row.status === "hata" || row.status === "durduruldu" ? { ...row, status: "bekliyor", detail: "" } : row)),
    );
    setCursor(STEPS.findIndex(([key]) => key === failed.id));
    void runRef.current();
  }

  const runRef = useRef(runStep);
  runRef.current = runStep;
  useEffect(() => {
    if (!auto || busy || flying.current) return;
    const row = rows.find((item) => item.id === step);
    if (!row || row.status === "hata" || row.status === "durduruldu") return;
    if (row.status === "bitti") {
      if (cursor < STEPS.length - 1) setCursor(cursor + 1);
      return;
    }
    void runRef.current();
  }, [auto, busy, step, rows, cursor]);

  const current = rows.find((row) => row.id === step);
  const done = rows.filter((row) => row.status === "bitti").length;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-bg text-fg">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 pb-16">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-faint">Adım adım · {channel.name}</p>
            <h1 className="text-3xl">{project.brief.title}</h1>
            <p className="mt-1 text-sm text-muted">Grok tek adımı yazar. Başlık, kanca, senaryo, metin ayrı. Sonrakine sen geçersin.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="line"
              disabled={!busy}
              onClick={() => {
                stop.current += 1;
                flying.current = false;
                setBusy(false);
                patch(step, { status: "durduruldu", detail: "Durduruldu." });
                void stopJobs({ data: {} }).catch((error) => {
                  console.warn(error);
                  notify(error instanceof Error ? error.message : "Durdurulamadı.");
                });
              }}
            >
              Durdur
            </Button>
            <Button variant="line" disabled={busy || !rows.some((row) => row.status === "hata" || row.status === "durduruldu")} onClick={retryFailed}>
              Hatalıları tekrar dene
            </Button>
            <Button variant="line" disabled={busy} onClick={() => void writeFolder()}>
              Klasöre yaz
            </Button>
            {folder ? (
              <Button
                variant="line"
                onClick={() => {
                  void open({ data: { folderName: folder } }).then((res) => notify(res.ok ? res.path : res.error));
                }}
              >
                Klasörü aç
              </Button>
            ) : null}
            <Button variant="quiet" onClick={onClose}>
              Kapat
            </Button>
          </div>
        </div>
        <div>
          <div className="mb-2 flex justify-between text-sm text-muted">
            <span>{STEPS[cursor][1]}</span>
            <span className="nums">{done}/{STEPS.length}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-subtle">
            <div className="h-full bg-paper" style={{ width: `${Math.round((done / STEPS.length) * 100)}%` }} />
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {STEPS.map(([id, label], index) => {
            const row = rows.find((item) => item.id === id);
            return (
              <div key={id} className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCursor(index)}
                  className={`press h-11 rounded-full px-3 text-sm ${index === cursor ? "bg-paper text-ink" : "text-muted ring-1 ring-line"}`}
                >
                  {row ? MARK[row.status] : "·"} {label}
                </button>
                <button type="button" className="press h-11 px-2 text-sm text-muted" disabled={busy} onClick={() => retry(id)}>
                  Tekrar dene
                </button>
              </div>
            );
          })}
        </div>
        {current ? (
          <article className="rounded-2xl bg-elevated p-4 ring-1 ring-line">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-2xl">
                <span className="mr-2">{MARK[current.status]}</span>
                {current.label}
              </h2>
              <p className="text-sm text-faint">{[current.source, clock(current.ms)].filter(Boolean).join(" · ")}</p>
            </div>
            {current.detail ? <p className="mt-2 text-sm text-muted">{current.detail}</p> : null}
            {step === "ses" ? (
              <div className="mt-3 flex flex-col gap-2">
                <textarea
                  value={speech}
                  onChange={(event) => setSpeech(event.target.value)}
                  rows={6}
                  className="w-full rounded-lg bg-subtle px-3 py-2 text-base text-fg ring-1 ring-line outline-none"
                />
                {removed.length ? (
                  <div>
                    <p className="text-sm text-muted">Çıkarılanlar</p>
                    <ul className="mt-1 text-sm text-faint">
                      {removed.slice(0, 8).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            {step === "gorsel" || step === "video" ? (
              <p className="mt-2 text-sm text-fg">{scenes[step === "gorsel" ? imageAt : videoAt]?.summary || "Özet, çizimden önce burada durur."}</p>
            ) : null}
            {step === "ses" ? <p className="mt-2 text-sm text-faint">{cast.sesle} · 1.00×</p> : null}
            {current.preview.startsWith("data:image") || current.preview.startsWith("http") ? (
              <img src={current.preview} alt="" className="mt-3 aspect-video w-full max-w-md rounded-lg object-cover" />
            ) : null}
            {current.preview.includes("video") ? <video src={current.preview} controls className="mt-3 aspect-video w-full max-w-md rounded-lg" /> : null}
            {current.preview.startsWith("data:audio") ? <audio src={current.preview} controls className="mt-3 w-full" /> : null}
            {current.preview && !current.preview.startsWith("data:") && !current.preview.startsWith("http") ? (
              <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{current.preview}</p>
            ) : null}
            {current.status === "hata" && current.detail.length > 20 ? (
              <button
                type="button"
                className="press mt-2 h-11 text-sm"
                onClick={() => void navigator.clipboard.writeText(current.detail).then(() => notify("Kopyalandı."), () => notify("Kopyalanamadı."))}
              >
                Grok/Flow için kopyala
              </button>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void runStep()}>
                {busy ? "Yazıyor…" : stepLabel(step, speechReady, imageAt, videoAt, voiceAt, scenes)}
              </Button>
              {step === "gorsel" || step === "video" ? (
                <Button
                  variant="line"
                  disabled={busy}
                  onClick={() => {
                    const index = step === "gorsel" ? imageAt : videoAt;
                    patchPack(project.id, {
                      scenes: scenes.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, summary: undefined, ...(step === "gorsel" ? { imagePrompt: "" } : { videoPrompt: "" }) }
                          : item,
                      ),
                    });
                    patch(step, { status: "bekliyor", detail: "", preview: "" });
                  }}
                >
                  Özeti yeniden yaz
                </Button>
              ) : null}
              {cursor < STEPS.length - 1 ? (
                <Button variant="line" disabled={busy} onClick={() => setCursor(cursor + 1)}>
                  Sonraki adım
                </Button>
              ) : null}
            </div>
          </article>
        ) : null}
      </div>
    </div>
  );
}

function previewOf(id: string, pack: Pack) {
  if (id === "baslik") return pack.titles[pack.pick]?.text ?? "";
  if (id === "kanca") return pack.hooks[0]?.line ?? "";
  if (id === "senaryo") return pack.beats.map((beat) => `${beat.draft ? "taslak " : ""}${beat.time} ${beat.title}`).join("\n");
  if (id === "yayin") return pack.seo.description.slice(0, 280);
  return "";
}

function sentenceGroups(text: string) {
  const sentences = text.split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter((item) => item.length > 8);
  const groups: string[] = [];
  for (let index = 0; index < sentences.length; index += 2) groups.push(sentences.slice(index, index + 2).join(" "));
  return groups.length ? groups : [text];
}

function stepLabel(
  step: StepId,
  _speechReady: boolean,
  imageAt: number,
  videoAt: number,
  voiceAt: number,
  scenes: { imagePrompt: string; videoPrompt: string }[],
) {
  if (step === "baslik") return "Başlığı Grok yazsın";
  if (step === "kanca") return "Kancayı Grok yazsın";
  if (step === "senaryo") return "Senaryoyu Grok yazsın";
  if (step === "altsahne") return "Sahne promptunu yaz";
  if (step === "gorsel") return scenes[imageAt]?.imagePrompt ? "Bunu çiz" : "Ne çizileceğini yaz";
  if (step === "video") return scenes[videoAt]?.videoPrompt ? "Bunu çek" : "Ne çekileceğini yaz";
  if (step === "ses") return voiceAt === 0 ? "İlk bölümü seslendir" : "Sıradaki bölümü seslendir";
  if (step === "yayin") return "Yayın metnini yaz";
  return "Puanı hesapla";
}
