export type StepName =
  | "baslik"
  | "kanca"
  | "senaryo"
  | "metin"
  | "sahneler"
  | "gorsel"
  | "video"
  | "kapak"
  | "kontrol";

const COMMON =
  "Sen {kanal} YouTube kanalının yapımcısısın. Tür: {konu_türü}, kitle: {kitle}, ton: {ton}, stil: {stil}. Türkçe yaz. Sadece istenen JSON'u ver.";

const STEPS: Record<StepName, string> = {
  baslik: `Konu {konu}, vaat {vaat}. 5 başlık, her biri en fazla 60 karakter, merak uyandırsın, tıklama tuzağı olmasın, sözünü tutsun; biri soru, biri sayı, biri şaşırtıcı gerçek. {"basliklar":[],"secilen":0,"neden":""}`,
  kanca: `Başlık {baslik}. İlk 15 sn için 3 kanca (35–45 kelime). İlk cümle şaşırtıcı gerçek ya da soru, başlığın sözünü hemen doğrulasın, "bu videoda" ile başlamasın. {"kancalar":[],"secilen":0}`,
  senaryo: `Başlık {baslik}, kanca {kanca}, kaynaklar {kaynaklar}, süre {dakika} dk (~140 kelime/dk). Giriş, {bolum_sayisi} bölüm, kapanış ve abone çağrısı. Sadece kaynaklardaki bilgileri kullan; emin olmadığın iddiayı yazma. Her 60–90 sn'de yeni bir merak sorusu aç. {"bolumler":[{"baslik":"","metin":""}]}`,
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
};

export function fillPrompt(template: string, vars: Record<string, string>) {
  return template.replace(
    /\{(kanal|konu_türü|kitle|ton|stil|konu|vaat|baslik|kanca|kaynaklar|dakika|bolum_sayisi|senaryo|parcalar|anlatim|gorsel_prompt|ses|hız|kapak_stili|oran|onceki)\}/g,
    (token, key: string) => (token ? (vars[key] ?? "") : ""),
  );
}

export function promptFor(step: StepName, vars: Record<string, string>) {
  return `${fillPrompt(COMMON, vars)}\n${fillPrompt(STEPS[step], vars)}`;
}

export function sectionCount(minutes: number) {
  const value = Number.isFinite(minutes) ? minutes : 8;
  return Math.max(3, Math.min(6, Math.round(value)));
}

export function readModelJson(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = fenced ? [fenced[1], text] : [text];
  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    const slices = start >= 0 ? [end > start ? candidate.slice(start, end + 1) : "", candidate.slice(start)] : [];
    for (const slice of slices) {
      if (!slice) continue;
      for (const attempt of [slice, repairJson(slice)]) {
        try {
          const value = JSON.parse(attempt) as unknown;
          if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
        } catch {
          /* sonraki deneme */
        }
      }
    }
  }
  return null;
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
};

export function acceptStep(
  step: StepName,
  raw: Record<string, unknown>,
  ctx: { konu?: string; anlatim?: string } = {},
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
  if (step === "senaryo") {
    const bolumler = (Array.isArray(raw.bolumler) ? raw.bolumler : [])
      .map((item) => {
        const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
        if (!row) return null;
        const baslik = clip(row.baslik, 80);
        const metin = clip(row.metin, 1800);
        if (!baslik || metin.length < 8) return null;
        return { baslik, metin };
      })
      .filter((item): item is { baslik: string; metin: string } => Boolean(item))
      .slice(0, 8);
    if (bolumler.length < 3) return null;
    let cursor = 0;
    const beats = bolumler.map((item) => {
      const time = stamp(cursor);
      cursor += Math.max(20, Math.round((item.metin.split(/\s+/).length / 140) * 60));
      return { time, title: item.baslik, voice: item.metin, screen: "Anlatı", visual: item.baslik };
    });
    return { bolumler, beats };
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
  const puan = Math.min(100, Math.max(0, Math.round(Number(raw.puan) || 0)));
  return {
    puan,
    sorunlar: strings(raw.sorunlar, 180, 6),
    duzeltmeler: strings(raw.duzeltmeler, 180, 3),
  };
}

function stamp(seconds: number) {
  const minute = Math.floor(seconds / 60);
  const second = seconds % 60;
  return `${minute}:${String(second).padStart(2, "0")}`;
}
