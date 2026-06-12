import { describe, expect, it, vi } from "vitest";
import type { SummarizeResult, SummarizeRuntime } from "../src/application/summarize-contracts.js";
import type { UrlFlowContext } from "../src/run/flows/url/types.js";
import { createEmptyRunOverrides } from "../src/run/run-settings.js";
import type { SlideSettings } from "../src/slides/index.js";

const mocks = vi.hoisted(() => ({
  executeSummarize: vi.fn(),
  presentCliSummarizeResult: vi.fn(),
}));

vi.mock("../src/application/execute-summarize.js", () => ({
  executeSummarize: mocks.executeSummarize,
}));
vi.mock("../src/run/cli-summarize-output.js", () => ({
  presentCliSummarizeResult: mocks.presentCliSummarizeResult,
}));

import { createCliUrlSummaryExecutor } from "../src/run/cli-summarize-execution.js";

describe("CLI summarize execution", () => {
  it("adapts planned inputs to URL application execution and presentation", async () => {
    const result = { kind: "summary" } as SummarizeResult;
    mocks.executeSummarize.mockResolvedValue(result);
    const runtime = {
      runId: "cli-1",
      env: {},
      fetch: globalThis.fetch,
      execFile: vi.fn(),
      cache: { mode: "bypass", store: null, ttlMs: 0, maxBytes: 0, path: null },
      mediaCache: null,
    } as SummarizeRuntime;
    const ctx = {} as UrlFlowContext;
    const slides: SlideSettings = {
      enabled: true,
      ocr: false,
      outputDir: "/tmp/slides",
      sceneThreshold: 0.3,
      autoTuneThreshold: true,
      maxSlides: 6,
      minDurationSeconds: 2,
    };
    const execute = createCliUrlSummaryExecutor({
      baseRequest: {
        input: { kind: "file", filePath: "/tmp/input.pdf" },
        modelOverride: "openai/gpt-5.4",
        promptOverride: "Prompt",
        lengthRaw: "medium",
        languageRaw: "French",
        format: "markdown",
        overrides: createEmptyRunOverrides(),
        extractOnly: true,
        slides: null,
      },
      runtime,
      slides,
      maxExtractCharacters: 12_000,
    });

    await execute({
      ctx,
      url: "https://example.com/article",
      isYoutubeUrl: true,
    });

    expect(mocks.executeSummarize).toHaveBeenCalledWith(
      {
        input: {
          kind: "url",
          url: "https://example.com/article",
          title: null,
          maxCharacters: 12_000,
        },
        modelOverride: "openai/gpt-5.4",
        promptOverride: "Prompt",
        lengthRaw: "medium",
        languageRaw: "French",
        format: "markdown",
        overrides: expect.any(Object),
        extractOnly: true,
        slides,
      },
      runtime,
      undefined,
      { urlFlowContext: ctx, isYoutubeUrl: true },
    );
    expect(mocks.presentCliSummarizeResult).toHaveBeenCalledWith({ ctx, result });
  });
});
