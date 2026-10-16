// Model files live in the browser's Cache Storage, under the same keys the runtime uses
// when it downloads them. That lets a folder copied onto the tablet be imported with no
// internet at all.

import { VOICE_MODEL } from "./models";

const MODEL_CACHE = "transformers-cache";
const VOICE_CACHE = "kokoro-voices";
const hfPrefix = (repo: string) =>
  `https://huggingface.co/${repo}/resolve/main/`;

export async function cachedBytes(repo: string): Promise<number> {
  if (!("caches" in window)) return 0;
  const cache = await caches.open(MODEL_CACHE);
  let total = 0;
  for (const req of await cache.keys()) {
    if (!req.url.startsWith(hfPrefix(repo))) continue;
    const res = await cache.match(req);
    total += Number(res?.headers.get("content-length") ?? 0);
  }
  return total;
}

/** True when a model's config and at least one weight file are on the device. */
export async function isCached(repo: string): Promise<boolean> {
  if (!("caches" in window)) return false;
  const cache = await caches.open(MODEL_CACHE);
  const keys = (await cache.keys())
    .map((r) => r.url)
    .filter((u) => u.startsWith(hfPrefix(repo)));
  return (
    keys.some((u) => u.endsWith("/config.json")) &&
    keys.some((u) => u.includes(".onnx"))
  );
}

export async function firstCachedRepo(repos: string[]): Promise<string | null> {
  for (const repo of repos) if (await isCached(repo)) return repo;
  return null;
}

export async function deleteModel(repo: string): Promise<void> {
  const cache = await caches.open(MODEL_CACHE);
  for (const req of await cache.keys())
    if (req.url.startsWith(hfPrefix(repo))) await cache.delete(req);
}

const TYPES: Record<string, string> = {
  json: "application/json",
  txt: "text/plain",
  onnx: "application/octet-stream",
  onnx_data: "application/octet-stream",
  bin: "application/octet-stream",
  jinja: "text/plain",
};

/**
 * Import a model folder picked from device storage (for example one copied over USB from a
 * computer that ran `hf download <repo>`). The folder's own name is ignored.
 */
export async function importFolder(
  repo: string,
  files: File[],
  onProgress: (done: number, total: number) => void,
): Promise<number> {
  const isVoice = repo === VOICE_MODEL;
  const modelCache = await caches.open(MODEL_CACHE);
  const voiceCache = await caches.open(VOICE_CACHE);
  const usable = files.filter(
    (f) => !f.name.startsWith(".") && !/\.(md|gitattributes)$/.test(f.name),
  );
  let done = 0;
  for (const file of usable) {
    const rel =
      (file.webkitRelativePath || file.name).split("/").slice(1).join("/") ||
      file.name;
    const ext = rel.split(".").pop() ?? "";
    const response = () =>
      new Response(file, {
        headers: {
          "content-type": TYPES[ext] ?? "application/octet-stream",
          "content-length": String(file.size),
        },
      });
    const url = hfPrefix(repo) + rel;
    if (isVoice && rel.startsWith("voices/"))
      await voiceCache.put(url, response());
    else await modelCache.put(url, response());
    onProgress(++done, usable.length);
  }
  return done;
}

export interface StorageInfo {
  usedGB: number;
  quotaGB: number;
  persisted: boolean;
}

export async function storageInfo(): Promise<StorageInfo | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  return { usedGB: usage / 1e9, quotaGB: quota / 1e9, persisted };
}

/** Ask the browser not to evict multi-gigabyte model files when space runs low. */
export async function requestPersistence(): Promise<boolean> {
  return (await navigator.storage?.persist?.()) ?? false;
}
