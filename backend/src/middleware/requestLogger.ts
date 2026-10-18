import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { log } from "../lib/logger";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's own documented pattern for augmenting its Request type via declaration merging; there is no ES module equivalent for extending a third-party ambient namespace.
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

type LogLevel = "info" | "warn" | "error";

function levelForStatus(status: number): LogLevel {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

/**
 * Structured (JSON) request logging middleware.
 *
 * - Attaches a `requestId` to every request — honouring an inbound
 *   `X-Request-Id` so upstream proxies can correlate, otherwise generating a
 *   fresh UUID — and echoes it back via the `X-Request-Id` response header.
 * - Emits exactly one structured log line per request containing method,
 *   path, status, duration and request id.
 * - Never logs request bodies, headers, query strings, cookies or auth
 *   material, so secrets and PII cannot leak into the logs. Only the safe
 *   path (no query string) and method are recorded.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  req.requestId = (req.header("x-request-id") || randomUUID()).slice(0, 64);

  res.setHeader("X-Request-Id", req.requestId);

  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    log(levelForStatus(res.statusCode), "request completed", {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
    });
  });

  next();
}