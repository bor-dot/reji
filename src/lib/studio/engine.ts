import type { Channel } from "./channels";
import { DEFAULT_CHANNELS } from "./channels";
import type {
  Beat,
  Brief,
  Check,
  FormatId,
  Hook,
  Note,
  Pack,
  Project,
  Seo,
  Shot,
  ShotKind,
  Scene,
  Thumb,
  TitleOption,
} from "./types";
import { formatLabel } from "./types";

const SEED_AT = 1_760_220_000_000;

function clean(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function clip(s: string, n: number) {
  const t = clean(s);
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 18 ? cut.slice(0, sp) : cut).trim()}…`;
}

export function briefKey(b: Brief) {
  return JSON.stringify([
    b.title,
    b.format,
    b.audience,
    b.minutes,
    b.tone,
    b.promise,
    b.language,
    b.sources ?? "",
  ]);
}

function tr(b: Brief) {
  return b.language !== "en";
}

function clock(totalSec: number) {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function durationSec(b: Brief) {
  if (b.format === "shorts") return 45;
  return Math.min(20 * 60, Math.max(60, Math.round(b.minutes * 60)));
}

const STOP = new Set([
  "ve",
  "bir",
  "için",
  "ile",
  "da",
  "de",
  "mi",
  "mı",
  "mu",
  "mü",
  "bu",
  "şu",
  "the",
  "and",
  "for",
  "with",
  "from",
]);

export function coverWords(title: string, promise: string) {
  const titleSet = new Set(
    clean(title)
      .toLocaleLowerCase("tr")
      .split(" ")
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter(Boolean),
  );
  const fromPromise = clean(promise)
    .split(" ")
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => {
      const key = w.toLocaleLowerCase("tr");
      return w.length > 2 && !STOP.has(key) && !titleSet.has(key);
    });
  const picked = (fromPromise.length ? fromPromise : thumbWords(title).split(" ")).slice(0, 5);
  return picked.join(" ");
}

export function thumbWords(title: string) {
  const parts = clean(title).split(" ");
  const kept = parts.filter((w) => {
    const bare = w.replace(/[^\p{L}\p{N}]/gu, "");
    return bare.length > 1 && !STOP.has(bare.toLocaleLowerCase("tr"));
  });
  const src = kept.length ? kept : parts;
  return src.slice(0, 3).join(" ");
}

function titlesFor(b: Brief): TitleOption[] {
  const title = clean(b.title);
  const promise = clean(b.promise);
  const who = clean(b.audience);
  const turkish = tr(b);
  const search: TitleOption = {
    text: clip(title, b.format === "shorts" ? 42 : 70),
    angle: turkish ? "arama" : "search",
    why: turkish
      ? "İnsanlar konunun adını yazar. Başlık o cümleyle başlasın."
      : "People type the subject. Lead with that phrase.",
  };
  const vow: TitleOption = {
    text: clip(`${title}: ${promise}`, 70),
    angle: turkish ? "vaat" : "promise",
    why: turkish
      ? "Tıklama ile içerik aynı cümlede. Ödenmeyen merak yok."
      : "The click and the film share one sentence. No unpaid curiosity.",
  };
  const whoLine: TitleOption = {
    text: clip(turkish ? `${who} için ${title}` : `${title} for ${who}`, 70),
    angle: turkish ? "kime" : "who",
    why: turkish
      ? "Mobilde kime olduğu görünür. Yanlış kitle tıklamaz."
      : "The audience is visible on a phone. The wrong crowd scrolls past.",
  };
  const gap: TitleOption = {
    text: clip(
      turkish ? `${title} — eksik kalan kısım` : `${title} — the missing part`,
      70,
    ),
    angle: turkish ? "eksik" : "gap",
    why: turkish
      ? "Merak var, yalan yok. Video o eksiği kapatmak zorunda."
      : "Curiosity without a lie. The film has to close that gap.",
  };
  const timed: TitleOption =
    b.format === "shorts"
      ? {
          text: clip(turkish ? `Tekrar: ${title}` : `Again: ${title}`, 42),
          angle: turkish ? "döngü" : "loop",
          why: turkish
            ? "Shorts'ta ikinci izlenme, başa dönüşle başlar."
            : "A second watch starts when the clip loops cleanly.",
        }
      : {
          text: clip(
            turkish
              ? `${b.minutes} dakikada ${title}`
              : `${title} in ${b.minutes} minutes`,
            70,
          ),
          angle: turkish ? "süre" : "time",
          why: turkish
            ? "Süre sözü beklentiyi sabitler. Sözünü tut."
            : "A runtime promise sets the expectation. Keep it.",
        };
  return [search, vow, whoLine, gap, timed];
}

function hooksFor(b: Brief): Hook[] {
  const title = clean(b.title);
  const promise = clean(b.promise);
  const turkish = tr(b);
  const direct: Hook = {
    window: "0:00–0:08",
    line: turkish
      ? `${title}. ${clip(promise, 110)}`
      : `${title}. ${clip(promise, 110)}`,
    visual: turkish
      ? "Kapakla aynı duygu. Yazı yok. Yüz ya da nesne kadrajı doldurur."
      : "Same feeling as the thumbnail. No type. Face or object fills the frame.",
    cut: turkish
      ? "Sekizinci saniyede ilk durağa sert kes."
      : "Hard cut into the first beat on second eight.",
  };
  const contrast: Hook = {
    window: "0:00–0:08",
    line: turkish
      ? `Çoğu anlatı ${title} diye başlar ve vaadi geciktirir. Vaadin bu: ${clip(promise, 90)}`
      : `Most pieces named ${title} delay the promise. Here it is: ${clip(promise, 90)}`,
    visual: turkish
      ? "İlk kare durgun. İkinci kare, vaadi taşıyan tek nesne."
      : "First frame still. Second frame, one object that holds the promise.",
    cut: turkish
      ? "Vaadin bittiği karede kes. Nefes payı bırakma."
      : "Cut the moment the promise lands. No breath hold.",
  };
  const who = clean(b.audience);
  const address: Hook = {
    window: "0:00–0:08",
    line: turkish
      ? `${who} için söylüyorum. ${clip(promise, 100)}`
      : `This is for ${who}. ${clip(promise, 100)}`,
    visual: turkish
      ? "Kameraya bakış, tek kişi. Kalabalık yok."
      : "Look into the lens. One person. No crowd.",
    cut: turkish
      ? "İsim söylenince kesme. Cümle bitince kes."
      : "Don't cut on the name. Cut when the sentence ends.",
  };
  return [direct, contrast, address];
}

type Plan = {
  ratio: number;
  title: string;
  voice: string;
  screen: string;
  visual: string;
};

function plans(b: Brief): Plan[] {
  const title = clean(b.title);
  const promise = clean(b.promise);
  const who = clean(b.audience);
  const tone = clean(b.tone);
  const turkish = tr(b);

  if (b.format === "cocuk") {
    const line = thumbWords(title);
    const together = turkish ? `${line}, yanımızda` : `${line}, we stay`;
    return [
      {
        ratio: 0,
        title: turkish ? "Merhaba" : "Hello",
        voice: turkish
          ? `Merhaba. Benimle gel. Bugün ${title}. Yavaş bakacağız. Acele yok.`
          : `Hello. Come with me. Today is ${title}. We'll look slowly. No rush.`,
        screen: title,
        visual: turkish
          ? "Karakter göz hizasında, gülümser, korku yok."
          : "Character at eye level, a smile, no fear.",
      },
      {
        ratio: 0.1,
        title: turkish ? "Söz" : "Promise",
        voice: turkish
          ? `${promise} Bunu birlikte yapacağız. İstersen sen de söyle.`
          : `${promise} We'll do this together. You can say it too, if you want.`,
        screen: turkish ? "Bugün" : "Today",
        visual: turkish
          ? "Sözün nesnesi ekrana girer. Yavaş."
          : "The object of the promise enters. Slow.",
      },
      {
        ratio: 0.24,
        title: turkish ? "Eksik" : "Missing",
        voice: turkish
          ? `Bir şey eksik. Küçük kahramanımız onu arıyor. Önce yaprağın altına bakıyor. Yok. Sonra taşın yanına bakıyor. Yine yok. Üzülüyor ama bağırmaz. Bir nefes alır.`
          : `Something is missing. Our small hero looks for it. First under a leaf. Not there. Then beside a stone. Not there either. They feel sad, and they do not shout. They take one breath.`,
        screen: turkish ? "Nerede?" : "Where?",
        visual: turkish
          ? "Arama sahnesi, geniş ve aydınlık. Gölge yok."
          : "A search, wide and bright. No shadow play.",
      },
      {
        ratio: 0.42,
        title: turkish ? "Bir daha" : "Once more",
        voice: turkish
          ? `İlk deneme olmadı. Sorun değil. Bir kez daha, yavaş. Adım adım. Önce bak. Sonra çağır. Sonra bekle. Beklemek de bir iştir.`
          : `The first try missed. That's all right. Once more, slowly. Step by step. First look. Then call. Then wait. Waiting is part of the work.`,
        screen: turkish ? "Yavaş" : "Slow",
        visual: turkish
          ? "Aynı hareket, ikinci kez, daha yumuşak."
          : "The same gesture, a second time, softer.",
      },
      {
        ratio: 0.6,
        title: turkish ? "Yanında" : "Beside",
        voice: turkish
          ? `Yanında biri var. Yalnız değil. ${clip(promise, 90)} Birlikte bakınca eksik olan görünür. Kimse kimseyi çekiştirmez.`
          : `Someone is beside them. They are not alone. ${clip(promise, 90)} What was missing shows up when they look together. Nobody pulls anybody along.`,
        screen: line,
        visual: turkish
          ? "İki karakter aynı karede, eşit boy."
          : "Two characters in one frame, equal size.",
      },
      {
        ratio: 0.78,
        title: turkish ? "Birlikte" : "Together",
        voice: turkish
          ? `Şimdi birlikte söyle. ${together}. Bir daha. ${together}. Yüksek değil. Yan yana.`
          : `Say it with me. ${together}. Once more. ${together}. Not loud. Side by side.`,
        screen: together,
        visual: turkish
          ? "Yazı büyük. Ebeveyn söylesin diye, çocuk okusun diye değil."
          : "Large type, for the parent to say, not for the child to read.",
      },
      {
        ratio: 0.92,
        title: turkish ? "El salla" : "Wave",
        voice: turkish
          ? `Bugünlük bu kadar. ${together}. Yarın yine buradayız. El salla. Biz de sallayalım.`
          : `That's enough for today. ${together}. We'll be here tomorrow. Wave. We'll wave too.`,
        screen: turkish ? "Yarın" : "Tomorrow",
        visual: turkish
          ? "El sallama, sabit kamera, sıcak ışık."
          : "A wave, locked camera, warm light.",
      },
    ];
  }

  if (b.format === "shorts") {
    return [
      {
        ratio: 0,
        title: turkish ? "Kes" : "Cut in",
        voice: turkish ? `${who} bunu kaçırıyor.` : `${who} keep missing this.`,
        screen: thumbWords(title),
        visual: turkish
          ? "Desen bozan ilk kare. Yüz yakın, hareket var."
          : "A pattern interrupt. Face close, already moving.",
      },
      {
        ratio: 0.08,
        title: turkish ? "İddia" : "Claim",
        voice: `${title}. ${clip(promise, 100)}`,
        screen: thumbWords(title),
        visual: turkish
          ? "İddia söylenirken tek grafik, üç kelime."
          : "One graphic while the claim lands. Three words.",
      },
      {
        ratio: 0.3,
        title: turkish ? "Tek kanıt" : "One proof",
        voice: turkish
          ? `Tek örnek yeter. ${clip(promise, 90)}`
          : `One example is enough. ${clip(promise, 90)}`,
        screen: turkish ? "Örnek" : "Example",
        visual: turkish
          ? "Örneği gösteren eller veya ekran. İkinci örnek yok."
          : "Hands or a screen showing the example. No second example.",
      },
      {
        ratio: 0.62,
        title: turkish ? "Dönüş" : "Turn",
        voice: turkish
          ? `Sandığın yer burası değil. ${clip(promise, 80)}`
          : `This is not the place you expected. ${clip(promise, 80)}`,
        screen: turkish ? "Dönüş" : "Turn",
        visual: turkish
          ? "Aynı nesne, yeni kadraj. Keskin."
          : "Same object, new frame. Sharp.",
      },
      {
        ratio: 0.86,
        title: turkish ? "Başa dön" : "Loop",
        voice: turkish
          ? `Bir daha dinle. ${clip(promise, 70)}`
          : `Listen again. ${clip(promise, 70)}`,
        screen: thumbWords(title),
        visual: turkish
          ? "İlk kareye dön. Döngü görünmez olsun."
          : "Return to frame one. The loop should be invisible.",
      },
    ];
  }

  if (b.format === "belgesel") {
    return [
      {
        ratio: 0,
        title: turkish ? "İddia" : "Claim",
        voice: `${title}. ${promise}`,
        screen: title,
        visual: turkish
          ? "Tek plan. Hareket yok. Kapakla aynı duygu."
          : "One shot. No move. Same feeling as the thumbnail.",
      },
      {
        ratio: 0.08,
        title: turkish ? "Bedel" : "Stakes",
        voice: turkish
          ? `Bunu ${who} için, ${tone} anlatıyorum. Doğruysa hesabımız değişir. Yanlışsa, yanlışın nerede başladığını göstermem gerekir.`
          : `I'm telling this for ${who}, in a ${tone} voice. If it's true, the account changes. If not, I have to show where the mistake starts.`,
        screen: turkish ? "Ne değişir" : "What changes",
        visual: turkish
          ? "Konunun ölçeğini veren geniş plan."
          : "A wide shot that gives the scale of the subject.",
      },
      {
        ratio: 0.18,
        title: turkish ? "Harita" : "Map",
        voice: turkish
          ? `Üç durak. Gözlem. Açıklayamadığı yer. Henüz ölçmediğimiz şey.`
          : `Three stops. The observation. What it fails to explain. What we still haven't measured.`,
        screen: turkish ? "Üç durak" : "Three stops",
        visual: turkish
          ? "Sade bir harita ya da üç kelimelik grafik."
          : "A plain map, or a graphic of three words.",
      },
      {
        ratio: 0.34,
        title: turkish ? "Gözlem" : "Observation",
        voice: turkish
          ? `İlk iz bu kadar sade. ${clip(promise, 110)} Bunu bir his olarak değil, gördüğümüz bir şey olarak bırakıyorum.`
          : `The first trace is this plain. ${clip(promise, 110)} I'm leaving it as something we can see, not as a feeling.`,
        screen: turkish ? "Gözlem" : "Observation",
        visual: turkish
          ? "Belge, kayıt veya makro. Yüz yerine kanıt."
          : "A document, a recording, or a macro. Evidence, not a face.",
      },
      {
        ratio: 0.52,
        title: turkish ? "İkinci yol" : "Second path",
        voice: turkish
          ? `Aynı sonuca ikinci bir yoldan da varılıyor. İkinci yolu adlandır: deney, tanık ya da kayıt.`
          : `A second path reaches the same place. Name it: an experiment, a witness, or a record.`,
        screen: turkish ? "İkinci yol" : "Second path",
        visual: turkish
          ? "Birinci kanıttan farklı bir doku. Aynı müzik değil."
          : "A different texture from the first proof. Not the same music.",
      },
      {
        ratio: 0.7,
        title: turkish ? "Dönüş" : "Turn",
        voice: turkish
          ? `Burada anlatı döner. ${title} sandığımız açıklama, elimizdeki veriye yetmiyor.`
          : `The story turns here. The explanation we expected for ${title} does not cover the data we have.`,
        screen: turkish ? "Yetmiyor" : "Not enough",
        visual: turkish
          ? "Sessiz bir kare. Müzik iner."
          : "A quiet frame. Music drops.",
      },
      {
        ratio: 0.84,
        title: turkish ? "Bilmediğimiz" : "Unknown",
        voice: turkish
          ? `Bilmediğimizi de söyleyeceğim. ${title} hakkında kesin olanla tahmin olan aynı cümlede durmasın.`
          : `I'll say what we don't know. What is certain about ${title} should not share a sentence with a guess.`,
        screen: turkish ? "Açık" : "Open",
        visual: turkish
          ? "Ölçülmemiş bölge: boş harita, sis değil, beyaz alan."
          : "The unmeasured region: an empty map. White space, not fog.",
      },
      {
        ratio: 0.94,
        title: turkish ? "Kapanış" : "Close",
        voice: turkish
          ? `Başa dönüyorum. ${promise} Kaynaklar açıklamada.`
          : `Back to the start. ${promise} Sources are in the description.`,
        screen: title,
        visual: turkish
          ? "Açılış karesi, bu kez altyazısız."
          : "The opening frame, this time without type.",
      },
    ];
  }

  return [
    {
      ratio: 0,
      title: turkish ? "Kanca" : "Hook",
      voice: turkish
        ? `${who} için net olayım. ${title}.`
        : `Let me be plain for ${who}. ${title}.`,
      screen: thumbWords(title),
      visual: turkish
        ? "Konuşmacı ya da konu, orta plan, sabit."
        : "Speaker or subject, medium, locked.",
    },
    {
      ratio: 0.08,
      title: turkish ? "Vaat" : "Promise",
      voice: turkish
        ? `${promise} Bunu bu videoda bitiriyoruz.`
        : `${promise} We finish that in this video.`,
      screen: turkish ? "Bu videoda" : "In this video",
      visual: turkish
        ? "Vaadin nesnesi masaya konur."
        : "The object of the promise is set on the table.",
    },
    {
      ratio: 0.2,
      title: turkish ? "Sonuç" : "Outcome",
      voice: turkish
        ? `Birinci durak. Terim değil, sonuç. ${title} denince elde kalması gereken ilk şey.`
        : `First stop. Not a term, an outcome. The one thing that should remain from ${title}.`,
      screen: turkish ? "1 · Sonuç" : "1 · Outcome",
      visual: turkish
        ? "Tek cümlelik ekran yazısı, sonra örnek."
        : "One line of type, then the example.",
    },
    {
      ratio: 0.4,
      title: turkish ? "Adımlar" : "Steps",
      voice: turkish
        ? `İkinci durak. Nasıl yapılır. Adım adım, ara yok. Ton ${tone} kalsın.`
        : `Second stop. How to do it. Step by step, no detour. Keep the ${tone} tone.`,
      screen: turkish ? "2 · Adım" : "2 · Steps",
      visual: turkish
        ? "Eller, ekran veya tahta. Her adım yeni kare."
        : "Hands, a screen, or a board. A new frame per step.",
    },
    {
      ratio: 0.62,
      title: turkish ? "Örnek" : "Example",
      voice: turkish
        ? `Üçüncü durak. Gerçek bir örnek. ${clip(promise, 100)} Örnek süs olmasın.`
        : `Third stop. A real example. ${clip(promise, 100)} Don't decorate it.`,
      screen: turkish ? "3 · Örnek" : "3 · Example",
      visual: turkish
        ? "Örnek baştan sona, kesilmeden bir kez."
        : "The example once, start to finish, uncut.",
    },
    {
      ratio: 0.8,
      title: turkish ? "Hata" : "Mistake",
      voice: turkish
        ? `En sık hata: vaadi geç söylemek ve örneği genel bırakmak. ${title} için bunu yapma.`
        : `The usual mistake: saying the promise late, and leaving the example generic. Don't do that with ${title}.`,
      screen: turkish ? "Hata" : "Mistake",
      visual: turkish
        ? "Yanlış örnek, kısa. Doğru örnek hemen ardından."
        : "The wrong example, brief. The right one right after.",
    },
    {
      ratio: 0.92,
      title: turkish ? "Yön" : "Next",
      voice: turkish
        ? `Bir sonraki videoda bunun uygulanmış hali var. Kendi örneğini yorumda bırak.`
        : `The next video is this, applied. Leave your own example in the comments.`,
      screen: turkish ? "Sıradaki" : "Next",
      visual: turkish
        ? "Son 20 saniye tek kart. İkinci çağrı yok."
        : "One card in the last 20 seconds. No second ask.",
    },
  ];
}

