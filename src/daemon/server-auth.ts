import type http from "node:http";
import { AuthRateLimiter } from "./auth-rate-limit.js";
import { daemonConfigTokens, isAuthorizedDaemonToken, type DaemonConfig } from "./config.js";
import { json, readBearerToken } from "./server-http.js";

export function authorizeDaemonRequest({
  req,
  res,
  pathname,
  cors,
  config,
  limiter,
}: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  pathname: string;
  cors: Record<string, string>;
  config: DaemonConfig;
  limiter: AuthRateLimiter;
}): boolean {
  if (!pathname.startsWith("/v1/")) return true;

  // Loopback in the common case; caller IP for 0.0.0.0 Windows-container binds.
  const clientKey = req.socket.remoteAddress ?? null;
  const preCheck = limiter.check(clientKey);
  if (!preCheck.allowed) {
    json(
      res,
      429,
      { ok: false, error: "too many auth failures" },
      { ...cors, "retry-after": String(preCheck.retryAfterSeconds) },
    );
    return false;
  }

  const token = readBearerToken(req);
  const authorized = token ? isAuthorizedDaemonToken(token, daemonConfigTokens(config)) : false;
  if (!authorized) {
    const decision = limiter.recordFailure(clientKey);
    const headers = decision.allowed
      ? cors
      : { ...cors, "retry-after": String(decision.retryAfterSeconds) };
    json(
      res,
      decision.allowed ? 401 : 429,
      {
        ok: false,
        error: decision.allowed ? "unauthorized" : "too many auth failures",
      },
      headers,
    );
    return false;
  }

  limiter.recordSuccess(clientKey);
  return true;
}
