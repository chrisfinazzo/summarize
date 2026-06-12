import path from "node:path";
import { pathToFileURL } from "node:url";
import { isYouTubeUrl } from "../content/index.js";
import type { ExtractedLinkContent } from "../content/index.js";
import { buildUrlPrompt } from "../engine/web-prompt.js";
import { resolveUrlSummaryExecution, type UrlSummaryResolution } from "../engine/web-summary.js";
import { MAX_PDF_EXTRACT_BYTES } from "../run/constants.js";
import { extractAssetContent } from "../run/flows/asset/extract.js";
import { executeMediaFile } from "../run/flows/asset/media.js";
import { executeAssetSummary } from "../run/flows/asset/summary.js";
import { executeUrlFlow } from "../run/flows/url/flow.js";
import type { UrlFlowContext } from "../run/flows/url/types.js";
import {
  readLastSuccessfulCliProvider,
  writeLastSuccessfulCliProvider,
} from "./cli-fallback-state.js";
import {
  bindSummarizeExecutionEvents,
  type PreparedSummarizeExecution,
} from "./execution-resources.js";
import {
  acquireLocalAssetInput,
  isPdfAssetPath,
  isTranscribableAssetPath,
} from "./input-acquisition.js";
import { createTempFileFromStdin } from "./stdin-input.js";
import type {
  AssetExecutionInput,
  AssetExtractionExecutionResult,
  AssetMediaExecutionResult,
  AssetSummaryExecutionResult,
  ExtractionResult,
  SummarizeEvent,
  SummarizeEventInput,
  SummarizeEventSink,
  SummarizeRequest,
  SummarizeResult,
  SummarizeRuntime,
  SummaryResult,
} from "./summarize-contracts.js";
import {
  toUrlSummaryPresentationResolution,
  type SummarizeExecutionDetails,
  type SummarizeExtractionDetails,
} from "./url-result.js";
import { createSummarizeRuntimeResources } from "./url-runtime.js";

const ignoreEvent: SummarizeEventSink = () => {};

function createVisiblePageContent(
  input: Extract<SummarizeRequest["input"], { kind: "visible-page" }>,
  cacheMode: SummarizeRuntime["cache"]["mode"],
): ExtractedLinkContent {
  let siteName: string | null = null;
  try {
    siteName = new URL(input.url).hostname || null;
  } catch {
    siteName = null;
  }

  return {
    url: input.url,
    title: input.title,
    description: null,
    siteName,
    content: input.text,
    truncated: input.truncated,
    totalCharacters: input.text.length,
    wordCount: input.text.trim() ? input.text.trim().split(/\s+/).length : 0,
    transcriptCharacters: null,
    transcriptLines: null,
    transcriptWordCount: null,
    transcriptSource: null,
    transcriptionProvider: null,
    transcriptMetadata: null,
    transcriptSegments: null,
    transcriptTimedText: null,
    mediaDurationSeconds: null,
    video: null,
    isVideoOnly: false,
    diagnostics: {
      strategy: "html",
      firecrawl: {
        attempted: false,
        used: false,
        cacheMode,
        cacheStatus: "unknown",
      },
      markdown: {
        requested: false,
        used: false,
        provider: null,
      },
      transcript: {
        cacheMode,
        cacheStatus: "unknown",
        textProvided: false,
        provider: null,
        attemptedProviders: [],
      },
    },
  };
}

async function executeVisiblePageSummary({
  ctx,
  input,
  cacheMode,
}: {
  ctx: UrlFlowContext;
  input: Extract<SummarizeRequest["input"], { kind: "visible-page" }>;
  cacheMode: SummarizeRuntime["cache"]["mode"];
}): Promise<{ extracted: ExtractedLinkContent; resolution: UrlSummaryResolution }> {
  const extracted = createVisiblePageContent(input, cacheMode);
  ctx.hooks.onExtracted?.(extracted);

  const prompt = buildUrlPrompt({
    extracted,
    outputLanguage: ctx.flags.outputLanguage,
    lengthArg: ctx.flags.lengthArg,
    promptOverride: ctx.flags.promptOverride ?? null,
    lengthInstruction: ctx.flags.lengthInstruction ?? null,
    languageInstruction: ctx.flags.languageInstruction ?? null,
  });

  const resolution = await resolveUrlSummaryExecution({
    ctx,
    url: input.url,
    extracted,
    prompt,
    onModelChosen: ctx.hooks.onModelChosen ?? null,
    runtime: {
      trace: (name, detail) => ctx.perfTrace?.mark(name, detail),
      onSummaryCached: ctx.hooks.onSummaryCached ?? null,
      readLastSuccessfulCliProvider: () => readLastSuccessfulCliProvider(ctx.io.envForRun),
      rememberCliProvider: (provider) =>
        writeLastSuccessfulCliProvider({ env: ctx.io.envForRun, provider }),
    },
  });
  return { extracted, resolution };
}