function beatsFor(b: Brief): Beat[] {
  const total = durationSec(b);
  return plans(b).map((p) => ({
    time: clock(total * p.ratio),
    title: p.title,
    voice: p.voice,
    screen: p.screen,
    visual: p.visual,
  }));
}

function shotsFor(b: Brief, beats: Beat[]): Shot[] {
  const total = durationSec(b);
  const vo: ShotKind = b.format === "cocuk" ? "Ses" : "A-roll";
  const cut: ShotKind = b.format === "shorts" ? "Grafik" : "B-roll";
  const each = Math.max(2, Math.round(total / Math.max(1, beats.length * 2)));
  const frame =
    b.format === "shorts"
      ? tr(b)
        ? "Yakın"
        : "Close"
      : tr(b)
        ? "Orta, sabit"
        : "Medium, locked";
  return beats.flatMap((beat, i) => [
    {
      n: String(i * 2 + 1).padStart(2, "0"),
      kind: vo,
      frame,
      do: beat.title,
      sec: each,
      must: i === 0 || i === beats.length - 1,
    },
    {
      n: String(i * 2 + 2).padStart(2, "0"),
      kind: cut,
      frame: tr(b) ? "Detay" : "Detail",
      do: beat.visual,
      sec: each,
      must: i === 0,
    },
  ]);
}

