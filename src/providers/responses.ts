export interface InferenceInput {
  model: string;
  instructions: string;
  input: Array<{ role: "user" | "assistant" | "developer"; content: string }>;
  maxOutput: number;
}
export class ProviderError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function planPayload(p: InferenceInput) {
  return {
    model: p.model,
    instructions: p.instructions,
    input: p.input,
    store: false,
    stream: true,
  };
}
export function apiPayload(p: InferenceInput) {
  return { ...planPayload(p), max_output_tokens: p.maxOutput };
}
// Buffer until terminal completion. Neither partial text nor proposed actions become facts.
export async function readResponseStream(
  response: Response,
  signal?: AbortSignal,
): Promise<string> {
  if (!response.ok)
    throw new ProviderError(
      response.status === 429
        ? "quota"
        : response.status === 401
          ? "expired"
          : "unavailable",
      response.status === 429
        ? "Usage limit reached. No-AI remains available."
        : response.status === 401
          ? "Sign in again; this connection expired."
          : "The provider is unavailable. Your work is saved.",
    );
  if (!response.body)
    throw new ProviderError("stream", "The provider returned no stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    output = "",
    completed = false,
    bytes = 0;
  try {
    while (true) {
      if (signal?.aborted)
        throw new ProviderError("cancelled", "This request was cancelled.");
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000)
        throw new ProviderError(
          "limit",
          "The response exceeded the local safety limit.",
        );
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(
        /\r\n/g,
        "\n",
      );
      let pos;
      while ((pos = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, pos);
        buffer = buffer.slice(pos + 2);
        const data = event
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        let e: any;
        try {
          e = JSON.parse(data);
        } catch {
          throw new ProviderError(
            "stream",
            "The provider stream was malformed.",
          );
        }
        if (
          ["response.failed", "response.incomplete", "error"].includes(e.type)
        ) {
          const code = String(e.response?.error?.code ?? e.code ?? "stream");
          throw new ProviderError(
            code,
            code.includes("usage") || code.includes("quota")
              ? "Your plan usage is unavailable or exhausted. No-AI still works; no paid fallback was used."
              : "The response did not complete. Nothing was applied.",
          );
        }
        if (e.type === "response.output_text.delta") {
          if (completed)
            throw new ProviderError(
              "stream",
              "Unexpected text after completion.",
            );
          if (typeof e.delta !== "string")
            throw new ProviderError("stream", "Invalid text delta.");
          output += e.delta;
        }
        if (e.type === "response.completed") {
          if (e.response?.status && e.response.status !== "completed")
            throw new ProviderError("stream", "Completion status was invalid.");
          completed = true;
          if (!output && e.response?.output)
            output = e.response.output
              .flatMap((o: any) => o.content ?? [])
              .filter((c: any) => c.type === "output_text")
              .map((c: any) => c.text)
              .join("");
        }
      }
    }
    if (!completed)
      throw new ProviderError(
        "interrupted",
        "Connection ended before completion. Your saved work is unchanged.",
      );
    if (!output.trim())
      throw new ProviderError(
        "empty",
        "The provider completed without a text response.",
      );
    return output;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function infer(
  route: "plan" | "api",
  token: string,
  p: InferenceInput,
  signal: AbortSignal,
  network: typeof fetch = fetch,
) {
  const response = await network("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(route === "plan" ? planPayload(p) : apiPayload(p)),
    signal,
  });
  return readResponseStream(response, signal);
}
