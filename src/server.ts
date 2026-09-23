import "./lib/error-capture";

import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

const startHandler = createStartHandler(defaultStreamHandler);

type ErrorLike = {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  cause?: unknown;
};

function isRequestCancellation(error: unknown): boolean {
  let current = error;
  const seen = new Set<unknown>();

  while (current && !seen.has(current)) {
    seen.add(current);
    if (typeof current !== "object") return false;

    const value = current as ErrorLike;
    if (value.name === "AbortError" || value.code === "ECONNRESET") return true;
    if (typeof value.message === "string" && /^abort(?:ed)?$/i.test(value.message.trim())) {
      return true;
    }
    current = value.cause;
  }

  return false;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  request: Request,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  const capturedError = consumeLastCapturedError();
  if (request.signal.aborted || isRequestCancellation(capturedError)) return response;

  console.error(capturedError ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request) {
    try {
      const response = await startHandler(request);
      return await normalizeCatastrophicSsrResponse(response, request);
    } catch (error) {
      if (request.signal.aborted || isRequestCancellation(error)) {
        return new Response(null, { status: 499, statusText: "Client Closed Request" });
      }
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
