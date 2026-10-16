/// <reference lib="webworker" />
import { env } from "@huggingface/transformers";
// ONNX Runtime's WebAssembly ships with the app. Cloudflare can't host the 26 MB binary
// (25 MiB per-file limit), so there it comes once from a version-pinned CDN copy; either
// way it is kept in Cache Storage and later loads need no connection.
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import ortMjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";

type OnnxEnv = {
  versions?: { web?: string };
  wasm?: { wasmPaths?: unknown; numThreads?: number };
};

async function wasmUrl(onnx: OnnxEnv): Promise<string> {
  const local = new URL(ortWasm, self.location.href).href;
  const cdn = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${onnx.versions?.web}/dist/ort-wasm-simd-threaded.asyncify.wasm`;
  const cache = await caches.open("transformers-cache");
  if (await cache.match(local)) return local;
  if (await cache.match(cdn)) return cdn;
  try {
    const res = await fetch(local, { method: "HEAD" });
    if (res.ok && res.headers.get("content-type")?.includes("wasm"))
      return local;
  } catch {
    /* offline: fall through */
  }
  return cdn;
}

/** Point ONNX Runtime at its WebAssembly and optionally forbid any model download. */
export async function configureRuntime(allowRemote: boolean) {
  env.allowRemoteModels = allowRemote;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const onnx = env.backends.onnx as OnnxEnv;
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = {
      mjs: new URL(ortMjs, self.location.href).href,
      wasm: await wasmUrl(onnx),
    };
    // Threads need cross-origin isolation (COOP/COEP headers); the app sets them.
    onnx.wasm.numThreads = self.crossOriginIsolated
      ? Math.max(1, Math.min(4, navigator.hardwareConcurrency - 2))
      : 1;
  }
}

/** q4f16 is fastest but needs GPU half-precision support; many Mali GPUs lack it. */
export async function pickWebGpuDtype(): Promise<"q4f16" | "q4" | null> {
  try {
    const gpu = (
      navigator as Navigator & {
        gpu?: {
          requestAdapter(o?: object): Promise<{ features: Set<string> } | null>;
        };
      }
    ).gpu;
    const adapter = await gpu?.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) return null;
    return adapter.features.has("shader-f16") ? "q4f16" : "q4";
  } catch {
    return null;
  }
}
