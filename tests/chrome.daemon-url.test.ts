import { describe, expect, it } from "vitest";
import { daemonOrigin } from "../apps/chrome-extension/src/lib/daemon-url";

describe("extension daemon URL", () => {
  it("canonicalizes the default HTTP port", () => {
    expect(daemonOrigin("80")).toBe("http://127.0.0.1");
  });

  it("keeps non-default ports explicit", () => {
    expect(daemonOrigin("8787")).toBe("http://127.0.0.1:8787");
  });
});
