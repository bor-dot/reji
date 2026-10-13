import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Channel } from "@/lib/studio/channels";
import { pollSesleJob, speakScript, startSesleJob } from "@/lib/studio/generate";
import { exportFolderName } from "@/lib/studio/karevo";
import { narrationChunks, narrationText } from "@/lib/studio/narration";
import { putSceneAudio } from "@/lib/studio/scene-audio";
import { useStudio } from "@/lib/studio/store";
import { notify } from "@/lib/studio/toast";
import type { Project } from "@/lib/studio/types";
import { SPEECH_TAGS, VOICE_LIMIT, VOICES, voiceById, voiceForChannel, type Voice } from "@/lib/studio/voices";
import { Button, Chip, fieldClass } from "./bits";

type Word = { text: string; start: number; end: number };
type Clip = { url: string; contentType: string; duration: number; words: Word[]; key: string };
type Take = { id: string; text: string; voiceId: string; speed: number; createdAt: number };

const PREFS = "reji.ses.v1";
const HISTORY = "reji.ses.history.v1";

function clock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS);
    return raw ? (JSON.parse(raw) as { voiceId?: string; speed?: number }) : null;
  } catch {
    return null;
  }
}

function loadHistory(): Take[] {
  try {
    const raw = localStorage.getItem(HISTORY);
    const rows = raw ? (JSON.parse(raw) as Take[]) : [];
    return Array.isArray(rows) ? rows.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function scriptOf(project: Project) {
  return project.pack.beats
    .map((beat) => beat.voice.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, VOICE_LIMIT);
}

export function VoiceStage({ project, channel }: { project: Project; channel: Channel }) {
  const { keyFor, patchPack } = useStudio();
  const speak = useServerFn(speakScript);
  const suggested = voiceForChannel(channel);
  const area = useRef<HTMLTextAreaElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const cache = useRef(new Map<string, Clip>());
  const [text, setText] = useState(() => scriptOf(project));
  const [voiceId, setVoiceId] = useState(suggested.id);
  const [speed, setSpeed] = useState(1);
  const [gender, setGender] = useState<"hepsi" | "kadın" | "erkek">("hepsi");
  const [busy, setBusy] = useState(false);
  const [sceneBusy, setSceneBusy] = useState("");
  const [mode, setMode] = useState<"sesle" | "xai">("xai");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [clip, setClip] = useState<Clip | null>(null);
  const [history, setHistory] = useState<Take[]>([]);
  const [ready, setReady] = useState(false);
  const voice = voiceById(voiceId);
  const key = `${text.trim()}|${voiceId}|${speed.toFixed(2)}`;
  const stale = !clip || clip.key !== key;
  const shown = useMemo(
    () =>
      [...(gender === "hepsi" ? VOICES : VOICES.filter((item) => item.gender === gender))].sort(
        (a, b) => Number(!!b.featured) - Number(!!a.featured),
      ),
    [gender],
  );
  const activeWord = useMemo(() => {
    if (!clip?.words.length) return -1;
    for (let i = 0; i < clip.words.length; i++) {
      const word = clip.words[i];
      if (time >= word.start && time < word.end) return i;
    }
    return playing && time >= clip.words[clip.words.length - 1].end ? clip.words.length - 1 : -1;
  }, [clip, time, playing]);

  useEffect(() => {
    const prefs = loadPrefs();
    if (prefs?.voiceId && VOICES.some((item) => item.id === prefs.voiceId)) setVoiceId(prefs.voiceId);
    if (prefs?.speed) setSpeed(Math.min(1.5, Math.max(0.7, prefs.speed)));
    setHistory(loadHistory());
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(PREFS, JSON.stringify({ voiceId, speed }));
  }, [ready, voiceId, speed]);

  useEffect(() => {
    const node = audio.current;
    if (!clip || !node) return;
    node.currentTime = 0;
    void node.play().catch(() => setPlaying(false));
  }, [clip]);

  useEffect(() => {
    const bag = cache.current;
    return () => {
      for (const item of bag.values()) URL.revokeObjectURL(item.url);
    };
  }, []);

  function remember(take: Omit<Take, "id" | "createdAt">) {
    const next = [
      { ...take, id: `${Date.now()}`, createdAt: Date.now() },
      ...history.filter((item) => item.text !== take.text || item.voiceId !== take.voiceId),
    ].slice(0, 12);
    setHistory(next);
    localStorage.setItem(HISTORY, JSON.stringify(next));
  }

  function forget(id: string) {
    const next = history.filter((item) => item.id !== id);
    setHistory(next);
    localStorage.setItem(HISTORY, JSON.stringify(next));
  }

  function wrap(before: string, after: string) {
    const node = area.current;
    const start = node?.selectionStart ?? text.length;
    const end = node?.selectionEnd ?? text.length;
    const selected = text.slice(start, end);
    const next = text.slice(0, start) + before + selected + after + text.slice(end);
    setText(next.slice(0, VOICE_LIMIT));
    requestAnimationFrame(() => {
      node?.focus();
      const caret = after ? start + before.length : start + before.length + selected.length + after.length;
      const caretEnd = after ? end + before.length : caret;
      node?.setSelectionRange(caret, caretEnd);
    });
  }

  async function render() {
    const spoken = text.trim();
    if (spoken.length < 2) {
      notify("Önce bir metin yaz.");
      return;
    }
    if (spoken.length > VOICE_LIMIT) {
      notify(`En fazla ${VOICE_LIMIT.toLocaleString("tr")} karakter.`);
      return;
    }
    const cached = cache.current.get(key);
    if (cached) {
      setClip(cached);
      setTime(0);
      return;
    }
    setBusy(true);
    try {
      const blob = keyFor("xai");
      const res = await speak({
        data: {
          text: spoken,
          voiceId,
          speed,
          language: project.brief.language,
          sealed: blob ? { iv: blob.iv, ciphertext: blob.ciphertext } : undefined,
        },
      });
      if (!res.ok) {
        notify(res.error);
        return;
      }
      const bytes = Uint8Array.from(atob(res.audioBase64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: res.contentType || "audio/mpeg" }));
      const next: Clip = {
        url,
        contentType: res.contentType || "audio/mpeg",
        duration: res.duration,
        words: res.words,
        key,
      };
      const previous = cache.current.get(key);
      if (previous) URL.revokeObjectURL(previous.url);
      cache.current.set(key, next);
      setClip(next);
      setTime(0);
      remember({ text: spoken, voiceId, speed });
      notify("Ses hazır.");
    } catch {
      notify("Ses oluşturulamadı. Tekrar dene.");
    } finally {
      setBusy(false);
    }
  }

  async function speakScene(index: number) {
    const beat = project.pack.beats[index];
    const scene = project.pack.scenes[index];
    const spoken = beat?.voice.trim() ?? "";
    if (!scene || spoken.length < 2) {
      notify("Bu sahnede anlatım yok.");
      return;
    }
    setSceneBusy(scene.id);
    try {
      const blob = keyFor("xai");
      const res = await speak({
        data: {
          text: spoken.slice(0, VOICE_LIMIT),
          voiceId,
          speed,
          language: project.brief.language,
          sealed: blob ? { iv: blob.iv, ciphertext: blob.ciphertext } : undefined,
        },
      });
      if (!res.ok) {
        notify(res.error);
        return;
      }
      const duration = res.duration || res.words.at(-1)?.end || 0;
      if (duration <= 0) {
        notify("Ses süresi gelmedi.");
        return;
      }
      await putSceneAudio(project.id, scene.id, res.audioBase64, duration);
      patchPack(project.id, {
        scenes: project.pack.scenes.map((item) => (item.id === scene.id ? { ...item, audioDuration: duration } : item)),
      });
      notify(`${String(index + 1).padStart(2, "0")} sahne sesi hazır.`);
    } catch {
      notify("Sahne sesi yazılamadı.");
    } finally {
      setSceneBusy("");
    }
  }

  function toggle() {
    const node = audio.current;
    if (!node || !clip) return;
    if (node.paused) void node.play();
    else node.pause();
  }

  function download() {
    if (!clip) return;
    const link = document.createElement("a");
    link.href = clip.url;
    link.download = `reji-${voice.id}.mp3`;
    link.click();
  }

  const duration = clip?.duration || audio.current?.duration || 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-2xl">Ses</h2>
        <p className="mt-1 text-sm text-muted">
          Sesle siteyi kullanır ya da xAI Ses ile tek istek atar. {channel.name} için önerilen ses {suggested.name}.
        </p>
      </div>
      <div className="flex gap-2">
        <Chip active={mode === "sesle"} onClick={() => setMode("sesle")}>
          Sesle
        </Chip>
        <Chip active={mode === "xai"} onClick={() => setMode("xai")}>
          xAI Ses
        </Chip>
      </div>
      {mode === "sesle" ? <SeslePanel project={project} channel={channel} /> : null}
      <div className={mode === "xai" ? "flex flex-col gap-5" : "hidden"}>

      <div className="flex flex-wrap gap-2">
        <Button variant="line" onClick={() => setText(scriptOf(project))}>
          Senaryodan al
        </Button>
        <Button variant="line" onClick={() => setVoiceId(suggested.id)}>
          {suggested.name}
        </Button>
        {project.pack.beats.map((beat, index) => (
          <Chip key={`${beat.time}-${index}`} onClick={() => setText(beat.voice.slice(0, VOICE_LIMIT))}>
            {beat.title}
          </Chip>
        ))}
      </div>

      <label className="flex flex-col gap-2 text-sm text-muted">
        <span className="flex items-center justify-between">
          Metin
          <span className="nums text-faint">
            {text.length} / {VOICE_LIMIT.toLocaleString("tr")}
          </span>
        </span>
        <textarea
          ref={area}
          className={`${fieldClass} min-h-52 py-3`}
          lang={project.brief.language}
          maxLength={VOICE_LIMIT}
          value={text}
          placeholder="Okunacak metni yaz…"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void render();
            }
          }}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        {SPEECH_TAGS.map((tag) => (
          <Chip key={tag.id} onClick={() => wrap(tag.before, tag.after)}>
            {tag.label}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["hepsi", "Hepsi"],
            ["kadın", "Kadın"],
            ["erkek", "Erkek"],
          ] as const
        ).map(([id, label]) => (
          <Chip key={id} active={gender === id} onClick={() => setGender(id)}>
            {label}
          </Chip>
        ))}
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {shown.map((item) => (
          <li key={item.id}>
            <VoiceCard voice={item} selected={item.id === voiceId} onSelect={() => setVoiceId(item.id)} />
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3 rounded-xl bg-elevated p-4 ring-1 ring-line">
        <div className="flex items-center justify-between gap-3">
          <p className="nums text-sm text-faint">
            {speed.toFixed(2)} × · {voice.name}
          </p>
          <div className="flex gap-2">
            <Chip active={speed === 0.85} onClick={() => setSpeed(0.85)}>
              Yavaş
            </Chip>
            <Chip active={speed === 1} onClick={() => setSpeed(1)}>
              Normal
            </Chip>
            <Chip active={speed === 1.2} onClick={() => setSpeed(1.2)}>
              Hızlı
            </Chip>
          </div>
        </div>
        <input
          type="range"
          min={0.7}
          max={1.5}
          step={0.05}
          value={speed}
          aria-label="Tempo"
          onChange={(event) => setSpeed(Number(event.target.value))}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void render()} disabled={busy || text.trim().length < 2}>
            {busy ? "Seslendiriliyor" : stale ? "Seslendir" : "Yeniden seslendir"}
          </Button>
          <Button variant="line" onClick={toggle} disabled={!clip || busy}>
            {playing ? "Durdur" : "Oynat"}
          </Button>
          <Button variant="line" onClick={download} disabled={!clip}>
            MP3 indir
          </Button>
          <span className="nums text-sm text-faint">
            {clock(time)} / {clock(duration)}
          </span>
        </div>
        <audio
          ref={audio}
          src={clip?.url}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        />
        <p className="text-sm text-faint">
          {voice.name} · {voice.blurb}. Oynatırken kelimeler vurgulanır.
        </p>
      </div>

      {clip?.words.length ? (
        <p className="text-base leading-relaxed text-fg">
          {clip.words.map((word, index) => (
            <button
              key={`${word.start}-${index}`}
              type="button"
              className={`press mr-1 rounded px-0.5 ${index === activeWord ? "bg-paper text-ink" : ""}`}
              onClick={() => {
                if (audio.current) audio.current.currentTime = word.start;
              }}
            >
              {word.text}
            </button>
          ))}
        </p>
      ) : (
        <p className="text-sm text-faint">Metnini yaz, bir ses seç, seslendir.</p>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-lg">Geçmiş</h3>
        <p className="text-sm text-faint">Seslendirdiğin metinler burada durur. Sadece bu tarayıcıda saklanır.</p>
        {history.length === 0 ? (
          <p className="text-sm text-muted">Henüz yok.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((item) => {
              const named = voiceById(item.voiceId);
              return (
                <li key={item.id} className="flex items-start justify-between gap-3 rounded-xl bg-elevated p-3 ring-1 ring-line">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => {
                    setText(item.text);
                    setVoiceId(item.voiceId);
                    setSpeed(item.speed);
                  }}>
                    <span className="line-clamp-2 block text-sm text-fg">{item.text}</span>
                    <span className="nums mt-1 block text-sm text-faint">
                      {named.name} · {item.speed.toFixed(2)} ×
                    </span>
                  </button>
                  <button
                    type="button"
                    className="press h-11 shrink-0 rounded-lg px-3 text-sm text-muted ring-1 ring-line"
                    onClick={() => forget(item.id)}
                  >
                    Sil
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-lg">Sahne sesleri</h3>
        <p className="text-sm text-faint">Karevo her sahne için ayrı MP3 ister. Seçili ses ve hız kullanılır.</p>
        <ul className="flex flex-col gap-2">
          {project.pack.scenes.map((scene, index) => (
            <li key={scene.id} className="flex items-center justify-between gap-3 rounded-xl bg-elevated p-3 ring-1 ring-line">
              <div className="min-w-0">
                <p className="text-sm text-fg">
                  {String(index + 1).padStart(2, "0")} · {scene.title}
                </p>
                <p className="nums text-sm text-faint">
                  {scene.audioDuration ? `${scene.audioDuration.toFixed(1)} sn` : "ses yok"}
                </p>
              </div>
              <Button variant="line" disabled={Boolean(sceneBusy) || busy} onClick={() => void speakScene(index)}>
                {sceneBusy === scene.id ? "Yazılıyor" : "Ses üret"}
              </Button>
            </li>
          ))}
        </ul>
      </section>
      </div>
    </div>
  );
}

function sesleName(channel: Channel) {
  if (channel.id === "bilimcifikri" || channel.kind === "belgesel") return "Ultra Epic";
  if (channel.kind === "kitap" || /kitap|anatomi/i.test(channel.name)) return "Orion";
  return voiceForChannel(channel).name;
}

function SeslePanel({ project, channel }: { project: Project; channel: Channel }) {
  const { patchPack } = useStudio();
  const start = useServerFn(startSesleJob);
  const poll = useServerFn(pollSesleJob);
  const chunks = narrationChunks(narrationText(project.pack.beats));
  const [jobId, setJobId] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<{ index: number; status: string; detail: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const voice = sesleName(channel);
  const done = rows.filter((row) => row.status === "tamam").length;

  useEffect(() => {
    if (!jobId || !busy) return;
    const timer = window.setInterval(() => {
      void poll({ data: { jobId } }).then(async (res) => {
        if (!res.ok) return;
        setNote(res.job.note);
        setRows(res.job.chunks.map((chunk) => ({ index: chunk.index, status: chunk.status, detail: chunk.detail })));
        if (res.job.status === "bitti" || res.job.status === "hata") {
          setBusy(false);
          const scenes = [...project.pack.scenes];
          for (const chunk of res.job.chunks) {
            if (chunk.status !== "tamam" || !chunk.audioBase64) continue;
            const scene = scenes[chunk.index];
            if (!scene) continue;
            const duration = await clipDuration(chunk.audioBase64);
            await putSceneAudio(project.id, scene.id, chunk.audioBase64, duration || 1);
            scenes[chunk.index] = { ...scene, audioDuration: duration || 1 };
          }
          patchPack(project.id, { scenes });
          notify(res.job.status === "bitti" ? "Sesle bitti." : res.job.note);
        }
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [jobId, busy, patchPack, poll, project.id, project.pack.scenes]);

  async function run(only?: number) {
    if (!chunks.length) {
      notify("Anlatım metni yok.");
      return;
    }
    setBusy(true);
    setNote(only != null ? "Parça yeniden deneniyor." : "Sesle başlıyor.");
    try {
      const res = await start({
        data: { folder: exportFolderName(project.brief.title), voice, speed: 1, chunks, only },
      });
      if (!res.ok) {
        setBusy(false);
        notify(res.error);
        return;
      }
      setJobId(res.jobId);
    } catch {
      setBusy(false);
      notify("Sesle başlatılamadı.");
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-elevated p-4 ring-1 ring-line">
      <h3 className="text-lg">Sesle</h3>
      <p className="text-sm text-muted">
        {voice} · 1.00× · {chunks.length} parça, her biri en fazla 1.800 karakter. İlk girişte tarayıcı açılır, şifre
        saklanmaz.
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-subtle">
        <div className="h-full bg-paper" style={{ width: `${chunks.length ? Math.round((done / chunks.length) * 100) : 0}%` }} />
      </div>
      <p className="text-sm text-faint">{note || `${done}/${chunks.length || 0}`}</p>
      <ul className="flex flex-col gap-2">
        {chunks.map((text, index) => {
          const row = rows.find((item) => item.index === index);
          return (
            <li key={index} className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-sm text-fg">
                {String(index + 1).padStart(2, "0")} · {row?.status ?? "bekliyor"} · {text.slice(0, 48)}
              </span>
              {row?.status === "hata" ? (
                <Button variant="line" disabled={busy} onClick={() => void run(index)}>
                  Tekrar dene
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Button disabled={busy || chunks.length === 0} onClick={() => void run()}>
        {busy ? "Sesle çalışıyor" : "Sesle ile üret"}
      </Button>
    </section>
  );
}

function clipDuration(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
  return new Promise<number>((resolve) => {
    const audio = new Audio(url);
    const finish = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => finish(0);
  });
}

function VoiceCard({ voice, selected, onSelect }: { voice: Voice; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`press flex h-full w-full flex-col gap-1 rounded-xl p-3 text-left ring-1 ${
        selected ? "bg-paper text-ink ring-paper" : "bg-elevated text-fg ring-line"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-base">{voice.name}</span>
        <span className={`text-sm ${selected ? "text-ink" : "text-faint"}`}>{voice.gender}</span>
      </span>
      <span className={`text-sm ${selected ? "text-ink" : "text-muted"}`}>{voice.blurb}</span>
    </button>
  );
}
