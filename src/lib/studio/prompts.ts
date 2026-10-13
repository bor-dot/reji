import { cleanSpeech } from "./speech-clean.ts";

export type StepName =
  | "baslik"
  | "kanca"
  | "senaryo"
  | "metin"
  | "sahneler"
  | "gorsel"
  | "video"
  | "kapak"
  | "kontrol"
  | "fikir"
  | "altsahne"
  | "yayin";

const COMMON =
  "Sen {kanal} YouTube kanalının yapımcısısın. Tür: {konu_türü}, kitle: {kitle}, ton: {ton}, stil: {stil}. Türkçe yaz. Sadece istenen JSON'u ver.";

const STEPS: Record<StepName, string> = {
  baslik: `Konu {konu}, vaat {vaat}. 5 başlık, her biri en fazla 60 karakter, merak uyandırsın, tıklama tuzağı olmasın, sözünü tutsun; biri soru, biri sayı, biri şaşırtıcı gerçek. {"basliklar":[],"secilen":0,"neden":""}`,
  kanca: `Başlık {baslik}. İlk 15 sn için 3 kanca (35–45 kelime). İlk cümle şaşırtıcı gerçek ya da soru, başlığın sözünü hemen doğrulasın, "bu videoda" ile başlamasın. {"kancalar":[],"secilen":0}`,
  senaryo: `Başlık {baslik}, kanca {kanca}, kaynaklar {kaynaklar}, süre {dakika} dk, hedef {kelime} kelime. Giriş, gelişme bölümleri ve kapanış. Her bölümün metin alanı yalnızca anlatıcının yüksek sesle okuyacağı cümleler olsun: parantez, köşeli parantez, sahne tarifi, zaman kodu ve yönerge yazma. Sadece kaynaklardaki bilgileri kullan. Her 60–90 sn'de yeni bir merak sorusu aç. Bölüm sayısını kelime hedefine göre ayarla, 10 ile sınırlama. {"bolumler":[{"baslik":"","metin":""}]}`,
  metin: `Senaryodan yalnızca anlatıcının yüksek sesle okuyacağı cümleleri çıkar. Parantez, köşeli parantez, sahne tarifi, ton/duraklama notu, başlık, zaman kodu yazma. Doğal konuşma dili, uzun cümleleri böl, sayıları okunacak biçimde yaz. En fazla 1.800 karakterlik parçalar, cümle ortasından bölme. Senaryo:\n{senaryo}\n{"parcalar":[]}`,
  sahneler: `Parçalar {parcalar}. Her 6–8 sn'lik anlatım için bir sahne; her sahne söylenen cümleye hizmet etsin. {"sahneler":[{"no":1,"anlatim":"","sure_sn":6,"tur":"video","ai_simulasyon":false}]}`,
  gorsel: `Video konusu: {konu}. Kanal: {kanal}, stil: {stil}.
Bu sahnede anlatıcının söylediği cümle: {anlatim}.
Önceki sahneler: {onceki}
Görevin: bu cümlenin anlattığı şeyi, videonun konusu bağlamında, tek bir net görüntüye çevirmek.
Kurallar:
- Cümledeki somut nesneyi, olayı veya kavramı çiz. Soyutsa onu en iyi anlatan somut bir benzetme veya bilimsel görselleştirme seç.
- Bölüm adlarını (Kanca, Giriş, Bölüm, Kapanış, Abone) ve kelimelerin mecaz olmayan ilk anlamını çizme; sahnenin anlamını çiz.
- Tek ana konu, sade arka plan, görselde yazı/logo/altyazı yok.
- Kanal stiline uy: renk tonu, ışık, kamera açısı. Oran {oran}.
- Önceki sahnelerle görsel süreklilik olsun (aynı karakter, mekân, renk paleti).
- İngilizce yaz; görsel en fazla 60 kelime.
- Bu adım bir görsel promptudur.
JSON: {"konu_ozeti":"bu sahnede ne gösteriliyor (Türkçe, 1 cümle)","prompt":"..."}`,
  video: `Video konusu: {konu}. Kanal: {kanal}, stil: {stil}.
Bu sahnede anlatıcının söylediği cümle: {anlatim}.
Görsel: {gorsel_prompt}
Önceki sahneler: {onceki}
Görevin: bu cümlenin anlattığı şeyi, videonun konusu bağlamında, tek bir net görüntüye çevirmek.
Kurallar:
- Cümledeki somut nesneyi, olayı veya kavramı çiz. Soyutsa onu en iyi anlatan somut bir benzetme veya bilimsel görselleştirme seç.
- Bölüm adlarını (Kanca, Giriş, Bölüm, Kapanış, Abone) ve kelimelerin mecaz olmayan ilk anlamını çizme; sahnenin anlamını çiz.
- Tek ana konu, sade arka plan, görselde yazı/logo/altyazı yok.
- Kanal stiline uy: renk tonu, ışık, kamera açısı.
- Önceki sahnelerle görsel süreklilik olsun (aynı karakter, mekân, renk paleti).
- İngilizce yaz; video en fazla 50 kelime. Videoda tek kamera hareketi, kesme yok.
- Bu adım 6 saniyelik bir video promptudur.
JSON: {"konu_ozeti":"bu sahnede ne gösteriliyor (Türkçe, 1 cümle)","prompt":"..."}`,
  kapak: `Başlık {baslik}. Kapak yazısı en fazla 5 kelime, başlığı tekrar etmesin, tek başına merak uyandırsın; tek ana karakter/nesne; stil {kapak_stili}. Yazı alanı boş görsel promptu (İngilizce). {"kapak_yazisi":"","gorsel_prompt":"","alternatifler":[]}`,
  kontrol: `Başlık en fazla 60 karakter mi, kapak yazısı en fazla 5 kelime ve başlığı tekrar etmiyor mu, kanca ilk 15 sn'de sözü veriyor mu, süre hedefe uyuyor mu, iddiaların kaynağı var mı, sahneler anlatıma uyuyor mu? 0–100 puan, en önemli 3 düzeltme. Başlık: {baslik}. Kanca: {kanca}. Süre: {dakika} dk. Kaynaklar: {kaynaklar}. Parçalar: {parcalar}. {"puan":0,"sorunlar":[],"duzeltmeler":[]}`,
  fikir: `Kanal: {kanal_adi}. Tür ve kitle: {kanal_aciklama}. Ton: {stil}.
Son çekilen konular (tekrar etme): {son_konular}.
Bu kanala uygun 5 YouTube video fikri üret. Kurallar:
- Yüksek merak + düşük netlik: insanların merak ettiği ama net cevabını bilmediği konular.
- Güncel/trend olanı öne al (son haftalardaki bilim, kitap, tarih vb. kanalın alanına göre).
- Her fikir tek cümlede soru veya şaşırtıcı iddia olarak anlaşılır olsun.
- Kanalın alanı dışına çıkma (bilimcifikri=bilim/uzay/biyoloji; mitocolik=mitoloji/tarih; Bir Kitabın Anatomisi=kitap/fikir; Papi Pupa=çocuklara uygun eğlenceli öğretici).
- Aynı konudan 3-4 videoluk seri çıkabilecekse belirt.
JSON: [{"baslik_onerisi":"","konu":"","neden_tutar":"1 cümle","kaynak_arama":"doğrulama için anahtar kelime","seri_olur_mu":true}]`,
  altsahne: `Video konusu: {konu}. Kanal: {kanal}, stil: {stil}.
Bu alt sahnenin anlatım cümlesi: {anlatim}.
Bir önceki sahne özeti: {onceki}
Görevin: bu cümlenin anlattığı şeyi tek bir net görüntüye çevirmek.
Kurallar:
- Cümledeki somut nesneyi, olayı veya kavramı çiz. Soyutsa bilimsel görselleştirme veya somut benzetme seç.
- Bölüm adlarını (Kanca, Giriş, Bölüm, Kapanış, Abone) çizme. Görselde yazı, logo, altyazı yok.
- Kanal stiline uy. Önceki sahneyle aynı palet ve mekân.
- image_prompt İngilizce, en fazla 60 kelime. video_prompt İngilizce, en fazla 50 kelime, tek kamera hareketi, kesme yok.
JSON: {"konu_ozeti":"Türkçe, ne gösteriliyor","image_prompt":"...","video_prompt":"..."}`,
  yayin: `Başlık {baslik}. Senaryo:
{senaryo}
YouTube açıklaması, 12 etiket ve sabit yorum üret. Açıklama gerçek senaryodan gelsin, uydurma iddia ekleme. Bölüm zamanlarını yazma, onları kod hesaplar.
JSON: {"aciklama":"","etiketler":[],"sabit_yorum":""}`,
};

