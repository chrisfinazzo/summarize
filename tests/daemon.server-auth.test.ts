import type http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { AuthRateLimiter } from "../src/daemon/auth-rate-limit.js";
import type { DaemonConfig } from "../src/daemon/config.js";
import { authorizeDaemonRequest } from "../src/daemon/server-auth.js";

const config: DaemonConfig = {
  version: 2,
  token: "primary-token-1234",
  tokens: ["primary-token-1234", "secondary-token-5678"],
  port: 8787,
  env: {},
  installedAt: "2026-06-12T00:00:00.000Z",
};

function createRequest(token?: string, remoteAddress = "127.0.0.1") {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    socket: { remoteAddress },
  } as http.IncomingMessage;
}

function createResponse() {
  const response = {
    writeHead: vi.fn(),
    end: vi.fn(),
  };
  return response as unknown as http.ServerResponse & typeof response;
}

function readResponse(response: ReturnType<typeof createResponse>) {
  return {
    status: response.writeHead.mock.calls[0]?.[0] as number,
    headers: response.writeHead.mock.calls[0]?.[1] as Record<string, string>,
    body: JSON.parse(String(response.end.mock.calls[0]?.[0])) as Record<string, unknown>,
  };
}

describe("daemon server auth", () => {
  it("allows non-v1 routes without credentials", () => {
    const response = createResponse();
    expect(
      authorizeDaemonRequest({
        req: createRequest(),
        res: response,
        pathname: "/health",
        cors: {},
        config,
        limiter: new AuthRateLimiter(),
      }),
    ).toBe(true);
    expect(response.writeHead).not.toHaveBeenCalled();
  });

  it("accepts every configured token and clears prior failures", () => {
    const limiter = new AuthRateLimiter({ maxFailures: 2 });
    expect(
      authorizeDaemonRequest({
        req: createRequest("invalid-token-1234"),
        res: createResponse(),
        pathname: "/v1/ping",
        cors: {},
        config,
        limiter,
      }),
    ).toBe(false);

    for (const token of config.tokens) {
      expect(
        authorizeDaemonRequest({
          req: createRequest(token),
          res: createResponse(),
          pathname: "/v1/ping",
          cors: {},
          config,
          limiter,
        }),
      ).toBe(true);
    }

    const response = createResponse();
    expect(
      authorizeDaemonRequest({
        req: createRequest("still-invalid-1234"),
        res: response,
        pathname: "/v1/ping",
        cors: {},
        config,
        limiter,
      }),
    ).toBe(false);
    expect(readResponse(response).status).toBe(401);
  });

  it("returns lockout responses with retry-after", () => {
    const limiter = new AuthRateLimiter({ maxFailures: 1, lockoutMs: 5000 });
    const response = createResponse();
    expect(
      authorizeDaemonRequest({
        req: createRequest("invalid-token-1234"),
        res: response,
        pathname: "/v1/ping",
        cors: { vary: "Origin" },
        config,
        limiter,
      }),
    ).toBe(false);
    expect(readResponse(response)).toMatchObject({
      status: 429,
      headers: { vary: "Origin", "retry-after": "5" },
      body: { ok: false, error: "too many auth failures" },
    });

    const blockedResponse = createResponse();
    expect(
      authorizeDaemonRequest({
        req: createRequest(config.token),
        res: blockedResponse,
        pathname: "/v1/ping",
        cors: {},
        config,
        limiter,
      }),
    ).toBe(false);
    expect(readResponse(blockedResponse).status).toBe(429);
  });
});
