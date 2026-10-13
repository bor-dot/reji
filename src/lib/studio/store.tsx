import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_CHANNELS, channelById, type Channel } from "./channels";
import { briefKey, buildPack, scenesFor, SEEDS, seriesBriefs } from "./engine";
import type { Brief, Pack, Project } from "./types";

const STORAGE = "reji.vault.v3";
const LEGACY = "reji.projects.v2";

export type ProviderId = "xai" | "gemini" | "openai" | "anthropic";

export type KeyBlob = {
  provider: ProviderId;
  hint: string;
  iv: string;
  ciphertext: string;
};

export type ModelPrefs = {
  text: string;
  image: string;
  video: string;
  videoSize: "720p" | "1080p";
  writer: "api" | "cli" | "grok" | "codex" | "claude" | "gemini";
};

export const DEFAULT_MODELS: ModelPrefs = {
  text: "grok-4.5",
  image: "grok-imagine-image",
  video: "grok-imagine-video-1.5-lite",
  videoSize: "720p",
  writer: "api",
};

function modelsOf(raw?: Partial<ModelPrefs>): ModelPrefs {
  const writer = raw?.writer;
  const allowed =
    writer === "cli" || writer === "grok" || writer === "codex" || writer === "claude" || writer === "gemini" || writer === "api";
  return {
    ...DEFAULT_MODELS,
    ...raw,
    videoSize: raw?.videoSize === "1080p" ? "1080p" : "720p",
    writer: allowed ? writer : "api",
  };
}

type Saved = {
  channels: Channel[];
  projects: Project[];
  activeId: string;
  models: ModelPrefs;
  keys: KeyBlob[];
};

type GeneratedPackShape = {
  titles: Pack["titles"];
  hooks: Pack["hooks"];
  beats: Pack["beats"];
  shots: Pack["shots"];
  thumb: Pack["thumb"];
  seo: Pack["seo"];
};

function isChannel(value: unknown): value is Channel {
  if (!value || typeof value !== "object") return false;
  const row = value as Channel;
  return Boolean(row.id && row.name && row.cover && row.kind);
}

function normalizeProject(value: unknown, channels: Channel[] = DEFAULT_CHANNELS): Project | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Project;
  if (!row.id || !row.brief?.title || !row.pack?.titles?.length || !row.pack.checks) return null;
  const list = channels.length ? channels : DEFAULT_CHANNELS;
  const channelId =
    row.channelId ||
    (row.brief.format === "cocuk" ? "papi-pupa" : "bilimcifikri");
  const channel = channelById(list, channelId);
  const scenes = row.pack.scenes?.length
    ? row.pack.scenes
    : scenesFor(row.brief, channel, row.pack.beats ?? []);
  return {
    ...row,
    channelId: channel.id,
    brief: { ...row.brief, sources: row.brief.sources ?? "" },
    pack: { ...row.pack, scenes },
  };
}

function freshVault(): Saved {
  return {
    channels: DEFAULT_CHANNELS,
    projects: SEEDS,
    activeId: DEFAULT_CHANNELS[0].id,
    models: DEFAULT_MODELS,
    keys: [],
  };
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) {
      const data = JSON.parse(raw) as Partial<Saved>;
      const channels = Array.isArray(data.channels) ? data.channels.filter(isChannel) : [];
      const list = channels.length ? channels : DEFAULT_CHANNELS;
      const projects = Array.isArray(data.projects)
        ? data.projects.map((item) => normalizeProject(item, list)).filter((item): item is Project => Boolean(item))
        : [];
      if (!channels.length && !projects.length) return null;
      return {
        channels: channels.length ? channels : DEFAULT_CHANNELS,
        projects,
        activeId: typeof data.activeId === "string" ? data.activeId : channels[0]?.id ?? DEFAULT_CHANNELS[0].id,
        models: modelsOf(data.models),
        keys: Array.isArray(data.keys) ? data.keys.filter((key) => key?.iv && key?.ciphertext && key?.provider) : [],
      };
    }
    const legacy = localStorage.getItem(LEGACY);
    if (!legacy) return null;
    const rows = JSON.parse(legacy) as unknown;
    if (!Array.isArray(rows)) return null;
    const projects = rows.map((item) => normalizeProject(item)).filter((item): item is Project => Boolean(item));
    if (!projects.length) return null;
    return { ...freshVault(), projects };
  } catch {
    return null;
  }
}

function persist(saved: Saved) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(saved));
  } catch {
    /* quota — session still works */
  }
}

type Studio = {
  ready: boolean;
  channels: Channel[];
  projects: Project[];
  activeId: string;
  active: Channel;
  models: ModelPrefs;
  keys: KeyBlob[];
  setActive: (id: string) => void;
  create: (brief: Brief, channelId: string) => string;
  remove: (id: string) => void;
  restoreSeeds: () => void;
  patchBrief: (id: string, patch: Partial<Brief>) => void;
  patchPack: (id: string, patch: Partial<Pack>) => void;
  rebuild: (id: string) => void;
  applyGenerated: (id: string, generated: GeneratedPackShape) => void;
  addSeries: (id: string) => number;
  addChannel: (channel: Channel) => void;
  updateChannel: (id: string, patch: Partial<Channel>) => void;
  removeChannel: (id: string) => void;
  restoreChannels: () => void;
  setModels: (patch: Partial<ModelPrefs>) => void;
  rememberKey: (key: KeyBlob) => void;
  forgetKey: (provider: ProviderId) => void;
  snapshot: () => Saved;
  replaceVault: (next: Saved) => void;
  keyFor: (provider: ProviderId) => KeyBlob | undefined;
};

