export type FormatId = "uzun" | "shorts" | "belgesel" | "cocuk";
export type Lang = "tr" | "en";

export type Brief = {
  title: string;
  format: FormatId;
  audience: string;
  minutes: number;
  tone: string;
  promise: string;
  language: Lang;
  sources?: string;
};

export type TitleOption = { text: string; angle: string; why: string };

export type Hook = {
  window: string;
  line: string;
  visual: string;
  cut: string;
};

export type Beat = {
  time: string;
  title: string;
  voice: string;
  screen: string;
  visual: string;
};

export type ShotKind = "A-roll" | "B-roll" | "Grafik" | "Ses";

export type Shot = {
  n: string;
  kind: ShotKind;
  frame: string;
  do: string;
  sec: number;
  must: boolean;
};

export type Thumb = {
  words: string;
  face: string;
  layout: string;
  contrast: string;
  ban: string;
  imageUrl?: string;
};

export type Chapter = { time: string; title: string };

export type Seo = {
  description: string;
  chapters: Chapter[];
  tags: string[];
  pinned: string;
  end: string;
};

export type Check = { id: string; label: string; done: boolean };

export type Scene = {
  id: string;
  title: string;
  imagePrompt: string;
  videoPrompt: string;
  simulation: boolean;
  imageUrl?: string;
  videoUrl?: string;
  audioDuration?: number;
  route?: "xai" | "gemini" | "elle";
  spoken?: string;
  seconds?: number;
  mediaKind?: "video" | "gorsel";
};

export type Pack = {
  briefKey: string;
  source: "masa" | "grok";
  pick: number;
  titles: TitleOption[];
  hooks: Hook[];
  beats: Beat[];
  shots: Shot[];
  thumb: Thumb;
  seo: Seo;
  checks: Check[];
  scenes: Scene[];
};

export type Project = {
  id: string;
  channelId: string;
  seriesId?: string;
  createdAt: number;
  updatedAt: number;
  brief: Brief;
  pack: Pack;
};

export type Note = { tone: "ok" | "fix"; text: string };

export const FORMATS: { id: FormatId; label: string; hint: string }[] = [
  { id: "uzun", label: "Uzun", hint: "8–15 dk anlatı" },
  { id: "shorts", label: "Shorts", hint: "45 sn, tek iddia" },
  { id: "belgesel", label: "Belgesel", hint: "iddia ve kanıt ayrı" },
  { id: "cocuk", label: "Çocuk", hint: "3–4 dk, korku yok" },
];

export function formatLabel(id: FormatId) {
  return FORMATS.find((f) => f.id === id)?.label ?? id;
}
