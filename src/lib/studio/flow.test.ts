import assert from "node:assert/strict";
import test from "node:test";
import { chaptersFromBeats } from "./engine.ts";
import { promptsTooAlike, readModelAny, readStep, sectionCount, targetWords } from "./prompts.ts";
import { cleanSpeech } from "./speech-clean.ts";
import type { Beat } from "./types.ts";

test("cleanSpeech drops directions and keeps the spoken line", () => {
  const cleaned = cleanSpeech("Merhaba. [müzik]\nSahne: okyanus\nCassini veriyi gördü. (fısıltı) 00:12 Burada buz gösterilir.");
  assert.match(cleaned.text, /Cassini veriyi gördü/);
  assert.equal(/\[|Sahne\s*:/.test(cleaned.text), false);
  assert.equal(cleaned.blocked, null);
  assert.ok(cleaned.removed.length >= 2);
});

test("sectionCount and targetWords follow the minute target", () => {
  assert.equal(targetWords(8), 1160);
  assert.equal(sectionCount(8), 8);
  assert.equal(sectionCount(1), 4);
  assert.equal(sectionCount(40), 12);
  assert.equal(targetWords(0), 145);
});

test("chaptersFromBeats clocks real durations and starts at 0:00", () => {
  const beats: Beat[] = [
    { time: "9:99", title: "Açılış", voice: "", screen: "", visual: "", duration: 65 },
    { time: "9:99", title: "Kanıt", voice: "", screen: "", visual: "", duration: 10 },
  ];
  assert.deepEqual(
    chaptersFromBeats(beats).map((chapter) => chapter.time),
    ["0:00", "1:05"],
  );
  assert.equal(chaptersFromBeats([{ ...beats[0], duration: 0 }, { ...beats[1], duration: 0 }])[0].time, "0:00");
});

test("promptsTooAlike flags a near copy and allows a different scene", () => {
  const left = "wide shot of enceladus ocean plume icy moon cassini spacecraft";
  const right = "wide shot of enceladus ocean plume icy moon cassini probe";
  const other = "close portrait of a red fox reading a book in a library";
  assert.equal(promptsTooAlike(left, right), true);
  assert.equal(promptsTooAlike(left, other), false);
  assert.equal(promptsTooAlike("ice", "ice moon"), false);
});

test("readModelAny keeps the first JSON block and prose steps still parse", () => {
  const value = readModelAny('önsöz {"puan":7} sonra {"puan":1}');
  assert.equal((value as { puan: number }).puan, 7);
  const prose = [
    "Cassini buzu deldi ve tuzlu su fışkırdı. Bu su okyanustan geliyor. Ölçümler hidrojen gösterdi.",
    "Bilim insanları ısıyı hesapladı. Gelgit sürtünmesi okyanusu sıvı tutuyor. Bu tek uçuşta anlaşıldı.",
    "Kapanışta hâlâ bilmediğimiz şey var. Yaşam için enerji var. Örnek henüz getirilmedi.",
  ].join("\n\n");
  const step = readStep("senaryo", prose);
  assert.ok(step?.bolumler && step.bolumler.length >= 3);
});
