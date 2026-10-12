export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: any,
  ) {
    super(message);
  }
}
export async function api(path: string, body?: unknown) {
  const response = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-Beside": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await response.json();
  if (!response.ok)
    throw new ApiError(
      data.error ?? "Something did not save. Try again.",
      response.status,
      data,
    );
  return data;
}
