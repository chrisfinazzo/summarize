import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CacheState } from "../src/cache.js";
import type { ExtractedLinkContent } from "../src/content/index.js";
import { createUrlSlidesSession } from "../src/run/flows/url/slides-session.js";
import { resolveSlideSettings } from "../src/slides/settings.js";
import type { SlideExtractionResult } from "../src/slides/types.js";
import { createTestSummarizeUrlFlowContext } from "./helpers/application-summarize.js";

vi.mock("../src/slides/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/slides/index.js")>("../src/slides/index.js");
  return {
    ...actual,
    extractSlidesForSource: vi.fn(),
  };
});

import { executeUrlFlow } from "../src/run/flows/url/flow.js";
import * as slidesModule from "../src/slides/index.js";

const extractSlidesForSource = vi.mocked(slidesModule.extractSlidesForSource);

const makeSlides = (url: string): SlideExtractionResult => ({
  sourceUrl: url,
  sourceKind: "youtube",
  sourceId: "abc123def45",
  slidesDir: "/tmp/slides",
  sceneThreshold: 0.3,
  autoTuneThreshold: true,
  autoTune: { enabled: false, chosenThreshold: 0, confidence: 0, strategy: "none" },
  maxSlides: 100,
  minSlideDuration: 2,
  ocrRequested: false,
  ocrAvailable: false,
  slides: [{ index: 1, timestamp: 1.2, imagePath: "/tmp/slide_0001.png" }],
  warnings: [],
});

const makeExtracted = (url: string): ExtractedLinkContent => ({
  url,
  title: "Video",
  description: null,
  siteName: "YouTube",
  content: "Transcript:\n[0:00] intro\n[3:40] ending",
  truncated: false,
  totalCharacters: 64,
  wordCount: 8,
  transcriptCharacters: 38,
  transcriptLines: 2,
  transcriptWordCount: 6,
  transcriptSource: "captionTracks",
  transcriptionProvider: null,
  transcriptMetadata: null,
  transcriptSegments: [
    { startMs: 0, endMs: 3_000, text: "intro" },
    { startMs: 220_000, endMs: 223_000, text: "ending" },
  ],
  transcriptTimedText: "[0:00] intro\n[3:40] ending",
  mediaDurationSeconds: 240,
  video: { kind: "youtube", url },
  isVideoOnly: false,
  diagnostics: {
    strategy: "html",
    firecrawl: { attempted: false, used: false, cacheMode: "bypass", cacheStatus: "unknown" },
    markdown: { requested: false, used: false, provider: null },
    transcript: {
      cacheMode: "bypass",
      cacheStatus: "unknown",
      textProvided: true,
      provider: "captionTracks",
      attemptedProviders: ["captionTracks"],
    },
  },
});

const waitForResult = async (
  getter: () => { ok: boolean; error?: string | null } | null,
  timeoutMs = 5000,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("timed out waiting for slides done hook"));
    }, timeoutMs);
    const poll = () => {
      if (getter()) {
        clearTimeout(timer);
        resolve();
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });

afterEach(() => {
  vi.resetAllMocks();
});