function thumbFor(b: Brief, channel: Channel): Thumb {
  const turkish = tr(b);
  const words = coverWords(b.title, b.promise);
  return {
    words,
    face: channel.face,
    layout: channel.coverStyle,
    contrast: turkish
      ? `Palet: ${channel.palette}. Yazı kalın ve konturlu. Önemli öğe üst yarıda. Tek ana karakter.`
      : `Palette: ${channel.palette}. Bold outlined type. Subject in the upper half. One main character.`,
    ban: turkish
      ? "Başlığın tekrarı, beş kelimeden fazlası, ikinci karakter, küçük yazı, ok, daire."
      : "Repeating the title, more than five words, a second character, small type, arrows, circles.",
  };
}

export function scenesFor(b: Brief, channel: Channel, beats: Beat[], previous?: Scene[]): Scene[] {
  return beats.map((beat, index) => {
    const reconstruction =
      channel.kind === "belgesel" ? index > 0 && index < beats.length - 1 : channel.kind === "mitoloji";
    const label = reconstruction ? " Yapay zekâ simülasyonu, arşiv görüntüsü değil." : "";
    const visual = beat.visual.replace(/\.+$/, "");
    const imagePrompt = `${channel.visualStyle}. Sahne: ${beat.title}. ${visual}. Tek ana öğe, üst yarıda, karede yazı yok.${label}`;
    const videoPrompt = `${imagePrompt} Tek plan, 6 saniye, yavaş ve okunur hareket, kesme yok.`;
    const prev = previous?.find((scene) => scene.title === beat.title);
    return {
      id: prev?.id ?? `sahne-${index + 1}`,
      title: beat.title,
      imagePrompt,
      videoPrompt,
      simulation: reconstruction,
      imageUrl: prev?.imageUrl,
      videoUrl: prev?.videoUrl,
    };
  });
}

