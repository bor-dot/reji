import type { Beat } from "./types";

const SKIP_LINE =
  /^(?:\d{1,2}:\d{2}(?::\d{2})?\b|\[(?:GÖRSEL|GORSEL|ANİMASYON|ANIMASYON|EKRAN)\]|kanca\b|hook\b|kaynak\b|başlık\b|baslik\b)/i;

export function narrationText(beats: Pick<Beat, "voice">[]): string {
  return beats
    .map((beat) => beat.voice)
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !SKIP_LINE.test(line))
    .join("\n");
}

export function narrationChunks(text: string, limit = 1800): string[] {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  if (!clean) return [];
  const parts: string[] = [];
  let rest = clean;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.45) cut = rest.lastIndexOf(" ", limit);
    if (cut < 240) cut = limit;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export function spreadNarration<T extends { voice: string }>(beats: T[], text: string): T[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!beats.length || !clean) return beats;
  const paragraphs = clean
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const sentences = clean.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const pieces =
    paragraphs.length >= beats.length ? paragraphs : sentences.length >= beats.length ? sentences : clean.split(/\s+/).filter(Boolean);
  if (!pieces.length) return beats;
  const size = Math.ceil(pieces.length / beats.length);
  const joiner = paragraphs.length >= beats.length ? "\n\n" : " ";
  return beats.map((beat, index) => {
    const voice = pieces.slice(index * size, (index + 1) * size).join(joiner).trim();
    return voice ? { ...beat, voice } : beat;
  });
}

const WORD_MARKS: Record<number, number> = { 5: 650, 10: 1300, 20: 2600, 30: 3900 };

export function targetWords(minutes: number): number {
  if (WORD_MARKS[minutes]) return WORD_MARKS[minutes];
  return Math.max(80, Math.round(minutes * 130));
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number) {
  return Uint8Array.of(value & 255, (value >>> 8) & 255);
}

function u32(value: number) {
  return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function zipStore(files: { name: string; data: Uint8Array }[]) {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      name,
      file.data,
    ]);
    locals.push(local);
    centrals.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(file.data.length),
        u32(file.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }
  const central = concat(centrals);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return concat([...locals, central, end]);
}

function xml(value: string) {
  return value
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">");
}

export function docxBytes(markdown: string): Uint8Array {
  const encoder = new TextEncoder();
  const paragraphs = markdown.split("\n").map((line) => {
    const text = line.replace(/^#{1,3}\s/, "").replace(/^>\s?/, "").replace(/^-\s/, "");
    return `<w:p><w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
  });
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join("")}</w:body></w:document>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  return zipStore([
    { name: "[Content_Types].xml", data: encoder.encode(types) },
    { name: "_rels/.rels", data: encoder.encode(rels) },
    { name: "word/document.xml", data: encoder.encode(document) },
  ]);
}

export function plainText(markdown: string) {
  return markdown
    .replace(/^#{1,3}\s/gm, "")
    .replace(/^>\s?/gm, "")
    .trim();
}
