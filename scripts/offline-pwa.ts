// Vite plugin for the on-device app: adds the cross-origin isolation headers threads need
// and writes a service worker that precaches the built app so it opens with no connection.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Plugin } from "vite";

export const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export function offlinePwa(): Plugin {
  let outDir = "dist";
  return {
    name: "beside-offline-pwa",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = walk(outDir)
        .map((p) => "/" + relative(outDir, p).split("\\").join("/"))
        .filter(
          (p) =>
            !p.endsWith(".map") &&
            // The runtime caches its own WebAssembly on first use (see runtime.ts).
            !p.endsWith(".wasm") &&
            !["/_headers", "/.assetsignore", "/offline-sw.js"].includes(p),
        )
        .sort();
      const hash = createHash("sha256");
      for (const f of files)
        hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest("hex").slice(0, 12);
      writeFileSync(
        join(outDir, "offline-sw.js"),
        serviceWorker(version, files),
      );
    },
  };
}

function serviceWorker(version: string, files: string[]) {
  return `// Generated at build time. Keeps Beside working with no connection.
const CACHE = "beside-app-${version}";
const PRECACHE = ${JSON.stringify(files)};
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("beside-app-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  if (path === "/offline.html" || (PRECACHE.includes(path) && path !== "/index.html")) {
    // The on-device app and all hashed assets: cache first, so it opens instantly offline.
    event.respondWith(caches.match(path).then((hit) => hit || fetch(req)));
    return;
  }
  if (req.mode === "navigate") {
    // The server-backed app stays network-first; fall back to the cached copy offline.
    event.respondWith(fetch(req).catch(() => caches.match("/index.html")));
  }
});
`;
}
