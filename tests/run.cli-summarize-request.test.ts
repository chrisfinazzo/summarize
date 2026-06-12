import { describe, expect, it } from "vitest";
import {
  createCliSummarizeRequest,
  createCliSummarizeResolution,
} from "../src/run/cli-summarize-request.js";
import { createEmptyRunOverrides } from "../src/run/run-settings.js";
import type { RunnerFlagResolution } from "../src/run/runner-flags.js";

const base = {
  maxExtractCharacters: 12_000,
  modelOverride: "openai/gpt-5.4",
  promptOverride: "Prompt",
  lengthRaw: "medium",
  languageRaw: "French",
  format: "markdown" as const,
  overrides: createEmptyRunOverrides(),
  extractOnly: false,
  slides: null,
};

describe("CLI summarize request", () => {
  it("normalizes URL inputs", () => {
    expect(
      createCliSummarizeRequest({
        ...base,
        input: { kind: "url", url: "https://example.com/" },
      }),
    ).toMatchObject({
      input: {
        kind: "url",
        url: "https://example.com/",
        title: null,
        maxCharacters: 12_000,
      },
      modelOverride: "openai/gpt-5.4",
      format: "markdown",
    });
  });

  it("normalizes file and stdin inputs without adapter resources", () => {
    expect(
      createCliSummarizeRequest({
        ...base,
        input: { kind: "file", filePath: "/tmp/input.pdf" },
      }).input,
    ).toEqual({ kind: "file", filePath: "/tmp/input.pdf" });
    expect(
      createCliSummarizeRequest({
        ...base,
        input: { kind: "stdin" },
      }).input,
    ).toEqual({ kind: "stdin" });
  });

  it("translates parsed CLI flags into request and config inputs", () => {
    const flags = {
      requestedFirecrawlMode: "auto",
      markdownMode: "llm",
      preprocessMode: "always",
      youtubeMode: "yt-dlp",
      diarizationMode: "openai",
      forceSummary: true,
      timeoutMs: 4_000,
      retries: 2,
      maxOutputTokensArg: 512,
      transcriber: "parakeet",
      maxExtractCharacters: 8_000,
      lengthExplicitlySet: true,
      languageExplicitlySet: true,
      format: "markdown",
      extractMode: false,
      videoModeExplicitlySet: true,
      embeddedVideoExplicitlySet: true,
    } as RunnerFlagResolution;

    const resolution = createCliSummarizeResolution({
      input: { kind: "url", url: "https://example.com/" },
      programOpts: {
        length: "medium",
        language: "French",
        timestamps: true,
        videoMode: "transcript",
        embeddedVideo: "prefer",
        fast: true,
        thinking: "high",
      },
      flags,
      cliFlagPresent: true,
      cliProvider: null,
      modelOverride: "auto",
      promptOverride: null,
    });

    expect(resolution.request).toMatchObject({
      input: { kind: "url", maxCharacters: 8_000 },
      lengthRaw: "medium",
      languageRaw: "French",
      overrides: {
        firecrawlMode: "auto",
        markdownMode: "llm",
        transcriptTimestamps: true,
        transcriptDiarization: "openai",
        maxOutputTokensArg: 512,
        transcriber: "parakeet",
      },
    });
    expect(resolution.configInput).toMatchObject({
      languageRaw: "French",
      languageExplicit: true,
      videoModeRaw: "transcript",
      videoModeExplicit: true,
      embeddedVideoModeRaw: "prefer",
      embeddedVideoModeExplicit: true,
      cliFlagPresent: true,
      fast: true,
      thinkingRaw: "high",
    });
  });
});
