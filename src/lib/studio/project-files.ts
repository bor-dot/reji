import { createServerFn } from "@tanstack/react-start";

export const saveProjectMedia = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { saveProjectMediaFile } = await import("./project-files.server");
    return saveProjectMediaFile(data);
  });

export const readProjectMedia = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { readProjectMediaFile } = await import("./project-files.server");
    return readProjectMediaFile(data);
  });

export const keepRemoteMedia = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { keepRemoteMediaFile } = await import("./project-files.server");
    return keepRemoteMediaFile(data);
  });

export const mixProjectAudio = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { mixProjectAudioFile } = await import("./project-files.server");
    return mixProjectAudioFile(data);
  });
