import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import type { Channel } from "@/lib/studio/channels";
import { critique, scenesFor, scoreOf } from "@/lib/studio/engine";
import { writeNarration } from "@/lib/studio/generate";
import { exportFolderName } from "@/lib/studio/karevo";
import { productionLook, voiceCast } from "@/lib/studio/look";
import { countWords, narrationChunks, narrationText, spreadNarration, targetWords } from "@/lib/studio/narration";
import { openShoot, planProduceText, produceMedia, produceStep, produceVoice, saveShoot } from "@/lib/studio/produce";
import { useStudio } from "@/lib/studio/store";
import { notify } from "@/lib/studio/toast";
import type { Pack, Project } from "@/lib/studio/types";
import { Button } from "./bits";

type Status = "bekliyor" | "calisiyor" | "bitti" | "hata";

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
  ["metin", "Metin"],
  ["sahneler", "Sahne listesi"],
  ["gorsel", "Görsel"],
  ["video", "Video"],
  ["ses", "Ses"],
  ["kapak", "Kapak"],
  ["kontrol", "Kontrol"],
] as const;

type StepId = (typeof STEPS)[number][0];

const MARK: Record<Status, string> = {
  bekliyor: "·",
  calisiyor: "⏳",
  bitti: "✓",
  hata: "✗",
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
  onClose,
}: {
  project: Project;
  channel: Channel;
  onClose: () => void;
}) {
  const { models, keyFor, patchPack } = useStudio();
  const stepCall = useServerFn(produceStep);
  const plan = useServerFn(planProduceText);
  const write = useServerFn(writeNarration);
  const media = useServerFn(produceMedia);
  const voice = useServerFn(produceVoice);
  const save = useServerFn(saveShoot);
  const open = useServerFn(openShoot);
  const look = productionLook(channel);
  const cast = voiceCast(channel);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [folder, setFolder] = useState("");
  const [narration, setNarration] = useState("");
  const [passes, setPasses] = useState(0);
  const [imageAt, setImageAt] = useState(0);
  const [videoAt, setVideoAt] = useState(0);
  const [voiceAt, setVoiceAt] = useState(0);
  const [audios, setAudios] = useState<string[]>([]);
  const stop = useRef(0);
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
  const words = countWords(narration);
  const target = targetWords(project.brief.minutes);
  const chunks = narrationChunks(narration);

  async function runStep() {
    const mine = stop.current + 1;
    stop.current = mine;
    const started = Date.now();
    setBusy(true);
    patch(step, { status: "calisiyor" });
    const fresh = () => stop.current === mine;
    try {
      if (step === "baslik" || step === "kanca" || step === "senaryo") {
        const res = await withTimeout(
          stepCall({
            data: {
              step,
              ...project.brief,
              model: models.text,
              sealed: seal(),
              channelNote: `${channel.name}. ${channel.topic}. ${look.image}`,
              pickedTitle: pack.titles[pack.pick]?.text ?? project.brief.title,
              hook: pack.hooks[0]?.line ?? "",
            },
          }),
          180_000,
        );
        if (!fresh()) return;
        if (!res.ok) throw new Error(res.error);
        if (step === "baslik" && "titles" in res && res.titles) {
          patchPack(project.id, { titles: res.titles, pick: 0, source: "grok" });
          patch(step, { status: "bitti", ms: Date.now() - started, source: res.label, preview: res.titles[0].text, detail: res.titles[0].why });
        } else if (step === "kanca" && "hooks" in res && res.hooks) {
          patchPack(project.id, { hooks: res.hooks, source: "grok" });
          patch(step, { status: "bitti", ms: Date.now() - started, source: res.label, preview: res.hooks[0].line, detail: res.hooks[0].visual });
        } else if (step === "senaryo" && "beats" in res && res.beats) {
          const nextScenes = scenesFor(project.brief, channel, res.beats, pack.scenes);
          patchPack(project.id, { beats: res.beats, scenes: nextScenes, source: "grok" });
          setNarration("");
          setPasses(0);
          patch(step, {
            status: "bitti",
            ms: Date.now() - started,
            source: res.label,
            preview: res.beats.map((beat) => `${beat.time} ${beat.title}`).join("\n"),
            detail: `${res.beats.length} bölüm. Metin sonra yazılır.`,
          });
        } else throw new Error("Bu adım boş döndü.");
        return;
      }
      if (step === "metin") {
        const route = await withTimeout(plan({ data: { model: models.text, sealed: seal() } }), 45_000);
        if (!fresh()) return;
        if (!route.ok) throw new Error(route.error);
        const res = await withTimeout(
          write({
            data: {
              title: pack.titles[pack.pick]?.text || project.brief.title,
              promise: project.brief.promise,
              audience: project.brief.audience,
              tone: project.brief.tone,
              language: project.brief.language,
              sources: project.brief.sources ?? "",
              needsSources: false,
              channelNote: `${channel.name}. ${channel.topic}. ${channel.tone}.`,
              target,
              soFar: passes === 0 ? 0 : words,
              previous: passes === 0 ? "" : narration,
              textModel: route.model,
              writer: route.via === "api" ? "api" : route.via,
              via: route.via,
              sealed: seal(),
            },
          }),
          180_000,
        );
        if (!fresh()) return;
        if (!res.ok) throw new Error(res.error);
        const next = passes === 0 ? res.text : `${narration.trim()}\n\n${res.text}`;
        const beats = spreadNarration(pack.beats, next);
        patchPack(project.id, { beats, scenes: scenesFor(project.brief, channel, beats, pack.scenes) });
        setNarration(next);
        setPasses(passes + 1);
        const count = countWords(next);
        patch(step, {
          status: count >= target * 0.85 ? "bitti" : "bekliyor",
          ms: Date.now() - started,
          source: res.label,
          preview: next.slice(-700),
          detail: count >= target * 0.85 ? `${count} kelime` : `${count} / ${target} kelime. Sonraki bölüm için yine bas.`,
        });
        return;
      }
      if (step === "sahneler") {
        const nextScenes = scenesFor(project.brief, channel, pack.beats, pack.scenes);
        patchPack(project.id, { scenes: nextScenes });
        patch(step, {
          status: "bitti",
          ms: Date.now() - started,
          source: "Senaryo",
          preview: nextScenes.map((scene, index) => `${index + 1}. ${scene.title}`).join("\n"),
          detail: `${nextScenes.length} sahne`,
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
        if (step === "video" && look.videos === "first" && index > 0) {
          setVideoAt(index + 1);
          patch(step, { status: index + 1 >= scenes.length ? "bitti" : "calisiyor", source: channel.name, detail: "Bu kanal görsel ağırlıklı. Video atlandı.", preview: scene.title });
          return;
        }
        const prompt = `${step === "gorsel" ? look.image : look.video} ${step === "gorsel" ? scene.imagePrompt : scene.videoPrompt}`.slice(0, 1700);
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
        if (!fresh()) return;
        if (!res.ok) throw new Error(res.copy ? `${res.error} Prompt aşağıda.` : res.error);
        const nextScenes = scenes.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...(step === "gorsel" ? { imageUrl: res.url } : { videoUrl: res.url }) } : item,
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
          detail: `${index + 1}/${scenes.length} · ${scene.title}`,
        });
        return;
      }
      if (step === "ses") {
        const text = chunks[voiceAt];
        if (!text) {
          patch(step, { status: "bitti", detail: "Okunacak parça kalmadı.", ms: Date.now() - started });
          return;
        }
        const res = await withTimeout(
          voice({
            data: {
              text,
              sesle: cast.sesle,
              xai: cast.xai,
              language: project.brief.language,
              folder: exportFolderName(project.brief.title),
              sealed: seal(),
            },
          }),
          180_000,
        );
        if (!fresh()) return;
        if (!res.ok) throw new Error(res.error);
        setAudios((prev) => {
          const next = [...prev];
          next[voiceAt] = res.audioBase64;
          return next;
        });
        setVoiceAt(voiceAt + 1);
        patch(step, {
          status: voiceAt + 1 >= chunks.length ? "bitti" : "calisiyor",
          ms: Date.now() - started,
          source: res.source,
          preview: `data:audio/mpeg;base64,${res.audioBase64}`,
          detail: `${voiceAt + 1}/${chunks.length} · ${cast.sesle}`,
        });
        return;
      }
      if (step === "kapak") {
        const prompt = `${look.image} YouTube kapak. ${pack.thumb.face} ${pack.thumb.layout}`.slice(0, 1700);
        const res = await withTimeout(
          media({
            data: { kind: "image", prompt, aspect: look.aspect, imageModel: models.image, xai: seal(), gemini: geminiSeal() },
          }),
          190_000,
        );
        if (!fresh()) return;
        if (!res.ok) throw new Error(res.error);
        patchPack(project.id, { thumb: { ...pack.thumb, imageUrl: res.url } });
        patch(step, { status: "bitti", ms: Date.now() - started, source: res.source, preview: res.url, detail: pack.thumb.words });
        return;
      }
      const notes = critique(project);
      const score = scoreOf(notes);
      patch(step, { status: "bitti", ms: Date.now() - started, source: "Masa", preview: String(score), detail: notes.map((note) => note.text).slice(0, 2).join(" ") });
    } catch (error) {
      if (!fresh()) return;
      const message = error instanceof Error ? error.message : "Adım durdu.";
      patch(step, { status: "hata", ms: Date.now() - started, detail: message });
      notify(message);
    } finally {
      if (fresh()) setBusy(false);
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
            <Button variant="line" disabled={!busy} onClick={() => { stop.current += 1; setBusy(false); }}>
              Durdur
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
              <button
                key={id}
                type="button"
                onClick={() => setCursor(index)}
                className={`press h-11 shrink-0 rounded-full px-3 text-sm ${index === cursor ? "bg-paper text-ink" : "text-muted ring-1 ring-line"}`}
              >
                {row ? MARK[row.status] : "·"} {label}
              </button>
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
            {step === "metin" ? (
              <p className="nums mt-2 text-sm text-faint">{words} / {target} kelime</p>
            ) : null}
            {step === "gorsel" ? <p className="mt-2 text-sm text-faint">Sıradaki {Math.min(imageAt + 1, scenes.length)} / {scenes.length}</p> : null}
            {step === "video" ? <p className="mt-2 text-sm text-faint">Sıradaki {Math.min(videoAt + 1, scenes.length)} / {scenes.length}</p> : null}
            {step === "ses" ? <p className="mt-2 text-sm text-faint">Sıradaki parça {Math.min(voiceAt + 1, Math.max(chunks.length, 1))} / {chunks.length || 0}</p> : null}
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
                {busy ? "Yazıyor…" : stepLabel(step, passes, imageAt, videoAt, voiceAt)}
              </Button>
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
  if (id === "senaryo") return pack.beats.map((beat) => `${beat.time} ${beat.title}`).join("\n");
  if (id === "metin") return narrationText(pack.beats).slice(0, 700);
  return "";
}

function stepLabel(step: StepId, passes: number, imageAt: number, videoAt: number, voiceAt: number) {
  if (step === "baslik") return "Başlığı Grok yazsın";
  if (step === "kanca") return "Kancayı Grok yazsın";
  if (step === "senaryo") return "Senaryoyu Grok yazsın";
  if (step === "metin") return passes === 0 ? "Metni Grok yazsın" : "Sonraki bölümü yaz";
  if (step === "sahneler") return "Sahne listesini kur";
  if (step === "gorsel") return imageAt === 0 ? "İlk görseli çiz" : "Sıradaki görseli çiz";
  if (step === "video") return videoAt === 0 ? "İlk videoyu çek" : "Sıradaki videoyu çek";
  if (step === "ses") return voiceAt === 0 ? "İlk parçayı oku" : "Sıradaki parçayı oku";
  if (step === "kapak") return "Kapağı çiz";
  return "Puanı hesapla";
}