export function seriesBriefs(b: Brief, channel: Channel): Brief[] {
  const rows =
    channel.kind === "cocuk"
      ? [
          ["Yeni şarkı", "Aynı karakter, yeni bir duygu, dört dakikalık tekrarlı nakarat. Korku yok."],
          ["Birlikte söyle", "Nakaratı ebeveynle birlikte söyleten sahne. Alay yok."],
          ["Yarın", "Aynı dünya, ertesi gün, yavaş ve aydınlık."],
        ]
      : [
          ["Derinleş", `${b.promise} Bu bölüm tek bir ölçülebilir ayrıntıda kalır.`],
          ["Karşı cümle", `${b.title} hakkında sık tekrarlanan ve tutmayan cümle.`],
          ["Nasıl bakılır", `${b.title} için izleyicinin uygulayacağı üç adım.`],
          ["Açık uç", `${b.title} hakkında hâlâ ölçmediğimiz şey.`],
        ];
  return rows.map(([angle, promise]) => ({
    ...b,
    title: clip(`${b.title}: ${angle}`, 110),
    promise,
  }));
}

function tagsFor(b: Brief) {
  const raw = [
    b.title,
    formatLabel(b.format),
    b.tone,
    ...b.title.split(/\s+/),
    ...b.audience.split(/\s+/),
  ];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of raw) {
    const t = clean(item).replace(/^#+/, "");
    if (t.length < 3 || t.length > 28) continue;
    const key = t.toLocaleLowerCase("tr");
    if (seen.has(key) || STOP.has(key)) continue;
    seen.add(key);
    tags.push(t);
    if (tags.length === 12) break;
  }
  return tags;
}

