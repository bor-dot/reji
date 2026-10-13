import type { Channel } from "./channels";

export type ProductionLook = {
  aspect: "16:9" | "9:16";
  videos: "all" | "first";
  image: string;
  video: string;
  seconds: number;
};

export function productionLook(channel: Channel): ProductionLook {
  const style = channel.visualStyle.trim();
  if (channel.format === "shorts") {
    return {
      aspect: "9:16",
      videos: "all",
      seconds: 6,
      image: `${style}. Dikey 9:16, hızlı kesme, tek vurgu, karede yazı yok.`,
      video: `${style}. Dikey 9:16, hızlı tek plan, 6 saniye, kesme yok.`,
    };
  }
  if (channel.kind === "mitoloji") {
    return {
      aspect: "16:9",
      videos: "all",
      seconds: 6,
      image: `${style}. Sıcak, vintage, destansı, karede yazı yok.`,
      video: `${style}. Destansı yavaş kamera, 6 saniye, sıcak vintage.`,
    };
  }
  if (channel.kind === "kitap") {
    return {
      aspect: "16:9",
      videos: "first",
      seconds: 6,
      image: `${style}. Soft, faded, sakin ışık, karede yazı yok.`,
      video: `${style}. Neredeyse sabit kamera, 6 saniye, soluk ton.`,
    };
  }
  if (channel.kind === "cocuk") {
    return {
      aspect: "16:9",
      videos: "all",
      seconds: 6,
      image: `${style}. Minimal pastel, sevimli 3D, korku yok, karede yazı yok.`,
      video: `${style}. Sevimli yavaş hareket, 6 saniye, pastel, korku yok.`,
    };
  }
  return {
    aspect: "16:9",
    videos: "all",
    seconds: 6,
    image: `${style}. Gerçekçi, sinematik, teal ve turuncu, karede yazı yok.`,
    video: `${style}. Sinematik 6 saniye, yavaş hareket, teal ve turuncu.`,
  };
}

export function voiceCast(channel: Channel) {
  if (channel.kind === "kitap" || channel.id === "kitap-anatomisi") return { sesle: "Orion", xai: "orion" };
  if (channel.kind === "mitoloji") return { sesle: "Destan", xai: "destan" };
  if (channel.kind === "cocuk" || channel.format === "cocuk") return { sesle: "Luna", xai: "luna" };
  if (channel.kind === "belgesel" || channel.format === "belgesel" || channel.id === "bilimcifikri") {
    return { sesle: "Ultra Epic", xai: "ultra-epic" };
  }
  return { sesle: "Ultra Epic", xai: "merak" };
}
