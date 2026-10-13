import type { Channel } from "./channels";

export type Voice = {
  id: string;
  apiId: string;
  name: string;
  gender: "kadın" | "erkek";
  blurb: string;
  featured?: boolean;
};

export const VOICES: Voice[] = [
  { id: "merak", apiId: "helios", name: "Merak", gender: "erkek", blurb: "Bilim anlatıcısı", featured: true },
  { id: "ultra-epic", apiId: "atlas", name: "Ultra Epic", gender: "erkek", blurb: "Destansı belgesel anlatıcı", featured: true },
  { id: "destan", apiId: "lumen", name: "Destan", gender: "erkek", blurb: "Mitoloji ve tarih anlatıcısı", featured: true },
  { id: "eve", apiId: "eve", name: "Eve", gender: "kadın", blurb: "Enerjik ve neşeli" },
  { id: "ara", apiId: "ara", name: "Ara", gender: "kadın", blurb: "Sıcak ve samimi" },
  { id: "luna", apiId: "luna", name: "Luna", gender: "kadın", blurb: "Yumuşak, eğitici" },
  { id: "carina", apiId: "carina", name: "Carina", gender: "kadın", blurb: "Empatik, sakin" },
  { id: "altair", apiId: "altair", name: "Altair", gender: "kadın", blurb: "Zarif anlatım" },
  { id: "celeste", apiId: "celeste", name: "Celeste", gender: "kadın", blurb: "Güven verici" },
  { id: "orion", apiId: "orion", name: "Orion", gender: "erkek", blurb: "Sinematik anlatıcı" },
  { id: "leo", apiId: "leo", name: "Leo", gender: "erkek", blurb: "Otoriter ve güçlü" },
  { id: "helix", apiId: "helix", name: "Helix", gender: "erkek", blurb: "Dinamik, podcast" },
  { id: "rex", apiId: "rex", name: "Rex", gender: "erkek", blurb: "Net ve duru" },
  { id: "lux", apiId: "lux", name: "Lux", gender: "erkek", blurb: "Topraklı, dingin" },
  { id: "sirius", apiId: "sirius", name: "Sirius", gender: "erkek", blurb: "Oyuncu, kıvrak" },
];

export const VOICE_LIMIT = 3000;

export const SPEECH_TAGS = [
  { id: "pause", label: "Duraklat", before: "[pause]", after: "" },
  { id: "whisper", label: "Fısıltı", before: "<whisper>", after: "</whisper>" },
  { id: "emphasis", label: "Vurgu", before: "<emphasis>", after: "</emphasis>" },
  { id: "slow", label: "Yavaş", before: "<slow>", after: "</slow>" },
  { id: "soft", label: "Yumuşak", before: "<soft>", after: "</soft>" },
] as const;

export function voiceById(id: string) {
  return VOICES.find((voice) => voice.id === id) ?? VOICES[0];
}

export function voiceForChannel(channel: Channel) {
  if (channel.kind === "cocuk" || channel.format === "cocuk") return voiceById("luna");
  if (channel.kind === "mitoloji") return voiceById("destan");
  if (channel.kind === "kitap") return voiceById("carina");
  if (channel.kind === "belgesel" || channel.format === "belgesel") return voiceById("ultra-epic");
  return voiceById("merak");
}