export function fillPrompt(template: string, vars: Record<string, string>) {
  return template.replace(
    /\{(kanal|konu_türü|kitle|ton|stil|konu|vaat|baslik|kanca|kaynaklar|dakika|bolum_sayisi|senaryo|parcalar|anlatim|gorsel_prompt|ses|hız|kapak_stili|oran|onceki|kanal_adi|kanal_aciklama|son_konular|kelime)\}/g,
    (token, key: string) => (token ? (vars[key] ?? "") : ""),
  );
}

export function promptFor(step: StepName, vars: Record<string, string>) {
  return `${fillPrompt(COMMON, vars)}\n${fillPrompt(STEPS[step], vars)}`;
}

export function targetWords(minutes: number) {
  const value = Number.isFinite(minutes) ? minutes : 8;
  return Math.round(Math.min(30, Math.max(1, value)) * 145);
}

export function sectionCount(minutes: number) {
  const value = Number.isFinite(minutes) ? minutes : 8;
  return Math.max(4, Math.min(12, Math.round(value)));
}

function sliceJson(text: string, start: number) {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let quote = false;
  let escape = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === '"') quote = false;
      continue;
    }
    if (char === '"') quote = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return "";
}

export function readModelAny(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const sources = fenced ? [fenced[1], text] : [text];
  for (const source of sources) {
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char !== "{" && char !== "[") continue;
      const slice = sliceJson(source, index);
      if (!slice) continue;
      for (const attempt of [slice, repairJson(slice)]) {
        try {
          return JSON.parse(attempt) as unknown;
        } catch (error) {
          console.warn("JSON bloğu okunamadı.", error instanceof Error ? error.message : error);
        }
      }
    }
  }
  return null;
}

