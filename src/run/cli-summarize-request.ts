import { createRunConfigInput } from "../application/config-state.js";
import type { SummarizeRunInput, SummarizeRunRequest } from "../application/run-spec.js";
import type { CliProvider } from "../config.js";
import type { InputTarget } from "../content/asset.js";
import type { SlideSettings } from "../slides/index.js";
import type { RunOverrides } from "./run-settings.js";
import { createEmptyRunOverrides } from "./run-settings.js";
import type { RunnerFlagResolution } from "./runner-flags.js";

function toSummarizeInput(
  input: InputTarget,
  maxExtractCharacters: number | null,
): SummarizeRunInput {
  if (input.kind === "url") {
    return {
      kind: "url",
      url: input.url,
      title: null,
      maxCharacters: maxExtractCharacters,
    };
  }
  if (input.kind === "file") {
    return { kind: "file", filePath: input.filePath };
  }
  return { kind: "stdin" };
}

export function createCliSummarizeRequest(options: {
  input: InputTarget;
  maxExtractCharacters: number | null;
  modelOverride: string | null;
  promptOverride: string | null;
  lengthRaw: unknown;
  languageRaw: unknown;
  format: "text" | "markdown";
  overrides: RunOverrides;
  extractOnly: boolean;
  slides: SlideSettings | null;
}): SummarizeRunRequest {
  return {
    input: toSummarizeInput(options.input, options.maxExtractCharacters),
    modelOverride: options.modelOverride,
    promptOverride: options.promptOverride,
    lengthRaw: options.lengthRaw,
    languageRaw: options.languageRaw,
    format: options.format,
    overrides: options.overrides,
    extractOnly: options.extractOnly,
    slides: options.slides,
  };
}

export function createCliSummarizeResolution(options: {
  input: InputTarget;
  programOpts: Record<string, unknown>;
  flags: RunnerFlagResolution;
  cliFlagPresent: boolean;
  cliProvider: CliProvider | null;
  modelOverride: string | null;
  promptOverride: string | null;
}) {
  const { programOpts, flags } = options;
  const languageRaw =
    typeof programOpts.language === "string"
      ? programOpts.language
      : typeof programOpts.lang === "string"
        ? programOpts.lang
        : null;
  const overrides: RunOverrides = {
    ...createEmptyRunOverrides(),
    firecrawlMode: flags.requestedFirecrawlMode,
    markdownMode: flags.markdownMode,
    preprocessMode: flags.preprocessMode,
    youtubeMode: flags.youtubeMode,
    transcriptTimestamps: Boolean(programOpts.timestamps),
    transcriptDiarization: flags.diarizationMode,
    forceSummary: flags.forceSummary,
    timeoutMs: flags.timeoutMs,
    retries: flags.retries,
    maxOutputTokensArg: flags.maxOutputTokensArg,
    transcriber: flags.transcriber,
  };

  return {
    request: createCliSummarizeRequest({
      input: options.input,
      maxExtractCharacters: flags.maxExtractCharacters,
      modelOverride: options.modelOverride,
      promptOverride: options.promptOverride,
      lengthRaw: flags.lengthExplicitlySet ? programOpts.length : null,
      languageRaw: flags.languageExplicitlySet ? languageRaw : null,
      format: flags.format,
      overrides,
      extractOnly: flags.extractMode,
      slides: null,
    }),
    configInput: createRunConfigInput({
      languageRaw,
      languageExplicit: flags.languageExplicitlySet,
      videoModeRaw: typeof programOpts.videoMode === "string" ? programOpts.videoMode : "auto",
      videoModeExplicit: flags.videoModeExplicitlySet,
      embeddedVideoModeRaw:
        typeof programOpts.embeddedVideo === "string" ? programOpts.embeddedVideo : "auto",
      embeddedVideoModeExplicit: flags.embeddedVideoExplicitlySet,
      cliFlagPresent: options.cliFlagPresent,
      cliProvider: options.cliProvider,
      fast: programOpts.fast === true,
      serviceTierRaw: typeof programOpts.serviceTier === "string" ? programOpts.serviceTier : null,
      thinkingRaw: typeof programOpts.thinking === "string" ? programOpts.thinking : null,
    }),
  };
}