function seoFor(b: Brief, hooks: Hook[], beats: Beat[]): Seo {
  const turkish = tr(b);
  const chapters = beats.map((beat) => ({ time: beat.time, title: beat.title }));
  if (chapters[0] && chapters[0].time !== "0:00") chapters[0].time = "0:00";
  const description = [
    hooks[0]?.line ?? clean(b.promise),
    "",
    clean(b.promise),
    "",
    turkish
      ? `Kime: ${clean(b.audience)}. Ton: ${clean(b.tone)}.`
      : `For: ${clean(b.audience)}. Tone: ${clean(b.tone)}.`,
    "",
    ...chapters.map((c) => `${c.time} ${c.title}`),
    "",
    turkish
      ? "Eksik ya da hatalı bir ayrıntı görürsen yorumda yaz. Açıklamayı güncellerim."
      : "If a detail is missing or wrong, say so in the comments. I'll update the description.",
  ].join("\n");
  return {
    description,
    chapters,
    tags: tagsFor(b),
    pinned: turkish
      ? `${clip(b.promise, 140)} Sence en zayıf halka nerede?`
      : `${clip(b.promise, 140)} Where is the weakest link?`,
    end: turkish
      ? "Son 20 saniye: sıradaki videoya tek kart, bir kez abone. Kart bu videonun açık ucunu ödesin. İkinci çağrı yok."
      : "Last 20 seconds: one card to the next video, one subscribe. The card should pay off this video's open end. No second ask.",
  };
}