export function readModelJson(text: string): Record<string, unknown> | null {
  const value = readModelAny(text);
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function acceptProse(step: "senaryo" | "metin" | "kanca", text: string): StepResult | null {
  const body = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  if (step === "kanca") {
    const lines = text
      .split(/\n+/)
      .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
      .filter((line) => line.length >= 20);
    const hooks = (lines.length ? lines : body.split(/(?<=[.!?])\s+/)).filter((line) => line.length >= 20).slice(0, 3);
    if (!hooks.length) return null;
    return {
      kancalar: hooks,
      secilen: 0,
      hooks: hooks.map((line) => ({ window: "0:00-0:15", line, visual: "Tek açılış planı.", cut: "Söz bitince kes." })),
    };
  }
  if (step === "metin") {
    const cleaned = cleanSpeech(text);
    if (cleaned.blocked || cleaned.text.length < 12) return null;
    return { parcalar: cleaned.pieces.length ? cleaned.pieces : [cleaned.text] };
  }
  const chunks = text
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 30);
  let parts = chunks;
  if (parts.length < 3) {
    const sentences = body.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.length > 8);
    parts = [];
    let buf: string[] = [];
    for (const sentence of sentences) {
      buf.push(sentence);
      if (buf.join(" ").length > 280) {
        parts.push(buf.join(" "));
        buf = [];
      }
    }
    if (buf.length) parts.push(buf.join(" "));
  }
  const bolumler = parts
    .slice(0, 16)
    .map((metin, index) => {
      const first = metin.split("\n")[0] ?? "";
      const heading = metin.includes("\n") ? first.replace(/^#{1,3}\s*/, "").trim() : "";
      const baslik = heading.length >= 4 && heading.length <= 80 ? heading : `Bölüm ${index + 1}`;
      return { baslik: baslik.slice(0, 80), metin: cleanSpeech(metin).text };
    })
    .filter((item) => item.metin.length >= 8);
  if (!bolumler.length) return null;
  return readSections({ bolumler }, 1);
}

const TEXT_STEPS = new Set<StepName>(["senaryo", "metin", "kanca"]);