function emitResolvedSummary({
  resolution,
  extracted,
  emit,
}: {
  resolution: UrlSummaryResolution;
  extracted: ExtractedLinkContent;
  emit: SummarizeEventSink;
}): string {
  if (resolution.kind === "use-extracted") {
    emit({ type: "summary-delta", text: `${extracted.content}\n` });
    return extracted.content;
  }
  if (!resolution.summaryEmitted) {
    const normalized = resolution.normalizedSummary.replace(/^\n+/, "");
    emit({
      type: "summary-delta",
      text: normalized.endsWith("\n") ? normalized : `${normalized}\n`,
    });
  }
  return resolution.normalizedSummary;
}

function emitNormalizedSummary(summary: string, emit: SummarizeEventSink) {
  const normalized = summary.replace(/^\n+/, "");
  emit({
    type: "summary-delta",
    text: normalized.endsWith("\n") ? normalized : `${normalized}\n`,
  });
}

function toAssetExecutionInput(
  input: Extract<SummarizeRequest["input"], { kind: "resolved-asset" | "resolved-media" }>,
): AssetExecutionInput {
  return {
    kind: "asset",
    sourceKind: input.sourceKind,
    source: input.sourceLabel,
    mediaType: input.attachment.mediaType,
    filename: input.attachment.filename,
  };
}

function toEventInput(input: SummarizeRequest["input"]): SummarizeEventInput {
  if (input.kind === "resolved-asset" || input.kind === "resolved-media") {
    return {
      kind: input.kind,
      sourceKind: input.sourceKind,
      sourceLabel: input.sourceLabel,
      mediaType: input.attachment.mediaType,
      filename: input.attachment.filename,
    };
  }
  return input;
}