function checksFor(format: FormatId, turkish: boolean): Check[] {
  const claim =
    format === "cocuk"
      ? turkish
        ? "Korku, alay ve şiddet yok"
        : "No fear, mockery, or violence"
      : format === "belgesel"
        ? turkish
          ? "İddia ile kanıt ayrı cümlelerde"
          : "Claim and evidence stay in different sentences"
        : turkish
          ? "Videonun ödemediği vaat yok"
          : "No promise the video does not pay";
  return [
    {
      id: "hook",
      label: turkish
        ? "İlk 8 saniye vaadi söylüyor"
        : "The first 8 seconds say the promise",
      done: false,
    },
    {
      id: "thumb",
      label: turkish
        ? "Kapak yazısı uzaktan okunuyor"
        : "Thumbnail type reads at a glance",
      done: false,
    },
    {
      id: "audio",
      label: turkish
        ? "Ses temiz, oda ve nefes kontrol edildi"
        : "Voice is clean; room and breath checked",
      done: false,
    },
    {
      id: "caption",
      label: turkish
        ? "Ekran yazısı ve altyazı okunur"
        : "On-screen type and captions are readable",
      done: false,
    },
    {
      id: "chapters",
      label: turkish
        ? "Bölümler açıklamaya işlendi"
        : "Chapters are in the description",
      done: false,
    },
    {
      id: "end",
      label: turkish
        ? "Son 20 saniyede tek yönlendirme var"
        : "One direction in the last 20 seconds",
      done: false,
    },
    { id: "claim", label: claim, done: false },
  ];
}

export function channelForBrief(brief: Brief, channels: Channel[] = DEFAULT_CHANNELS) {
  if (brief.format === "cocuk") return channels.find((c) => c.kind === "cocuk") ?? channels[0];
  if (brief.format === "belgesel") return channels.find((c) => c.kind === "belgesel") ?? channels[0];
  return channels[0];
}

export function buildPack(b: Brief, previous?: Pack, channel?: Channel): Pack {
  const brief = {
    ...b,
    title: clean(b.title),
    audience: clean(b.audience),
    tone: clean(b.tone),
    promise: clean(b.promise),
    sources: clean(b.sources ?? ""),
    minutes: b.format === "shorts" ? 1 : b.minutes,
  };
  const voice = channel ?? channelForBrief(brief);
  const beats = beatsFor(brief);
  const hooks = hooksFor(brief);
  const fresh = checksFor(brief.format, tr(brief));
  const checks = fresh.map((item) => {
    const old = previous?.checks.find((c) => c.id === item.id);
    return old ? { ...item, done: old.done } : item;
  });
  return {
    briefKey: briefKey(brief),
    source: "masa",
    pick: 0,
    titles: titlesFor(brief),
    hooks,
    beats,
    shots: shotsFor(brief, beats),
    thumb: thumbFor(brief, voice),
    seo: seoFor(brief, hooks, beats),
    checks,
    scenes: scenesFor(brief, voice, beats, previous?.scenes),
  };
}