export function readStep(
  step: StepName,
  text: string,
  ctx: { konu?: string; anlatim?: string; benzer?: string } = {},
): StepResult | null {
  const any = readModelAny(text);
  if (step === "fikir") {
    const ideas = acceptIdeas(any);
    return ideas ? { ideas } : null;
  }
  const record = asRecord(any);
  if (record) {
    const accepted = acceptStep(step, record, ctx);
    if (accepted) return accepted;
  }
  if (!any && TEXT_STEPS.has(step)) return acceptProse(step as "senaryo" | "metin" | "kanca", text);
  return null;
}

export function stepRetryHint(
  step: StepName,
  text: string,
  ctx: { konu?: string; anlatim?: string; benzer?: string } = {},
) {
  const record = asRecord(readModelAny(text));
  if (record && (step === "gorsel" || step === "video")) return mediaPromptProblem(step, record, ctx) || "Sadece JSON döndür.";
  if (record && step === "altsahne") {
    return (
      mediaPromptProblem("gorsel", { prompt: record.image_prompt ?? record.prompt, konu_ozeti: record.konu_ozeti }, ctx) ||
      "Sadece JSON döndür."
    );
  }
  return "Sadece JSON döndür.";
}

function repairJson(slice: string) {
  let body = slice.replace(/,\s*"[^"\n]*"?\s*:?\s*"?(?:[^"\\]|\\.)*$/s, "");
  body = body.replace(/,\s*\{[^}]*$/s, "");
  body = body.replace(/,\s*$/s, "");
  const quotes = body.match(/(?<!\\)"/g)?.length ?? 0;
  if (quotes % 2 === 1) body += '"';
  const curly = (body.match(/\{/g)?.length ?? 0) - (body.match(/\}/g)?.length ?? 0);
  const square = (body.match(/\[/g)?.length ?? 0) - (body.match(/\]/g)?.length ?? 0);
  if (square > 0) body += "]".repeat(square);
  if (curly > 0) body += "}".repeat(curly);
  return body;
}

const BANNED_PROMPT = /\b(hook|kanca|fishing|intro|outro|chapter|subscribe)\b/i;
const STRUCTURE = new Set(["kanca", "giris", "giriş", "bolum", "bölüm", "kapanis", "kapanış", "abone", "hook", "intro", "outro", "chapter", "subscribe", "fishing"]);
const STOP = new Set(["için", "olan", "olarak", "gibi", "daha", "çok", "bir", "bu", "şu", "ile", "veya", "ama", "hem", "the", "and", "with", "from", "that", "this", "into", "over", "single", "scene", "video", "görsel", "gorsel"]);

function wordsOf(text: string) {
  return text
    .toLocaleLowerCase("tr")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOP.has(word));
}

function shares(left: string[], right: string[]) {
  return left.some((word) => right.some((item) => item.includes(word) || word.includes(item)));
}

export function mediaPromptProblem(
  kind: "gorsel" | "video",
  raw: Record<string, unknown>,
  ctx: { konu?: string; anlatim?: string } = {},
) {
  const prompt = clip(raw.prompt, 700);
  const ozet = clip(raw.konu_ozeti, 220);
  if (ozet.length < 8) return "konu_ozeti yok. Türkçe bir cümleyle sahnede ne gösterileceğini yaz.";
  if (prompt.split(/\s+/).filter(Boolean).length < 4) return "prompt çok kısa.";
  const limit = kind === "video" ? 50 : 60;
  if (prompt.split(/\s+/).filter(Boolean).length > limit) return `prompt ${limit} kelimeyi aşıyor. Kısalt.`;
  if (BANNED_PROMPT.test(prompt) || BANNED_PROMPT.test(ozet)) {
    return "prompt veya özet hook, kanca, fishing, intro, outro, chapter, subscribe içeriyor. Sahnenin anlamını çiz, bölüm adını değil.";
  }
  const summary = wordsOf(ozet).filter((word) => !STRUCTURE.has(word));
  const topic = wordsOf(ctx.konu ?? "");
  const line = wordsOf(ctx.anlatim ?? "");
  if (summary.length === 0) return "konu_ozeti yalnızca bölüm adı. Sahnenin anlamını yaz.";
  if ((topic.length || line.length) && !shares(summary, topic) && !shares(summary, line)) {
    return "konu_ozeti videonun konusuyla ve söylenen cümleyle ilgisiz. Cümlenin anlattığı şeyi yaz.";
  }
  return null;
}

function clip(value: unknown, max: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function strings(value: unknown, max: number, count: number) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => clip(item, max)).filter((item) => item.length > 0).slice(0, count);
}

export type StepResult = {
  basliklar?: string[];
  secilen?: number;
  neden?: string;
  titles?: { text: string; angle: string; why: string }[];
  kancalar?: string[];
  hooks?: { window: string; line: string; visual: string; cut: string }[];
  bolumler?: { baslik: string; metin: string }[];
  beats?: { time: string; title: string; voice: string; screen: string; visual: string }[];
  parcalar?: string[];
  sahneler?: { no: number; anlatim: string; sure_sn: number; tur: "video" | "gorsel"; ai_simulasyon: boolean }[];
  prompt?: string;
  konu_ozeti?: string;
  kapak_yazisi?: string;
  gorsel_prompt?: string;
  alternatifler?: string[];
  puan?: number;
  sorunlar?: string[];
  duzeltmeler?: string[];
  ideas?: Idea[];
  video_prompt?: string;
  aciklama?: string;
  etiketler?: string[];
  sabit_yorum?: string;
};

export type Idea = {
  baslik_onerisi: string;
  konu: string;
  neden_tutar: string;
  kaynak_arama: string;
  seri_olur_mu: boolean;
};

export function acceptIdeas(raw: unknown): Idea[] | null {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const list = Array.isArray(raw) ? raw : Array.isArray(row?.fikirler) ? row.fikirler : Array.isArray(row?.ideas) ? row.ideas : [];
  const ideas = list
    .map((item) => {
      const beat = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      if (!beat) return null;
      const konu = clip(beat.konu, 280);
      const baslik = clip(beat.baslik_onerisi, 80) || konu.slice(0, 80);
      if (konu.length < 8 || baslik.length < 4) return null;
      return {
        baslik_onerisi: baslik,
        konu,
        neden_tutar: clip(beat.neden_tutar, 180) || "Merakı yüksek, cevap net değil.",
        kaynak_arama: clip(beat.kaynak_arama, 120) || baslik,
        seri_olur_mu: beat.seri_olur_mu === true,
      };
    })
    .filter((item): item is Idea => Boolean(item))
    .slice(0, 5);
  return ideas.length >= 3 ? ideas : null;
}

export function acceptStep(
  step: StepName,
  raw: Record<string, unknown>,
  ctx: { konu?: string; anlatim?: string; benzer?: string } = {},
): StepResult | null {
  if (step === "baslik") {
    const basliklar = strings(raw.basliklar, 60, 5);
    if (basliklar.length < 3) return null;
    const secilen = Math.min(basliklar.length - 1, Math.max(0, Number(raw.secilen) || 0));
    const neden = clip(raw.neden, 280) || "Sözünü tutuyor.";
    return {
      basliklar,
      secilen,
      neden,
      titles: basliklar.map((text) => ({ text, angle: "başlık", why: neden })),
    };
  }
  if (step === "kanca") {
    const kancalar = strings(raw.kancalar, 500, 3);
    if (kancalar.length < 2) return null;
    const secilen = Math.min(kancalar.length - 1, Math.max(0, Number(raw.secilen) || 0));
    return {
      kancalar,
      secilen,
      hooks: kancalar.map((line) => ({ window: "0:00-0:15", line, visual: "Tek açılış planı.", cut: "Söz bitince kes." })),
    };
  }

  if (step === "senaryo") return readSections(raw, 3);
  if (step === "altsahne") {
    const image = clip(raw.image_prompt ?? raw.prompt, 700);
    const video = clip(raw.video_prompt, 500);
    const ozet = clip(raw.konu_ozeti, 220);
    const problem = mediaPromptProblem("gorsel", { prompt: image, konu_ozeti: ozet }, ctx);
    const videoProblem = mediaPromptProblem("video", { prompt: video, konu_ozeti: ozet }, ctx);
    if (problem || videoProblem || !ozet) return null;
    if (ctx.benzer && (promptsTooAlike(image, ctx.benzer) || promptsTooAlike(video, ctx.benzer))) return null;
    return { konu_ozeti: ozet, prompt: image, video_prompt: video, gorsel_prompt: image };
  }
  if (step === "yayin") {
    const aciklama = clip(raw.aciklama, 4000);
    const etiketler = strings(raw.etiketler, 32, 15);
    const sabit = clip(raw.sabit_yorum, 400);
    if (aciklama.length < 40 || etiketler.length < 3 || sabit.length < 8) return null;
    return { aciklama, etiketler, sabit_yorum: sabit };
  }
  if (step === "metin") {
    const parcalar = strings(raw.parcalar, 1800, 12);
    if (!parcalar.length) return null;
    return { parcalar };
  }
  if (step === "sahneler") {
    const sahneler = (Array.isArray(raw.sahneler) ? raw.sahneler : [])
      .map((item, index) => {
        const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
        if (!row) return null;
        const anlatim = clip(row.anlatim, 400);
        if (anlatim.length < 4) return null;
        const sure = Math.min(12, Math.max(4, Number(row.sure_sn) || 6));
        const tur = row.tur === "gorsel" ? "gorsel" : "video";
        return {
          no: index + 1,
          anlatim,
          sure_sn: sure,
          tur,
          ai_simulasyon: row.ai_simulasyon === true,
        };
      })
      .filter((item): item is { no: number; anlatim: string; sure_sn: number; tur: "video" | "gorsel"; ai_simulasyon: boolean } => Boolean(item))
      .slice(0, 24);
    if (!sahneler.length) return null;
    return { sahneler };
  }
  if (step === "gorsel" || step === "video") {
    if (mediaPromptProblem(step, raw, ctx)) return null;
    const prompt = clip(raw.prompt, 700);
    return { prompt, konu_ozeti: clip(raw.konu_ozeti, 220) };
  }
  if (step === "kapak") {
    const words = clip(raw.kapak_yazisi, 80).split(/\s+/).filter(Boolean).slice(0, 5);
    const gorsel = clip(raw.gorsel_prompt, 700);
    if (!words.length || gorsel.split(/\s+/).length < 4) return null;
    return { kapak_yazisi: words.join(" "), gorsel_prompt: gorsel, alternatifler: strings(raw.alternatifler, 80, 4) };
  }
  if (step === "fikir") {
    const ideas = acceptIdeas(raw);
    return ideas ? { ideas } : null;
  }
  const puan = Math.min(100, Math.max(0, Math.round(Number(raw.puan) || 0)));
  return {
    puan,
    sorunlar: strings(raw.sorunlar, 180, 6),
    duzeltmeler: strings(raw.duzeltmeler, 180, 3),
  };
}

export function promptsTooAlike(left: string, right: string) {
  const words = (value: string) =>
    new Set(
      value
        .toLocaleLowerCase("en")
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 3),
    );
  const a = words(left);
  const b = words(right);
  if (a.size < 4 || b.size < 4) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.max(a.size, b.size) > 0.72;
}

export function readSections(raw: Record<string, unknown>, min = 1) {
  const bolumler = (Array.isArray(raw.bolumler) ? raw.bolumler : [])
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      if (!row) return null;
      const baslik = clip(row.baslik, 120);
      const spoken = cleanSpeech(clip(row.metin, 8000)).text;
      if (!baslik || spoken.length < 8) return null;
      return { baslik, metin: spoken };
    })
    .filter((item): item is { baslik: string; metin: string } => Boolean(item))
    .slice(0, 16);
  if (bolumler.length < min) return null;
  let cursor = 0;
  const beats = bolumler.map((item) => {
    const time = stamp(cursor);
    cursor += Math.max(20, Math.round((item.metin.split(/\s+/).length / 145) * 60));
    return { time, title: item.baslik, voice: item.metin, screen: "", visual: item.baslik, draft: false };
  });
  return { bolumler, beats };
}
function stamp(seconds: number) {
  const minute = Math.floor(seconds / 60);
  const second = seconds % 60;
  return `${minute}:${String(second).padStart(2, "0")}`;
}