const StudioContext = createContext<Studio | null>(null);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Saved>(freshVault);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const loaded = load();
    if (loaded) setSaved(loaded);
    else persist(freshVault());
    setReady(true);
  }, []);

  const write = useCallback((updater: (prev: Saved) => Saved) => {
    setSaved((prev) => {
      const next = updater(prev);
      persist(next);
      return next;
    });
  }, []);

  const api = useMemo<Studio>(() => {
    const active = channelById(saved.channels, saved.activeId);
    return {
      ready,
      channels: saved.channels,
      projects: saved.projects,
      activeId: active.id,
      active,
      models: saved.models,
      keys: saved.keys,
      setActive: (id) => write((prev) => ({ ...prev, activeId: id })),
      create: (brief, channelId) => {
        const id = crypto.randomUUID();
        const now = Date.now();
        const channel = channelById(saved.channels, channelId);
        const project: Project = {
          id,
          channelId: channel.id,
          createdAt: now,
          updatedAt: now,
          brief,
          pack: buildPack(brief, undefined, channel),
        };
        write((prev) => ({ ...prev, projects: [project, ...prev.projects] }));
        return id;
      },
      remove: (id) => write((prev) => ({ ...prev, projects: prev.projects.filter((p) => p.id !== id) })),
      restoreSeeds: () => write((prev) => ({ ...prev, projects: SEEDS })),
      patchBrief: (id, patch) =>
        write((prev) => ({
          ...prev,
          projects: prev.projects.map((p) =>
            p.id === id ? { ...p, updatedAt: Date.now(), brief: { ...p.brief, ...patch } } : p,
          ),
        })),
      patchPack: (id, patch) =>
        write((prev) => ({
          ...prev,
          projects: prev.projects.map((p) =>
            p.id === id ? { ...p, updatedAt: Date.now(), pack: { ...p.pack, ...patch } } : p,
          ),
        })),
      rebuild: (id) =>
        write((prev) => ({
          ...prev,
          projects: prev.projects.map((p) => {
            if (p.id !== id) return p;
            const channel = channelById(prev.channels, p.channelId);
            return { ...p, updatedAt: Date.now(), pack: buildPack(p.brief, p.pack, channel) };
          }),
        })),
      applyGenerated: (id, generated) =>
        write((prev) => ({
          ...prev,
          projects: prev.projects.map((p) => {
            if (p.id !== id) return p;
            const channel = channelById(prev.channels, p.channelId);
            return {
              ...p,
              updatedAt: Date.now(),
              pack: {
                ...p.pack,
                ...generated,
                pick: 0,
                source: "grok",
                briefKey: briefKey(p.brief),
                scenes: scenesFor(p.brief, channel, generated.beats, p.pack.scenes),
              },
            };
          }),
        })),
      addSeries: (id) => {
        const source = saved.projects.find((p) => p.id === id);
        if (!source) return 0;
        const channel = channelById(saved.channels, source.channelId);
        const seriesId = source.seriesId ?? `seri-${source.id}`;
        const now = Date.now();
        const extra = seriesBriefs(source.brief, channel).map((brief, index) => ({
          id: crypto.randomUUID(),
          channelId: channel.id,
          seriesId,
          createdAt: now + index,
          updatedAt: now + index,
          brief,
          pack: buildPack(brief, undefined, channel),
        }));
        write((prev) => ({
          ...prev,
          projects: [
            ...extra,
            ...prev.projects.map((p) => (p.id === id ? { ...p, seriesId } : p)),
          ],
        }));
        return extra.length;
      },
      addChannel: (channel) =>
        write((prev) => ({ ...prev, channels: [...prev.channels, channel], activeId: channel.id })),
      updateChannel: (id, patch) =>
        write((prev) => ({
          ...prev,
          channels: prev.channels.map((channel) => (channel.id === id ? { ...channel, ...patch, id } : channel)),
        })),
      removeChannel: (id) =>
        write((prev) => {
          const channels = prev.channels.filter((channel) => channel.id !== id);
          const next = channels.length ? channels : DEFAULT_CHANNELS;
          return { ...prev, channels: next, activeId: next[0].id };
        }),
      restoreChannels: () =>
        write((prev) => {
          const ids = new Set(prev.channels.map((channel) => channel.id));
          const missing = DEFAULT_CHANNELS.filter((channel) => !ids.has(channel.id));
          return { ...prev, channels: [...prev.channels, ...missing] };
        }),
      setModels: (patch) => write((prev) => ({ ...prev, models: { ...prev.models, ...patch } })),
      rememberKey: (key) =>
        write((prev) => ({
          ...prev,
          keys: [...prev.keys.filter((item) => item.provider !== key.provider), key],
        })),
      forgetKey: (provider) => write((prev) => ({ ...prev, keys: prev.keys.filter((key) => key.provider !== provider) })),
      snapshot: () => saved,
      replaceVault: (next) =>
        write(() => {
          const channels = (next.channels ?? []).filter(isChannel);
          const list = channels.length ? channels : DEFAULT_CHANNELS;
          const projects = (next.projects ?? [])
            .map((item) => normalizeProject(item, list))
            .filter((item): item is Project => Boolean(item));
          return {
            channels: list,
            projects,
            activeId: list.some((channel) => channel.id === next.activeId) ? next.activeId : list[0].id,
            models: modelsOf(next.models),
            keys: Array.isArray(next.keys)
              ? next.keys.filter((key) => key?.iv && key?.ciphertext && key?.provider)
              : [],
          };
        }),
      keyFor: (provider) => saved.keys.find((key) => key.provider === provider),
    };
  }, [ready, saved, write]);

  return <StudioContext.Provider value={api}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("Studio missing");
  return ctx;
}

export type { GeneratedPackShape };
