import type { CacheState } from "../cache.js";
import type {
  ExtractedLinkContent,
  LinkPreviewProgressEvent,
  MediaCache,
} from "../content/index.js";
import type { RunMetricsReport } from "../costs.js";
import type { ExecFileFn } from "../markitdown.js";
import type { RunOverrides } from "../run/run-settings.js";
import type {
  SlideExtractionResult,
  SlideImage,
  SlideSettings,
  SlideSourceKind,
} from "../slides/index.js";

export type SummarizeInput =
  | {
      kind: "visible-page";
      url: string;
      title: string | null;
      text: string;
      truncated: boolean;
    }
  | {
      kind: "url";
      url: string;
      title: string | null;
      maxCharacters: number | null;
    };

export type SummarizeRequest = {
  input: SummarizeInput;
  modelOverride: string | null;
  promptOverride: string | null;
  lengthRaw: unknown;
  languageRaw: unknown;
  format: "text" | "markdown";
  overrides: RunOverrides;
  extractOnly: boolean;
  slides: SlideSettings | null;
};

export type SummarizeRuntime = {
  runId: string;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  urlFetch?: typeof fetch | null;
  execFile: ExecFileFn;
  cache: CacheState;
  mediaCache: MediaCache | null;
  now?: (() => number) | null;
};

export type SummarizeEvent =
  | { type: "run-started"; runId: string; input: SummarizeInput }
  | { type: "extraction-started"; url: string }
  | { type: "extraction-progress"; event: LinkPreviewProgressEvent }
  | { type: "content-extracted"; content: ExtractedLinkContent }
  | { type: "summary-started" }
  | { type: "model-selected"; modelId: string }
  | { type: "summary-cache"; cached: boolean }
  | { type: "summary-delta"; text: string }
  | { type: "slides-progress"; text: string }
  | { type: "slides-extracted"; slides: SlideExtractionResult }
  | { type: "slides-completed"; ok: boolean; error?: string | null }
  | {
      type: "slide";
      slide: SlideImage;
      meta: {
        slidesDir: string;
        sourceUrl: string;
        sourceId: string;
        sourceKind: SlideSourceKind;
        ocrAvailable: boolean;
      };
    }
  | { type: "run-completed"; result: SummarizeResult }
  | { type: "run-failed"; error: string };

export type SummarizeEventSink = (event: SummarizeEvent) => void;

export type SummaryResult = {
  kind: "summary";
  input: SummarizeInput;
  summary: string;
  usedModel: string;
  extracted: ExtractedLinkContent;
  summaryFromCache: boolean;
  elapsedMs: number;
  report: RunMetricsReport;
  costUsd: number | null;
};

export type ExtractionResult = {
  kind: "extraction";
  input: Extract<SummarizeInput, { kind: "url" }>;
  extracted: ExtractedLinkContent;
  slides: SlideExtractionResult | null;
};

export type SummarizeResult = SummaryResult | ExtractionResult;