describe("executeUrlFlow slides done hook", () => {
  it("emits a planned slide timeline before video extraction resolves", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-planned-slides-"));
    const url = "https://www.youtube.com/watch?v=abc123def45";
    const slides = resolveSlideSettings({ slides: true, cwd: root });
    expect(slides).not.toBeNull();
    if (!slides) {
      throw new Error("Expected slides settings to be available.");
    }

    let resolveExtraction: ((value: SlideExtractionResult) => void) | null = null;
    extractSlidesForSource.mockImplementationOnce(
      () =>
        new Promise<SlideExtractionResult>((resolve) => {
          resolveExtraction = resolve;
        }),
    );

    const events: Array<
      { kind: "timeline"; count: number; hasImages: boolean } | { kind: "done" }
    > = [];
    const ctx = createTestSummarizeUrlFlowContext({
      env: { HOME: root, OPENAI_API_KEY: "test" },
      fetchImpl: globalThis.fetch.bind(globalThis),
      cache: { mode: "bypass", store: null, ttlMs: 0, maxBytes: 0, path: null },
      mediaCache: null,
      modelOverride: "openai/gpt-5.2",
      promptOverride: null,
      lengthRaw: "short",
      languageRaw: "auto",
      maxExtractCharacters: null,
      slides,
      hooks: {
        onSlidesExtracted: (result) => {
          events.push({
            kind: "timeline",
            count: result.slides.length,
            hasImages: result.slides.some((slide) => Boolean(slide.imagePath)),
          });
        },
        onSlidesDone: () => {
          events.push({ kind: "done" });
        },
      },
      runStartedAtMs: Date.now(),
      stdoutSink: { writeChunk: () => {} },
    });

    const session = createUrlSlidesSession({
      ctx,
      url,
      extracted: makeExtracted(url),
      cacheStore: null,
      progressStatus: { clearSlides: () => {}, setSlides: () => {} },
      renderStatus: (label) => label,
      renderStatusFromText: (text) => text,
      updateSummaryProgress: () => {},
    });

    await expect(session.slidesTimelinePromise).resolves.toMatchObject({
      slides: expect.arrayContaining([{ index: 1, timestamp: 0, imagePath: "" }]),
    });
    expect(extractSlidesForSource).not.toHaveBeenCalled();
    expect(events[0]).toEqual({ kind: "timeline", count: 6, hasImages: false });

    const extractionPromise = session.runSlidesExtraction();
    expect(extractSlidesForSource).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ kind: "timeline", count: 6, hasImages: false }]);
    resolveExtraction?.(makeSlides(url));
    await expect(extractionPromise).resolves.toMatchObject({
      slides: [{ index: 1, timestamp: 1.2, imagePath: "/tmp/slide_0001.png" }],
    });
    expect(events).toContainEqual({ kind: "timeline", count: 1, hasImages: true });
    expect(events.at(-1)).toEqual({ kind: "done" });
  });

  it("keeps yt-dlp available for guarded YouTube slides", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-slides-done-"));
    const binDir = join(root, "bin");
    mkdirSync(binDir);
    const ytDlpPath = join(binDir, "yt-dlp");
    writeFileSync(ytDlpPath, "#!/bin/sh\nexit 0\n");
    chmodSync(ytDlpPath, 0o755);
    const url = "https://www.youtube.com/watch?v=abc123def45";
    const content =
      "<!doctype html><html><head><title>Video</title></head><body>Test</body></html>";

    extractSlidesForSource.mockImplementationOnce(async (options) => {
      if (!options.ytDlpPath) {
        throw new Error("Slides for YouTube require yt-dlp (set YT_DLP_PATH or install yt-dlp).");
      }
      return makeSlides(url);
    });

    const fetchImpl: typeof fetch = async (input) => {
      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (requestUrl !== url) {
        throw new Error(`unexpected fetch: ${requestUrl}`);
      }
      return new Response(content, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    };

    const cache: CacheState = {
      mode: "bypass",
      store: null,
      ttlMs: 0,
      maxBytes: 0,
      path: null,
    };

    const slides = resolveSlideSettings({ slides: true, cwd: root });
    expect(slides).not.toBeNull();
    if (!slides) {
      throw new Error("Expected slides settings to be available.");
    }

    let doneResult: { ok: boolean; error?: string | null } | null = null;
    const mediaCache = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => null),
    };

    const ctx = createTestSummarizeUrlFlowContext({
      env: { HOME: root, OPENAI_API_KEY: "test", PATH: binDir },
      fetchImpl,
      urlFetchImpl: fetchImpl,
      cache,
      mediaCache,
      modelOverride: "openai/gpt-5.2",
      promptOverride: null,
      lengthRaw: "short",
      languageRaw: "auto",
      maxExtractCharacters: null,
      slides,
      hooks: {
        onSlidesDone: (result) => {
          doneResult = result;
        },
      },
      runStartedAtMs: Date.now(),
      stdoutSink: { writeChunk: () => {} },
    });

    ctx.flags.extractMode = true;

    await executeUrlFlow({ ctx, url, isYoutubeUrl: true });

    await waitForResult(() => doneResult);
    expect(doneResult?.ok).toBe(true);
    const call = extractSlidesForSource.mock.calls[0]?.[0];
    expect(call?.mediaCache).toBe(mediaCache);
    expect(call?.ytDlpPath).toBe(ytDlpPath);
    expect(call?.disableYtDlpAutoResolve).toBe(true);
    expect(call?.allowRemoteUrlFallback).toBe(false);
  });

  it("emits error when slides extraction fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "summarize-slides-done-"));
    const url = "https://www.youtube.com/watch?v=abc123def45";
    const content =
      "<!doctype html><html><head><title>Video</title></head><body>Test</body></html>";

    extractSlidesForSource.mockRejectedValueOnce(new Error("slides failed"));

    const fetchImpl: typeof fetch = async (input) => {
      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (requestUrl !== url) {
        throw new Error(`unexpected fetch: ${requestUrl}`);
      }
      return new Response(content, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    };

    const cache: CacheState = {
      mode: "bypass",
      store: null,
      ttlMs: 0,
      maxBytes: 0,
      path: null,
    };

    const slides = resolveSlideSettings({ slides: true, cwd: root });
    expect(slides).not.toBeNull();
    if (!slides) {
      throw new Error("Expected slides settings to be available.");
    }

    let doneResult: { ok: boolean; error?: string | null } | null = null;

    const ctx = createTestSummarizeUrlFlowContext({
      env: { HOME: root, OPENAI_API_KEY: "test" },
      fetchImpl,
      cache,
      modelOverride: "openai/gpt-5.2",
      promptOverride: null,
      lengthRaw: "short",
      languageRaw: "auto",
      maxExtractCharacters: null,
      slides,
      hooks: {
        onSlidesDone: (result) => {
          doneResult = result;
        },
      },
      runStartedAtMs: Date.now(),
      stdoutSink: { writeChunk: () => {} },
    });

    ctx.flags.extractMode = true;

    await executeUrlFlow({ ctx, url, isYoutubeUrl: true });

    await waitForResult(() => doneResult);
    expect(doneResult?.ok).toBe(false);
    expect(doneResult?.error).toContain("slides failed");
  });
});
