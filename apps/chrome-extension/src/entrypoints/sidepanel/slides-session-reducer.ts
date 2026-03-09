import {
  buildEmptySlidesSessionDerivedState,
  canSetSlidesSessionTextMode,
  deriveSlidesSessionState,
} from "./slides-session-derive";
import type {
  SlideLike,
  SlidesSessionRawState,
  SlidesSessionSnapshot,
  SlidesSessionState,
  SlidesSessionSummaryOpts,
} from "./slides-session-types";
import type { SlideTextMode } from "./slides-state";

export type SlidesSessionAction =
  | { type: "reset" }
  | { type: "summary-source:clear" }
  | { type: "summary:apply"; markdown: string; opts?: SlidesSessionSummaryOpts }
  | { type: "text-mode:set"; value: SlideTextMode }
  | { type: "transcript:set"; value: string | null };

export function buildInitialSlidesSessionRawState(): SlidesSessionRawState {
  return {
    summaryMarkdown: "",
    summarySource: null,
    textMode: "transcript",
    transcriptTimedText: null,
  };
}

export function buildInitialSlidesSessionState(): SlidesSessionState {
  return {
    raw: buildInitialSlidesSessionRawState(),
    derived: buildEmptySlidesSessionDerivedState(),
  };
}

export function deriveSlidesSessionSnapshot({
  raw,
  slides,
  lengthValue,
  slidesOcrEnabled,
}: {
  raw: SlidesSessionRawState;
  slides: SlideLike[];
  lengthValue: string;
  slidesOcrEnabled: boolean;
}): SlidesSessionSnapshot {
  return {
    raw,
    derived: deriveSlidesSessionState({
      raw,
      slides,
      lengthValue,
      slidesOcrEnabled,
    }),
  };
}

function applySummaryAction(
  raw: SlidesSessionRawState,
  markdown: string,
  opts?: SlidesSessionSummaryOpts,
): SlidesSessionRawState {
  const source = opts?.source ?? "summary";
  if (source === "summary" && raw.summarySource === "slides") {
    return raw;
  }
  if (!markdown.trim()) {
    if (opts?.preserveIfEmpty) {
      return raw;
    }
    return {
      ...raw,
      summaryMarkdown: "",
      summarySource: source === "slides" ? null : (raw.summarySource ?? "summary"),
    };
  }
  return {
    ...raw,
    summaryMarkdown: markdown,
    summarySource: source,
  };
}

export function reduceSlidesSessionRawState(
  raw: SlidesSessionRawState,
  action: SlidesSessionAction,
  derived: SlidesSessionState["derived"],
): SlidesSessionRawState {
  switch (action.type) {
    case "reset":
      return buildInitialSlidesSessionRawState();
    case "summary-source:clear":
      return { ...raw, summarySource: null };
    case "summary:apply":
      return applySummaryAction(raw, action.markdown, action.opts);
    case "transcript:set":
      return { ...raw, transcriptTimedText: action.value ?? null };
    case "text-mode:set":
      if (!canSetSlidesSessionTextMode(action.value, derived)) {
        return raw;
      }
      if (action.value === raw.textMode) {
        return raw;
      }
      return { ...raw, textMode: action.value };
  }
}