export function voiceMinutes(pack: Pack) {
  const words = pack.beats.reduce(
    (n, beat) => n + beat.voice.split(/\s+/).filter(Boolean).length,
    0,
  );
  return { words, minutes: Math.round((words / 130) * 10) / 10 };
}

export function critique(project: Project): Note[] {
  const turkish = tr(project.brief);
  const title = project.pack.titles[project.pack.pick]?.text ?? "";
  const len = [...title].length;
  const notes: Note[] = [];
  if (project.brief.format === "shorts") {
    notes.push(
      len <= 42
        ? {
            tone: "ok",
            text: turkish
              ? "Başlık kısa. Shorts akışına sığıyor."
              : "Title is short enough for a Shorts feed.",
          }
        : {
            tone: "fix",
            text: turkish
              ? `Başlık ${len} karakter. Shorts için 42'nin altına indir.`
              : `Title is ${len} characters. Keep a Shorts title under 42.`,
          },
    );
  } else if (len >= 40 && len <= 70) {
    notes.push({
      tone: "ok",
      text: turkish
        ? `Başlık ${len} karakter. Arama ve mobil için dengeli.`
        : `Title is ${len} characters. Balanced for search and a phone.`,
    });
  } else if (len < 40) {
    notes.push({
      tone: "fix",
      text: turkish
        ? `Başlık ${len} karakter. Vaadi biraz daha açık yaz, 45–65 hedefle.`
        : `Title is ${len} characters. Say the promise more plainly. Aim for 45–65.`,
    });
  } else {
    notes.push({
      tone: "fix",
      text: turkish
        ? `Başlık ${len} karakter. Mobilde kesilir. 70'in altına çek.`
        : `Title is ${len} characters. It will clip on a phone. Stay under 70.`,
    });
  }

  const words = project.pack.thumb.words.split(/\s+/).filter(Boolean).length;
  const repeatsTitle =
    project.pack.thumb.words.trim().toLocaleLowerCase("tr") ===
    project.brief.title.trim().toLocaleLowerCase("tr");
  notes.push(
    words > 0 && words <= 5 && !repeatsTitle
      ? {
          tone: "ok",
          text: turkish
            ? "Kapak yazısı en fazla beş kelime ve başlığı tekrar etmiyor."
            : "Thumbnail type is at most five words and does not repeat the title.",
        }
      : {
          tone: "fix",
          text: turkish
            ? "Kapak yazısı en fazla beş kelime olsun ve başlığı tekrar etmesin."
            : "Keep thumbnail type to five words, and do not repeat the title.",
        },
  );

  const spoken = voiceMinutes(project.pack);
  const target = project.brief.format === "shorts" ? 0.6 : project.brief.minutes;
  const ratio = target > 0 ? spoken.minutes / target : 1;
  const band =
    project.brief.format === "shorts"
      ? [0.55, 1.5]
      : project.brief.format === "cocuk"
        ? [0.22, 1.15]
        : [0.15, 1.45];
  notes.push(
    ratio >= band[0] && ratio <= band[1]
      ? {
          tone: "ok",
          text: turkish
            ? `Ses metni yaklaşık ${spoken.minutes} dk. ${project.brief.format === "shorts" ? "Süreye yakın." : "İskelet için yeterli; duraklar ve görüntü süreyi tamamlar."}`
            : `Spoken draft is about ${spoken.minutes} min. ${project.brief.format === "shorts" ? "Close to the runtime." : "Enough for a spine; pauses and picture carry the rest."}`,
        }
      : {
          tone: "fix",
          text: turkish
            ? `Ses metni yaklaşık ${spoken.minutes} dk, hedef ${target} dk. Kısalt ya da sahne ekle.`
            : `Spoken draft is about ${spoken.minutes} min. Target is ${target}. Cut or add a scene.`,
        },
  );

  const first = project.pack.beats[0]?.voice ?? "";
  const promiseHit = project.brief.promise
    .split(/\s+/)
    .slice(0, 3)
    .every((w) => first.toLocaleLowerCase("tr").includes(w.toLocaleLowerCase("tr").slice(0, 6)));
  notes.push(
    project.pack.hooks[0]?.window.startsWith("0:00") && (promiseHit || first.length > 20)
      ? {
          tone: "ok",
          text: turkish
            ? "Açılış vaadi geciktirmiyor."
            : "The opening does not delay the promise.",
        }
      : {
          tone: "fix",
          text: turkish
            ? "İlk cümle vaadi taşımıyor. Kancayı başa al."
            : "The first sentence does not carry the promise. Move the hook up.",
        },
  );

  if (project.brief.format === "cocuk") {
    const blob = project.pack.beats.map((beat) => beat.voice).join(" ").toLocaleLowerCase("tr");
    const scared = /kork|ölüm|canavar|korkunç|scary|monster|death/.test(blob);
    notes.push(
      scared
        ? {
            tone: "fix",
            text: turkish
              ? "Çocuk metninde korku izi var. Çıkar."
              : "The children's draft has a fear cue. Remove it.",
          }
        : {
            tone: "ok",
            text: turkish
              ? "Çocuk metninde korku izi görünmüyor."
              : "No fear cue in the children's draft.",
          },
    );
  }

  return notes;
}

