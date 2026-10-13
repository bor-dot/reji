export type GapRow = {
  n: number;
  title: string;
  text: string;
  image: boolean;
  audio: boolean;
};

export function sceneGaps(rows: GapRow[]): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    const missing: string[] = [];
    if (!row.text.trim()) missing.push("metin yok");
    if (!row.image) missing.push("görsel yok");
    if (!row.audio) missing.push("ses yok");
    if (missing.length === 0) continue;
    lines.push(`${String(row.n).padStart(2, "0")} · ${row.title}: ${missing.join(", ")}`);
  }
  return lines;
}

export function exportFolderName(title: string): string {
  const clean = title
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return clean || "cekim";
}

export function frameSize(format: string): { width: number; height: number; label: string } {
  if (format === "shorts") return { width: 1080, height: 1920, label: "1080x1920" };
  return { width: 1920, height: 1080, label: "1920x1080" };
}

export function srtStamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hour = Math.floor(ms / 3_600_000);
  const minute = Math.floor((ms % 3_600_000) / 60_000);
  const second = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hour)}:${pad(minute)}:${pad(second)},${String(milli).padStart(3, "0")}`;
}

export function buildSrt(cues: { text: string; duration: number }[]): string {
  let cursor = 0;
  const blocks = cues.map((cue, index) => {
    const start = cursor;
    const end = cursor + cue.duration;
    cursor = end;
    const body = cue.text.replace(/\r\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
    return `${index + 1}\n${srtStamp(start)} --> ${srtStamp(end)}\n${body}`;
  });
  return `${blocks.join("\n\n")}\n`;
}
