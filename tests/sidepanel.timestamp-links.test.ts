import { describe, expect, it } from "vitest";
import {
  linkifyTimestamps,
  parseTimestampHref,
  parseTimestampSeconds,
} from "../apps/chrome-extension/src/entrypoints/sidepanel/timestamp-links";

describe("sidepanel timestamp links", () => {
  it("parses valid clock timestamps", () => {
    expect(parseTimestampSeconds("0:01")).toBe(1);
    expect(parseTimestampSeconds("12:34")).toBe(754);
    expect(parseTimestampSeconds("1:02:03")).toBe(3723);
  });

  it("rejects malformed clock timestamps", () => {
    expect(parseTimestampSeconds("1:60")).toBeNull();
    expect(parseTimestampSeconds("1:02:60")).toBeNull();
    expect(parseTimestampSeconds("1:60:00")).toBeNull();
    expect(parseTimestampSeconds("1:02junk")).toBeNull();
  });

  it("does not linkify malformed timestamps", () => {
    expect(linkifyTimestamps("[0:59] ok [1:60] bad [1:02:60] bad")).toBe(
      "[0:59](timestamp:59) ok [1:60] bad [1:02:60] bad",
    );
  });

  it("rejects invalid timestamp hrefs", () => {
    expect(parseTimestampHref("timestamp:12")).toBe(12);
    expect(parseTimestampHref("http://example.test/timestamp:12")).toBeNull();
    expect(parseTimestampHref("timestamp:")).toBeNull();
    expect(parseTimestampHref("timestamp:12junk")).toBeNull();
    expect(parseTimestampHref("timestamp:12.5")).toBeNull();
    expect(parseTimestampHref("timestamp:1e3")).toBeNull();
    expect(parseTimestampHref("timestamp:0x10")).toBeNull();
    expect(parseTimestampHref("timestamp:Infinity")).toBeNull();
  });
});
