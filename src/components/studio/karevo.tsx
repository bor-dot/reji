import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { sendToKarevo } from "@/lib/studio/generate";
import { exportFolderName, frameSize, sceneGaps } from "@/lib/studio/karevo";
import { getSceneAudio, getSceneVideo } from "@/lib/studio/scene-audio";
import { notify } from "@/lib/studio/toast";
import type { Project } from "@/lib/studio/types";
import { Button } from "./bits";

export function KarevoSend({ project, channelName }: { project: Project; channelName: string }) {
  const send = useServerFn(sendToKarevo);
  const [busy, setBusy] = useState(false);
  const [gaps, setGaps] = useState<string[]>([]);
  const [path, setPath] = useState("");

  async function onSend() {
    setBusy(true);
    setPath("");
    try {
      const scenes = project.pack.scenes ?? [];
      if (scenes.length === 0) {
        const empty = ["Sahne listesi boş."];
        setGaps(empty);
        notify("Eksik dosya var. Gönderilmedi.");
        return;
      }
      const rows = await Promise.all(
        scenes.map(async (scene, index) => {
          const audio = await getSceneAudio(project.id, scene.id);
          const storedVideo = scene.videoUrl?.startsWith("idb:") ? await getSceneVideo(project.id, scene.id) : null;
          const beat = project.pack.beats[index];
          return {
            n: index + 1,
            title: scene.title,
            text: beat?.voice ?? "",
            image: Boolean(scene.imageUrl),
            hasAudio: Boolean(audio && audio.duration > 0),
            audio,
            imageUrl: scene.imageUrl ?? "",
            videoUrl: storedVideo ? `data:video/mp4;base64,${storedVideo}` : scene.videoUrl,
            simulation: scene.simulation,
          };
        }),
      );
      const missing = sceneGaps(rows.map((row) => ({ ...row, audio: row.hasAudio })));
      setGaps(missing);
      if (missing.length) {
        notify("Eksik dosya var. Gönderilmedi.");
        return;
      }
      const frame = frameSize(project.brief.format);
      const res = await send({
        data: {
          folderName: exportFolderName(project.brief.title),
          name: project.brief.title,
          channel: channelName,
          resolution: frame.label,
          scenes: rows.map((row) => ({
            n: row.n,
            title: row.title,
            text: row.text,
            simulation: row.simulation,
            duration: row.audio?.duration ?? 0,
            imageUrl: row.imageUrl,
            videoUrl: row.videoUrl,
            audioBase64: row.audio?.base64 ?? "",
          })),
        },
      });
      if (!res.ok) {
        setGaps(res.missing.length ? res.missing : [res.error]);
        notify(res.error);
        return;
      }
      setPath(res.path);
      notify("Karevo paketi yazıldı.");
    } catch {
      notify("Karevo paketi yazılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-subtle p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg">Karevo</h3>
          <p className="mt-1 text-sm text-muted">
            Görsel ve sahne sesi tamamsa paket ~/Documents/REJI-Export altına yazılır. Video varsa eklenir.
          </p>
        </div>
        <Button onClick={() => void onSend()} disabled={busy}>
          {busy ? "Yazılıyor" : "Karevo'ya gönder"}
        </Button>
      </div>
      {gaps.length ? (
        <ul className="flex flex-col gap-1">
          {gaps.map((line) => (
            <li key={line} className="text-sm text-fg">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {path ? <p className="text-sm text-muted">{path}</p> : null}
    </div>
  );
}