export function scoreOf(notes: Note[]) {
  if (!notes.length) return 0;
  const ok = notes.filter((n) => n.tone === "ok").length;
  return Math.round((ok / notes.length) * 100);
}

export function toMarkdown(project: Project) {
  const { brief, pack } = project;
  const title = pack.titles[pack.pick]?.text ?? brief.title;
  const lines = [
    `# ${title}`,
    "",
    `${formatLabel(brief.format)} · ${brief.audience} · ${brief.tone} · ${brief.minutes} dk`,
    "",
    brief.promise,
    "",
    `Kaynak: ${pack.source === "grok" ? "Grok" : "Masa kalıbı"}`,
    "",
    "## Başlıklar",
    ...pack.titles.map(
      (item, i) =>
        `${i === pack.pick ? ">" : "-"} ${item.text} (${item.angle}) — ${item.why}`,
    ),
    "",
    "## Kancalar",
    ...pack.hooks.flatMap((hook) => [
      `### ${hook.window}`,
      hook.line,
      `Görüntü: ${hook.visual}`,
      `Kes: ${hook.cut}`,
      "",
    ]),
    "## Senaryo",
    ...pack.beats.flatMap((beat) => [
      `### ${beat.time} ${beat.title}`,
      beat.voice,
      `Ekran: ${beat.screen}`,
      `Görüntü: ${beat.visual}`,
      "",
    ]),
    "## Çekim",
    ...pack.shots.map(
      (shot) =>
        `- ${shot.n} ${shot.kind} · ${shot.frame} · ${shot.sec}s${shot.must ? " · zorunlu" : ""} — ${shot.do}`,
    ),
    "",
    "## Kapak",
    `Yazı: ${pack.thumb.words}`,
    pack.thumb.face,
    pack.thumb.layout,
    pack.thumb.contrast,
    `Yasak: ${pack.thumb.ban}`,
    "",
    "## Açıklama",
    pack.seo.description,
    "",
    "## Etiketler",
    pack.seo.tags.join(", "),
    "",
    "## Sabit yorum",
    pack.seo.pinned,
    "",
    "## Son ekran",
    pack.seo.end,
    "",
  ];
  return lines.join("\n");
}

function project(id: string, channelId: string, brief: Brief, createdAt: number): Project {
  const channel = DEFAULT_CHANNELS.find((item) => item.id === channelId) ?? DEFAULT_CHANNELS[0];
  return {
    id,
    channelId,
    createdAt,
    updatedAt: createdAt,
    brief,
    pack: buildPack(brief, undefined, channel),
  };
}

export const SEEDS: Project[] = [
  project(
    "seed-enceladus",
    "bilimcifikri",
    {
      title: "Enceladus: buzun altındaki okyanus",
      format: "belgesel",
      audience: "meraklı yetişkin",
      minutes: 8,
      tone: "bilimsel",
      promise: "Satürn'ün uydusunda hayat aramak bir bilimkurgu değil. Elimizdeki en temiz ipucu.",
      language: "tr",
      sources: "Cassini INMS hidrojen ölçümü. CDA tuzlu buz taneleri. Waite ve Postberg.",
    },
    SEED_AT,
  ),
  project(
    "seed-prometheus",
    "mitocolik",
    {
      title: "Prometheus'un ateşi",
      format: "uzun",
      audience: "mitoloji meraklısı",
      minutes: 8,
      tone: "sıcak",
      promise: "Ateşin çalınması bir kahramanlık değil, bedeli olan bir armağan.",
      language: "tr",
    },
    SEED_AT + 1,
  ),
  project(
    "seed-kitap",
    "kitap-anatomisi",
    {
      title: "İlk yirmi sayfa neden yeter",
      format: "uzun",
      audience: "kitap okuru",
      minutes: 9,
      tone: "sakin",
      promise: "Bir kitabın vaadi girişte ya durur ya çöker.",
      language: "tr",
    },
    SEED_AT + 2,
  ),
  project(
    "seed-papi",
    "papi-pupa",
    {
      title: "Papi ve kayıp ışık",
      format: "cocuk",
      audience: "3–6 yaş ve ebeveyn",
      minutes: 4,
      tone: "sıcak",
      promise: "Kayıp bir ışık, yanında duran bir arkadaş ve birlikte söylenen kısa bir nakarat.",
      language: "tr",
    },
    SEED_AT + 3,
  ),
  project(
    "seed-hook",
    "bilimcifikri",
    {
      title: "İlk 8 saniye neden her şeyi belirler",
      format: "shorts",
      audience: "yeni anlatıcılar",
      minutes: 1,
      tone: "net",
      promise: "İzleyici kaybının çoğu, vaat daha söylenmeden olur.",
      language: "tr",
      sources: "YouTube izlenme eğrisi: ilk saniyelerdeki terk. Kanalın kendi son üç videosu.",
    },
    SEED_AT + 4,
  ),
];
