import type { FormatId } from "./types.ts";

export type ChannelKind = "belgesel" | "mitoloji" | "kitap" | "cocuk" | "ozel";

export type CoverPaint = {
  bg: string;
  panel: string;
  ink: string;
  scene: string;
  stroke: string;
};

export type Channel = {
  id: string;
  name: string;
  topic: string;
  audience: string;
  description?: string;
  palette: string;
  coverStyle: string;
  tone: string;
  minutes: number;
  format: FormatId;
  kind: ChannelKind;
  builtin: boolean;
  needsSources: boolean;
  visualStyle: string;
  face: string;
  cover: CoverPaint;
};

export const DEFAULT_CHANNELS: Channel[] = [
  {
    id: "bilimcifikri",
    name: "bilimcifikri",
    topic: "Bilim ve belgesel",
    audience: "meraklı yetişkin",
    description: "Bilim, uzay ve biyoloji. Meraklı yetişkin; cevabı herkesin bilmediği sorular.",
    palette: "teal ve turuncu, siyah zemin",
    coverStyle:
      "Solda kırmızı panel, üst yarıda en fazla beş kelime, kalın ve konturlu beyaz yazı. Sağda tek parlak sahne. Siyah tema. İki saniyede okunur. Başlığı tekrarlama.",
    tone: "bilimsel",
    minutes: 8,
    format: "belgesel",
    kind: "belgesel",
    builtin: true,
    needsSources: true,
    visualStyle:
      "Sinematik bilim belgeseli, siyah alan, teal ve turuncu vurgu, tek nesne, fotogerçek, karede yazı yok, üst yarıda konu",
    face: "Tek nesne kadrajı taşır. Yüz varsa bir tane. Rekonstrüksiyon sahnesi arşiv gibi görünmez.",
    cover: {
      bg: "#070708",
      panel: "#c4382d",
      ink: "#ffffff",
      scene: "#f3e2c4",
      stroke: "#140806",
    },
  },
  {
    id: "mitocolik",
    name: "mitocolik",
    topic: "Mitoloji",
    audience: "mitoloji meraklısı",
    description: "Mitoloji ve tarih. Destanı merak eden yetişkin.",
    palette: "sıcak vintage, toprak ve amber",
    coverStyle:
      "Sıcak vintage zemin. Üst yarıda en fazla beş kelime, kalın konturlu yazı. Tek figür. İki saniyede okunur. Başlığı tekrarlama.",
    tone: "sıcak",
    minutes: 8,
    format: "uzun",
    kind: "mitoloji",
    builtin: true,
    needsSources: false,
    visualStyle:
      "Vintage mitoloji resmi, sıcak toprak ve amber, tek figür, film gren, karede yazı yok, üst yarıda figür",
    face: "Tek figür, dönem kostümü. Kalabalık yok.",
    cover: {
      bg: "#1a120c",
      panel: "#8a4b2f",
      ink: "#f3e6d0",
      scene: "#c4a574",
      stroke: "#2a160c",
    },
  },
  {
    id: "kitap-anatomisi",
    name: "Bir Kitabın Anatomisi",
    topic: "Kitap incelemesi",
    audience: "kitap okuru",
    description: "Kitap ve fikir. Bir kitabın savını merak eden okur.",
    palette: "soluk kâğıt, yumuşak mürekkep",
    coverStyle:
      "Soluk kâğıt zemin. Üst yarıda en fazla beş kelime, kalın konturlu yazı. Tek kitap veya tek okur. İki saniyede okunur. Başlığı tekrarlama.",
    tone: "sakin",
    minutes: 9,
    format: "uzun",
    kind: "kitap",
    builtin: true,
    needsSources: false,
    visualStyle:
      "Yumuşak kitap incelemesi, soluk kâğıt ışığı, tek kitap veya tek el, sakin, karede yazı yok",
    face: "Tek kitap ya da tek okur. Kapak yazısı kitabın adı olmasın.",
    cover: {
      bg: "#f6f3ee",
      panel: "#e4ddd2",
      ink: "#2c2824",
      scene: "#d9cfc3",
      stroke: "#f6f3ee",
    },
  },
  {
    id: "papi-pupa",
    name: "Papi Pupa",
    topic: "Çocuk şarkılı klip",
    audience: "3–6 yaş ve ebeveyn",
    description: "Çocuklara uygun eğlenceli öğretici. Korku yok, 3–6 yaş ve ebeveyn.",
    palette: "minimal pastel",
    coverStyle:
      "Minimal pastel. Üst yarıda en fazla beş kelime, kalın konturlu yazı. Tek karakter, korku yok. İki saniyede okunur. Başlığı tekrarlama.",
    tone: "sıcak",
    minutes: 4,
    format: "cocuk",
    kind: "cocuk",
    builtin: true,
    needsSources: false,
    visualStyle:
      "Sevimli 3 boyutlu çocuk klibi, minimal pastel, tek karakter, yumuşak ışık, korku yok, alay yok, karede yazı yok, şarkı temposu",
    face: "Tek karakter, göz hizasında, ağız okunur, korku yok.",
    cover: {
      bg: "#f7f1ea",
      panel: "#f2c9c2",
      ink: "#2a2428",
      scene: "#d7e3d4",
      stroke: "#f7f1ea",
    },
  },
];

export const NEUTRAL_COVER: CoverPaint = {
  bg: "#141416",
  panel: "#2a2a30",
  ink: "#f3f2ef",
  scene: "#3a3a42",
  stroke: "#0c0c0d",
};

export function channelById(channels: Channel[], id: string) {
  return channels.find((c) => c.id === id) ?? channels[0] ?? DEFAULT_CHANNELS[0];
}

export function needsSources(channel: Channel) {
  return channel.needsSources || channel.kind === "belgesel" || channel.format === "belgesel";
}
