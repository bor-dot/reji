const DB = "reji-media";
const AUDIO = "audio";
const VIDEO = "video";

type Row = { base64: string; duration: number };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(AUDIO)) request.result.createObjectStore(AUDIO);
      if (!request.result.objectStoreNames.contains(VIDEO)) request.result.createObjectStore(VIDEO);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function keyOf(projectId: string, sceneId: string) {
  return `${projectId}:${sceneId}`;
}

function put(store: string, key: string, value: unknown) {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

function get<T>(store: string, key: string) {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const request = tx.objectStore(store).get(key);
        request.onsuccess = () => {
          db.close();
          resolve((request.result as T | undefined) ?? null);
        };
        request.onerror = () => {
          db.close();
          reject(request.error);
        };
      }),
  );
}

export async function putSceneAudio(projectId: string, sceneId: string, base64: string, duration: number) {
  await put(AUDIO, keyOf(projectId, sceneId), { base64, duration } satisfies Row);
}

export async function getSceneAudio(projectId: string, sceneId: string) {
  const row = await get<Row>(AUDIO, keyOf(projectId, sceneId));
  return row?.base64 ? row : null;
}

export async function putSceneVideo(projectId: string, sceneId: string, base64: string) {
  await put(VIDEO, keyOf(projectId, sceneId), base64);
}

export async function getSceneVideo(projectId: string, sceneId: string) {
  return get<string>(VIDEO, keyOf(projectId, sceneId));
}