export async function executeSummarize(
  request: SummarizeRequest,
  runtime: SummarizeRuntime,
  events: SummarizeEventSink = ignoreEvent,
  prepared: PreparedSummarizeExecution | null = null,
): Promise<SummarizeResult> {
  const now = runtime.now ?? Date.now;
  const startedAt = now();
  let usedModel: string | null = null;
  let summaryFromCache = false;
  let summaryText = "";
  let normalizedSummary: string | null = null;
  let extracted: ExtractedLinkContent | null = null;
  let slides: ExtractionResult["slides"] = null;
  let summaryDetails: SummarizeExecutionDetails = { kind: "visible-page" };
  let extractionDetails: SummarizeExtractionDetails | null = null;
  let cleanupStdin: (() => Promise<void>) | null = null;

  const emit = (event: SummarizeEvent) => {
    if (event.type === "model-selected") {
      usedModel = event.modelId;
    } else if (event.type === "summary-cache") {
      summaryFromCache = event.cached;
    } else if (event.type === "content-extracted") {
      extracted = event.content;
    } else if (event.type === "slides-extracted") {
      slides = event.slides;
    } else if (event.type === "summary-delta") {
      summaryText += event.text;
    }
    events(event);
    if (event.type === "content-extracted" && !request.extractOnly) {
      events({ type: "summary-started" });
    }
  };

  emit({
    type: "run-started",
    runId: runtime.runId,
    input: toEventInput(request.input),
  });

  try {
    let executionInput = request.input;
    if (executionInput.kind === "stdin") {
      if (request.extractOnly) {
        throw new Error("--extract is not supported for piped stdin input");
      }
      const stdin = runtime.stdin;
      if (!stdin) {
        throw new Error("Stdin execution requires a readable input stream");
      }
      const temp = await createTempFileFromStdin({ stream: stdin });
      cleanupStdin = temp.cleanup;
      executionInput = { kind: "file", filePath: temp.filePath };
    }

    if (executionInput.kind === "file") {
      if (
        request.extractOnly &&
        !isTranscribableAssetPath(executionInput.filePath) &&
        !isPdfAssetPath(executionInput.filePath)
      ) {
        throw new Error(
          "--extract for local files is only supported for media files (MP3, MP4, WAV, etc.) and PDF files",
        );
      }
      if (request.slides && isTranscribableAssetPath(executionInput.filePath)) {
        executionInput = {
          kind: "url",
          url: pathToFileURL(executionInput.filePath).href,
          title: null,
          maxCharacters: null,
        };
      } else {
        emit({
          type: "input-progress",
          phase: "loading",
          source: executionInput.filePath,
          filename: path.basename(executionInput.filePath),
          mediaType: null,
          sizeBytes: null,
        });
        const acquired = await acquireLocalAssetInput({
          filePath: executionInput.filePath,
          ...(request.extractOnly && isPdfAssetPath(executionInput.filePath)
            ? { maxBytes: MAX_PDF_EXTRACT_BYTES }
            : {}),
        });
        emit({
          type: "input-progress",
          phase:
            acquired.kind === "resolved-media"
              ? "transcribing"
              : request.extractOnly
                ? "extracting"
                : "summarizing",
          source: acquired.sourceLabel,
          filename: acquired.attachment.filename,
          mediaType: acquired.attachment.mediaType,
          sizeBytes: acquired.sizeBytes,
        });
        executionInput = acquired;
      }
    }
    if (executionInput.kind === "file" || executionInput.kind === "stdin") {
      throw new Error("Internal error: raw input was not resolved");
    }

    const executionRequest =
      executionInput === request.input ? request : { ...request, input: executionInput };
    const boundPrepared = prepared
      ? bindSummarizeExecutionEvents(prepared, emit)
      : createSummarizeRuntimeResources({
          request: executionRequest,
          runtime,
          runStartedAtMs: startedAt,
          emit,
        });
    if (executionInput.kind === "resolved-media") {
      const assetSummaryContext = boundPrepared.assetSummaryContext;
      if (!assetSummaryContext) {
        throw new Error("Resolved media execution requires prepared asset resources");
      }
      if (!request.extractOnly) {
        emit({ type: "summary-started" });
      }
      const mediaResult = await executeMediaFile(assetSummaryContext, {
        sourceKind: executionInput.sourceKind,
        sourceLabel: executionInput.sourceLabel,
        attachment: executionInput.attachment,
        onModelChosen: (modelId) => emit({ type: "model-selected", modelId }),
      });
      if (mediaResult.kind === "summary") {
        if (!mediaResult.summary.summaryEmitted) {
          emitNormalizedSummary(mediaResult.summary.summary, emit);
        }
      }
      const report =
        mediaResult.kind === "summary" ? await assetSummaryContext.buildReport() : null;
      const result: AssetMediaExecutionResult = {
        kind: "asset-media",
        input: toAssetExecutionInput(executionInput),
        usedModel:
          usedModel ??
          (mediaResult.kind === "summary" ? (mediaResult.summary.llm?.model ?? null) : null),
        summaryFromCache:
          mediaResult.kind === "summary" ? mediaResult.summary.summaryFromCache : false,
        elapsedMs: now() - startedAt,
        report,
        costUsd:
          mediaResult.kind === "summary" ? await assetSummaryContext.estimateCostUsd() : null,
        details: mediaResult,
      };
      emit({ type: "run-completed", result });
      return result;
    }

    if (executionInput.kind === "resolved-asset") {
      const assetSummaryContext = boundPrepared.assetSummaryContext;
      if (!assetSummaryContext) {
        throw new Error("Resolved asset execution requires prepared asset resources");
      }
      if (request.extractOnly) {
        const extractedAsset = await extractAssetContent({
          ctx: {
            env: assetSummaryContext.env,
            envForRun: assetSummaryContext.envForRun,
            execFileImpl: assetSummaryContext.execFileImpl,
            timeoutMs: assetSummaryContext.timeoutMs,
            preprocessMode: assetSummaryContext.preprocessMode,
          },
          attachment: executionInput.attachment,
        });
        const report = assetSummaryContext.shouldComputeReport
          ? await assetSummaryContext.buildReport()
          : null;
        const result: AssetExtractionExecutionResult = {
          kind: "asset-extraction",
          input: toAssetExecutionInput(executionInput),
          extracted: extractedAsset,
          elapsedMs: now() - startedAt,
          report,
          costUsd:
            assetSummaryContext.metricsEnabled && report
              ? await assetSummaryContext.estimateCostUsd()
              : null,
        };
        emit({ type: "run-completed", result });
        return result;
      }
      emit({ type: "summary-started" });
      const assetResult = await executeAssetSummary(assetSummaryContext, {
        sourceKind: executionInput.sourceKind,
        sourceLabel: executionInput.sourceLabel,
        attachment: executionInput.attachment,
        onModelChosen: (modelId) => emit({ type: "model-selected", modelId }),
      });
      if (!assetResult.summaryEmitted) {
        emitNormalizedSummary(assetResult.summary, emit);
      }
      const result: AssetSummaryExecutionResult = {
        kind: "asset-summary",
        input: toAssetExecutionInput(executionInput),
        summary: assetResult.summary,
        usedModel: usedModel ?? assetResult.llm?.model ?? null,
        summaryFromCache: assetResult.summaryFromCache,
        elapsedMs: now() - startedAt,
        report: await assetSummaryContext.buildReport(),
        costUsd: await assetSummaryContext.estimateCostUsd(),
        details: assetResult,
      };
      emit({ type: "run-completed", result });
      return result;
    }

    if (request.extractOnly && executionInput.kind !== "url") {
      throw new Error("Extract-only execution requires a URL input");
    }

    const ctx = boundPrepared.urlFlowContext;

    if (executionInput.kind === "visible-page") {
      const visiblePageResult = await executeVisiblePageSummary({
        ctx,
        input: executionInput,
        cacheMode: runtime.cache.mode,
      });
      extracted = visiblePageResult.extracted;
      normalizedSummary = emitResolvedSummary({
        resolution: visiblePageResult.resolution,
        extracted,
        emit,
      });
    } else {
      emit({ type: "extraction-started", url: executionInput.url });
      const urlResult = await executeUrlFlow({
        ctx,
        url: executionInput.url,
        isYoutubeUrl: prepared?.isYoutubeUrl ?? isYouTubeUrl(executionInput.url),
      });
      extracted = urlResult.extracted;
      if (!slides) slides = urlResult.slides;
      if (!request.extractOnly) {
        if (urlResult.kind === "extraction") {
          throw new Error("Internal error: summary execution returned extraction result");
        }
        if (urlResult.kind === "summary") {
          summaryDetails = {
            kind: "url-summary",
            prompt: urlResult.prompt,
            effectiveMarkdownMode: urlResult.effectiveMarkdownMode,
            resolution: toUrlSummaryPresentationResolution(urlResult.resolution),
          };
          normalizedSummary = emitResolvedSummary({
            resolution: urlResult.resolution,
            extracted,
            emit,
          });
        } else {
          summaryDetails = {
            kind: "delegated-asset",
            summaryEmitted: urlResult.summary.summaryEmitted,
          };
          normalizedSummary = urlResult.summary.summary;
          if (!urlResult.summary.summaryEmitted) {
            emitNormalizedSummary(normalizedSummary, emit);
          }
        }
      } else if (urlResult.kind === "extraction") {
        extractionDetails = {
          kind: "url-extraction",
          prompt: urlResult.prompt,
          effectiveMarkdownMode: urlResult.effectiveMarkdownMode,
        };
      }
    }

    if (!extracted) {
      throw new Error("Internal error: missing extracted content");
    }

    if (request.extractOnly) {
      if (!extractionDetails) {
        throw new Error("Internal error: missing extraction details");
      }
      const result: ExtractionResult = {
        kind: "extraction",
        input: executionInput as Extract<SummarizeRequest["input"], { kind: "url" }>,
        extracted,
        slides,
        details: extractionDetails,
      };
      emit({ type: "run-completed", result });
      return result;
    }

    const result: SummaryResult = {
      kind: "summary",
      input: executionInput,
      summary: normalizedSummary ?? summaryText.replace(/\n$/, ""),
      usedModel: usedModel ?? ctx.model.requestedModelLabel,
      extracted,
      slides,
      summaryFromCache,
      elapsedMs: now() - startedAt,
      report: await ctx.hooks.buildReport(),
      costUsd: await ctx.hooks.estimateCostUsd(),
      details: summaryDetails,
    };
    emit({ type: "run-completed", result });
    return result;
  } catch (error) {
    emit({ type: "run-failed", error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    await cleanupStdin?.();
  }
}
