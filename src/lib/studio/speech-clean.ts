const LEAD = /^\s*(Sahne|Görsel|Not|Anlatıcı|Kamera|Müzik|Efekt|Zaman)\s*:/i;
const TIME = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[–-]\s*\d{1,2}:\d{2}(?::\d{2})?)?\b/g;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;
const DIRECT = /^(Bu bölümde|İzleyiciye)\b|Burada .{0,120}gösterilir/i;
const DIRTY = /\[[^\]]*\]|\b(Sahne|Görsel|Not)\s*:/i;

export type CleanedSpeech = {
  text: string;
  removed: string[];
  pieces: string[];
  blocked: string | null;
};

export function cleanSpeech(raw: string): CleanedSpeech {
  const removed: string[] = [];
  let text = raw.replace(/\r/g, "");
  const drop = (match: string) => {
    const item = match.trim();
    if (item) removed.push(item.slice(0, 180));
    return " ";
  };
  text = text.replace(/\[[^\[\]\n]{0,240}\]/g, drop);
  text = text.replace(/\([^()\n]{0,240}\)/g, drop);
  text = text
    .split("\n")
    .flatMap((line) => {
      if (LEAD.test(line) || /^\s*#{1,6}\s+\S/.test(line) || /^\s*\*\*[^*]{0,80}\*\*\s*$/.test(line)) {
        removed.push(line.trim().slice(0, 180));
        return [];
      }
      return [line.replace(/^\s*[-*•]\s+/, "").replace(/\*\*|__|`/g, "")];
    })
    .join("\n");
  text = text.replace(TIME, drop).replace(EMOJI, " ");
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  const kept = sentences.filter((sentence) => {
    if (DIRECT.test(sentence)) {
      removed.push(sentence.slice(0, 180));
      return false;
    }
    return true;
  });
  const clean = kept.join(" ").replace(/\s+/g, " ").trim();
  const pieces = splitPieces(clean, 1800);
  const blocked = pieces.find((piece) => DIRTY.test(piece)) ?? null;
  return { text: clean, removed, pieces, blocked };
}

export function splitPieces(text: string, max: number) {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > max && current) {
      pieces.push(current);
      current = sentence.slice(0, max);
    } else {
      current = next.slice(0, max);
    }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}
