import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Channel } from "@/lib/studio/channels";
import { speakScript } from "@/lib/studio/generate";
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
  const { keyFor } = useStudio();
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
          Sesle stüdyosu bu çekimin içinde. {channel.name} için önerilen ses {suggested.name}. Tek istek, en
          fazla {VOICE_LIMIT.toLocaleString("tr")} karakter.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="line" className="h-10" onClick={() => setText(scriptOf(project))}>
          Senaryodan al
        </Button>
        <Button variant="line" className="h-10" onClick={() => setVoiceId(suggested.id)}>
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
    </div>
  );
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
