import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import type { Channel } from "@/lib/studio/channels";
import { scenesFor, critique, scoreOf } from "@/lib/studio/engine";
import { continueBeats, deepenPack } from "@/lib/studio/generate";
import { exportFolderName } from "@/lib/studio/karevo";
import { productionLook, voiceCast } from "@/lib/studio/look";
import { countWords, narrationChunks, narrationText, targetWords } from "@/lib/studio/narration";
import { openShoot, planProduceText, produceMedia, produceVoice, saveShoot } from "@/lib/studio/produce";
import { useStudio } from "@/lib/studio/store";
import { notify } from "@/lib/studio/toast";
import type { Pack, Project, Scene } from "@/lib/studio/types";
import { Button } from "./bits";

type Status = "bekliyor" | "calisiyor" | "bitti" | "hata";
type Media = "text" | "image" | "video" | "audio" | "score";

type Row = {
  id: string;
  label: string;
  status: Status;
  ms: number;
  source: string;
  detail: string;
  preview: string;
  media: Media;
};

const MARK: Record<Status, string> = {
  bekliyor: "·",
  calisiyor: "⏳",
  bitti: "✓",
  hata: "✗",
};

function blank(id: string, label: string, media: Media): Row {
  return { id, label, status: "bekliyor", ms: 0, source: "", detail: "", preview: "", media };
}

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
  const { models, keyFor, applyGenerated, patchPack } = useStudio();
  const plan = useServerFn(planProduceText);
  const deepen = useServerFn(deepenPack);
  const cont = useServerFn(continueBeats);
  const media = useServerFn(produceMedia);
  const voice = useServerFn(produceVoice);
  const save = useServerFn(saveShoot);
  const open = useServerFn(openShoot);
  const [rows, setRows] = useState<Row[]>([
    blank("baslik", "Başlık", "text"),
    blank("kanca", "Kanca", "text"),
    blank("senaryo", "Senaryo", "text"),
    blank("sahneler", "Sahne listesi", "text"),
    blank("kapak", "Kapak", "image"),
    blank("kontrol", "Kontrol puanı", "score"),
  ]);
  const [phase, setPhase] = useState<"calisiyor" | "bitti" | "durdu">("calisiyor");
  const [folder, setFolder] = useState("");
  const rowsRef = useRef(rows);
  const stopRef = useRef(false);
  const alive = useRef(true);
  const projectRef = useRef(project);
  projectRef.current = project;
  rowsRef.current = rows;
  const look = productionLook(channel);
  const cast = voiceCast(channel);

  function patch(id: string, next: Partial<Row>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...next } : row)));
  }

  function upsert(row: Row) {
    setRows((prev) => (prev.some((item) => item.id === row.id) ? prev.map((item) => (item.id === row.id ? { ...item, ...row } : item)) : [...prev, row]));
  }

  function skipped(id: string) {
    return rowsRef.current.find((row) => row.id === id)?.status === "bitti";
  }

  async function run(retry: boolean) {
    stopRef.current = false;
    setPhase("calisiyor");
    const current = projectRef.current;
    const blob = (provider: "xai" | "gemini") => {
      const saved = keyFor(provider);
      return saved ? { iv: saved.iv, ciphertext: saved.ciphertext } : undefined;
    };
    let pack: Pack = current.pack;
    let scriptFailed = false;
    let via = models.writer === "api" ? "api" : models.writer;
    let label = "API";
    let textModel = models.text;
    const sealed = blob("xai");

    const fail = (id: string, message: string, started: number) => {
      patch(id, { status: "hata", detail: message, ms: Date.now() - started, source: label });
      notify(message);
    };

    if (!(retry && skipped("baslik"))) {
      const started = Date.now();
      patch("baslik", { status: "calisiyor" });
      patch("kanca", { status: "calisiyor" });
      patch("senaryo", { status: "calisiyor", detail: "İlk bölüm" });
      try {
        const route = await withTimeout(plan({ data: { model: models.text, sealed } }), 180_000);
        if (!route.ok) throw new Error(route.error);
        via = route.via;
        label = route.label;
        textModel = route.model;
        const res = await withTimeout(
          deepen({
            data: {
              ...current.brief,
              needsSources: false,
              textModel,
              writer: via === "api" ? "api" : via,
              via,
              sealed,
              channelNote: `${channel.name}. ${channel.topic}. ${look.image}`,
            },
          }),
          180_000,
        );
        if (!res.ok) throw new Error(res.error);
        applyGenerated(current.id, res.pack);
        pack = {
          ...pack,
          ...res.pack,
          source: "grok",
          pick: 0,
          scenes: scenesFor(current.brief, channel, res.pack.beats, pack.scenes),
        };
        const ms = Date.now() - started;
        patch("baslik", { status: "bitti", ms, source: label, preview: res.pack.titles[0]?.text ?? "", detail: res.pack.titles[0]?.why ?? "" });
        patch("kanca", { status: "bitti", ms, source: label, preview: res.pack.hooks[0]?.line ?? "", detail: res.pack.hooks[0]?.visual ?? "" });
        patch("senaryo", {
          status: "calisiyor",
          ms,
          source: label,
          preview: res.pack.beats.map((beat) => beat.voice).join("\n\n").slice(0, 700),
          detail: `${countWords(res.pack.beats.map((beat) => beat.voice).join(" "))} kelime`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Metin yazılamadı.";
        fail("baslik", message, started);
        fail("kanca", message, started);
        fail("senaryo", message, started);
        scriptFailed = true;
      }
    }

    const target = targetWords(current.brief.minutes);
    let guard = 0;
    while (!stopRef.current && !scriptFailed && countWords(narrationText(pack.beats)) < target * 0.85 && guard < 6) {
      if (retry && skipped("senaryo")) break;
      guard += 1;
      const started = Date.now();
      const soFar = countWords(narrationText(pack.beats));
      patch("senaryo", { status: "calisiyor", detail: `Bölüm ${guard + 1} · ${soFar}/${target}`, source: label });
      try {
        const last = pack.beats[pack.beats.length - 1];
        const res = await withTimeout(
          cont({
            data: {
              title: current.brief.title,
              language: current.brief.language,
              soFar,
              target,
              last: last ? `${last.time} ${last.title}\n${last.voice}` : "",
              textModel,
              writer: via,
              via,
              sealed,
            },
          }),
          180_000,
        );
        if (!res.ok) throw new Error(res.error);
        pack = {
          ...pack,
          beats: [...pack.beats, ...res.beats],
          scenes: scenesFor(current.brief, channel, [...pack.beats, ...res.beats], pack.scenes),
        };
        patchPack(current.id, { beats: pack.beats, scenes: pack.scenes });
        patch("senaryo", {
          status: "calisiyor",
          ms: Date.now() - started,
          source: label,
          preview: narrationText(pack.beats).slice(-700),
          detail: `${countWords(narrationText(pack.beats))} / ${target} kelime`,
        });
      } catch (error) {
        fail("senaryo", error instanceof Error ? error.message : "Senaryo devam edemedi.", started);
        scriptFailed = true;
        break;
      }
    }
    if (!stopRef.current && !scriptFailed) {
      patch("senaryo", { status: "bitti", detail: `${countWords(narrationText(pack.beats))} kelime`, source: label });
    }

    if (stopRef.current) {
      setPhase("durdu");
      return;
    }

    const scenes = pack.scenes.length ? pack.scenes : scenesFor(current.brief, channel, pack.beats);
    patch("sahneler", {
      status: "bitti",
      source: label,
      preview: scenes.map((scene, index) => `${index + 1}. ${scene.title}`).join("\n"),
      detail: `${scenes.length} sahne`,
    });

    const sceneState = scenes.map((scene) => ({ ...scene }));
    const made: { scene: Scene; imageUrl?: string; videoUrl?: string; audio?: string; duration: number }[] = sceneState.map((scene) => ({
      scene,
      duration: look.seconds,
    }));

    for (let index = 0; index < scenes.length; index += 1) {
      if (stopRef.current) break;
      const scene = scenes[index];
      const id = `gorsel-${index}`;
      if (retry && skipped(id)) {
        made[index].imageUrl = rowsRef.current.find((row) => row.id === id)?.preview;
        continue;
      }
      upsert(blank(id, `Görsel · ${scene.title}`, "image"));
      const started = Date.now();
      patch(id, { status: "calisiyor" });
      const prompt = `${look.image} ${scene.imagePrompt}`.slice(0, 1700);
      try {
        const res = await withTimeout(
          media({
            data: {
              kind: "image",
              prompt,
              aspect: look.aspect,
              imageModel: models.image,
              xai: sealed,
              gemini: blob("gemini"),
            },
          }),
          190_000,
        );
        if (!res.ok) throw new Error(res.copy ? `${res.error} Prompt kopyalanabilir.` : res.error);
        made[index].imageUrl = res.url;
        sceneState[index] = { ...sceneState[index], imageUrl: res.url, route: "xai" };
        patch(id, { status: "bitti", ms: Date.now() - started, source: res.source, preview: res.url, detail: scene.title });
        patchPack(current.id, { scenes: sceneState });
      } catch (error) {
        fail(id, error instanceof Error ? error.message : "Görsel yok.", started);
        patch(id, { detail: prompt });
      }
    }

    for (let index = 0; index < scenes.length; index += 1) {
      if (stopRef.current) break;
      const scene = scenes[index];
      const id = `video-${index}`;
      if (retry && skipped(id)) {
        made[index].videoUrl = rowsRef.current.find((row) => row.id === id)?.preview;
        continue;
      }
      upsert(blank(id, `Video · ${scene.title}`, "video"));
      if (look.videos === "first" && index > 0) {
        patch(id, { status: "bitti", source: channel.name, detail: "Görsel ağırlıklı kanal. Video yok.", ms: 1 });
        continue;
      }
      const started = Date.now();
      patch(id, { status: "calisiyor", detail: "Sırada, tek tek." });
      const prompt = `${look.video} ${scene.videoPrompt}`.slice(0, 1700);
      try {
        const res = await withTimeout(
          media({
            data: {
              kind: "video",
              prompt,
              aspect: look.aspect,
              videoModel: models.video,
              resolution: models.videoSize,
              xai: sealed,
              gemini: blob("gemini"),
            },
          }),
          610_000,
        );
        if (!res.ok) throw new Error(res.error);
        made[index].videoUrl = res.url;
        patch(id, { status: "bitti", ms: Date.now() - started, source: res.source, preview: res.url, detail: `${look.seconds} sn` });
      } catch (error) {
        fail(id, error instanceof Error ? error.message : "Video yok.", started);
        patch(id, { detail: prompt });
      }
    }

    const chunks = narrationChunks(narrationText(pack.beats));
    for (let index = 0; index < chunks.length; index += 1) {
      if (stopRef.current) break;
      const id = `ses-${index}`;
      if (retry && skipped(id)) {
        if (made[index]) made[index].audio = rowsRef.current.find((row) => row.id === id)?.preview;
        continue;
      }
      upsert(blank(id, `Ses · parça ${index + 1}`, "audio"));
      const started = Date.now();
      patch(id, { status: "calisiyor", detail: cast.sesle });
      try {
        const res = await withTimeout(
          voice({
            data: {
              text: chunks[index],
              sesle: cast.sesle,
              xai: cast.xai,
              language: current.brief.language,
              folder: exportFolderName(current.brief.title),
              sealed,
            },
          }),
          180_000,
        );
        if (!res.ok) throw new Error(res.error);
        const url = `data:audio/mpeg;base64,${res.audioBase64}`;
        if (made[index]) {
          made[index].audio = res.audioBase64;
          made[index].duration = res.duration || look.seconds;
        }
        patch(id, { status: "bitti", ms: Date.now() - started, source: res.source, preview: url, detail: cast.sesle });
      } catch (error) {
        fail(id, error instanceof Error ? error.message : "Ses yok.", started);
      }
    }

    if (!stopRef.current && !(retry && skipped("kapak"))) {
      const started = Date.now();
      patch("kapak", { status: "calisiyor" });
      const prompt = `${look.image} YouTube kapak. ${pack.thumb.face} ${pack.thumb.layout}`.slice(0, 1700);
      try {
        const res = await withTimeout(
          media({ data: { kind: "image", prompt, aspect: look.aspect, imageModel: models.image, xai: sealed, gemini: blob("gemini") } }),
          190_000,
        );
        if (!res.ok) throw new Error(res.error);
        patchPack(current.id, { thumb: { ...pack.thumb, imageUrl: res.url } });
        patch("kapak", { status: "bitti", ms: Date.now() - started, source: res.source, preview: res.url, detail: pack.thumb.words });
      } catch (error) {
        fail("kapak", error instanceof Error ? error.message : "Kapak yok.", started);
      }
    }

    const notes = critique({ ...current, pack });
    const score = scoreOf(notes);
    patch("kontrol", {
      status: "bitti",
      source: "Masa",
      preview: String(score),
      detail: notes.map((note) => note.text).slice(0, 3).join(" "),
    });

    if (stopRef.current) {
      setPhase("durdu");
      return;
    }

    const folderName = exportFolderName(current.brief.title);
    try {
      const saved = await save({
        data: {
          folderName,
          name: pack.titles[0]?.text || current.brief.title,
          channel: channel.name,
          resolution: look.aspect === "9:16" ? "1080x1920" : "1920x1080",
          scenes: made.map((item, index) => ({
            n: index + 1,
            title: item.scene.title,
            text: pack.beats[index]?.voice ?? chunks[index] ?? "",
            simulation: item.scene.simulation,
            duration: item.duration,
            imageUrl: item.imageUrl,
            videoUrl: item.videoUrl,
            audioBase64: item.audio,
          })),
        },
      });
      if (!saved.ok) throw new Error(saved.error);
      setFolder(folderName);
      notify("Çıktı klasöre yazıldı.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Klasör yazılamadı.");
    }
    setPhase("bitti");
  }

  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    alive.current = true;
    void runRef.current(false);
    return () => {
      alive.current = false;
      stopRef.current = true;
    };
  }, []);

  const done = rows.filter((row) => row.status === "bitti" || row.status === "hata").length;
  const progress = rows.length ? Math.round((done / rows.length) * 100) : 0;
  const images = rows.filter((row) => row.id.startsWith("gorsel-"));
  const videos = rows.filter((row) => row.id.startsWith("video-"));

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-bg text-fg">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 pb-16">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-faint">Üretim · {channel.name}</p>
            <h1 className="text-3xl">{project.brief.title}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="line" onClick={() => { stopRef.current = true; setPhase("durdu"); }}>
              Durdur
            </Button>
            <Button variant="line" disabled={phase === "calisiyor"} onClick={() => void run(true)}>
              Hatalıları tekrar dene
            </Button>
            {phase === "bitti" ? (
              <Button
                onClick={() => {
                  void open({ data: { folderName: folder || exportFolderName(project.brief.title) } }).then((res) => {
                    if (!res.ok) notify(res.error);
                    else notify(res.path);
                  });
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
            <span>{phase === "bitti" ? "Bitti" : phase === "durdu" ? "Durduruldu" : "Üretiliyor"}</span>
            <span className="nums">{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-subtle">
            <div className="h-full bg-paper" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <ol className="flex flex-col gap-3">
          {rows.filter((row) => !row.id.startsWith("gorsel-") && !row.id.startsWith("video-") && !row.id.startsWith("ses-")).map((row) => (
            <li key={row.id} className="rounded-xl bg-elevated p-4 ring-1 ring-line">
              <StepHead row={row} />
              {row.media === "image" && row.preview.startsWith("data:") ? (
                <img src={row.preview} alt="" className="mt-3 aspect-video w-full max-w-sm rounded-lg object-cover" />
              ) : null}
              {row.media === "score" && row.preview ? <p className="nums mt-2 text-3xl">{row.preview}</p> : null}
              {row.media === "text" && row.preview ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{row.preview}</p> : null}
            </li>
          ))}
        </ol>
        {images.length ? (
          <section>
            <h2 className="text-xl">Görseller</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((row) => (
                <article key={row.id} className="rounded-xl bg-elevated p-3 ring-1 ring-line">
                  <StepHead row={row} />
                  {row.preview.startsWith("data:") || row.preview.startsWith("http") ? (
                    <img src={row.preview} alt="" className="mt-2 aspect-video w-full rounded-lg object-cover" />
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
        {videos.length ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-xl">Videolar</h2>
            {videos.map((row) => (
              <article key={row.id} className="rounded-xl bg-elevated p-4 ring-1 ring-line">
                <StepHead row={row} />
                {row.preview.includes("video") || row.preview.startsWith("http") ? (
                  <video src={row.preview} controls className="mt-3 aspect-video w-full rounded-lg" />
                ) : null}
              </article>
            ))}
          </section>
        ) : null}
        {rows.some((row) => row.id.startsWith("ses-")) ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-xl">Ses</h2>
            {rows.filter((row) => row.id.startsWith("ses-")).map((row) => (
              <article key={row.id} className="rounded-xl bg-elevated p-4 ring-1 ring-line">
                <StepHead row={row} />
                {row.preview.startsWith("data:audio") ? <audio src={row.preview} controls className="mt-3 w-full" /> : null}
              </article>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function StepHead({ row }: { row: Row }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-lg">
        <span className="mr-2" aria-hidden>{MARK[row.status]}</span>
        {row.label}
      </h3>
      <p className="text-sm text-faint">
        {[row.source, clock(row.ms)].filter(Boolean).join(" · ")}
      </p>
      {row.detail ? <p className="w-full text-sm text-muted">{row.detail.slice(0, 220)}</p> : null}
      {row.status === "hata" && row.detail.length > 40 ? (
        <button
          type="button"
          className="press h-11 text-sm text-fg"
          onClick={() => {
            void navigator.clipboard.writeText(row.detail).then(
              () => notify("Kopyalandı."),
              () => notify("Kopyalanamadı."),
            );
          }}
        >
          Grok/Flow için kopyala
        </button>
      ) : null}
    </div>
  );
}
