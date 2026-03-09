import { parseTranscriptTimedText } from "../../../../../src/run/flows/url/slides-text.js";
import type {
  SlideLike,
  SlidesSessionDerivedState,
  SlidesSessionRawState,
} from "./slides-session-types";
import {
  buildSlideDescriptions,
  deriveSlideSummaries,
  resolveSlidesTextState,
  type SlideTextMode,
} from "./slides-state";

export function buildEmptySlidesSessionDerivedState(): SlidesSessionDerivedState {
  return {
    descriptions: new Map(),
    summaryByIndex: new Map(),
    titleByIndex: new Map(),
    textMode: "transcript",
    textToggleVisible: false,
    transcriptAvailable: false,
    ocrAvailable: false,
  };
}

export function deriveSlidesSessionState({
  raw,
  slides,
  lengthValue,
  slidesOcrEnabled,
}: {
  raw: SlidesSessionRawState;
  slides: SlideLike[];
  lengthValue: string;
  slidesOcrEnabled: boolean;
}): SlidesSessionDerivedState {
  const transcriptAvailable = parseTranscriptTimedText(raw.transcriptTimedText).length > 0;
  const nextTextState = resolveSlidesTextState({
    slides,
    slidesOcrEnabled,
    slidesTranscriptAvailable: transcriptAvailable,
    currentMode: raw.textMode,
  });
  const summaries =
    raw.summaryMarkdown.trim().length > 0
      ? deriveSlideSummaries({
          markdown: raw.summaryMarkdown,
          slides,
          transcriptTimedText: raw.transcriptTimedText,
          lengthValue,
        })
      : null;

  return {
    descriptions: buildSlideDescriptions({
      slides,
      slideSummaries: summaries?.summaries,
      transcriptTimedText: raw.transcriptTimedText,
      lengthValue,
      slidesTextMode: nextTextState.slidesTextMode,
      slidesOcrEnabled,
      slidesOcrAvailable: nextTextState.slidesOcrAvailable,
      slidesTranscriptAvailable: transcriptAvailable,
    }),
    summaryByIndex: summaries?.summaries ?? new Map(),
    titleByIndex: summaries?.titles ?? new Map(),
    textMode: nextTextState.slidesTextMode,
    textToggleVisible: nextTextState.slidesTextToggleVisible,
    transcriptAvailable,
    ocrAvailable: nextTextState.slidesOcrAvailable,
  };
}

export function canSetSlidesSessionTextMode(
  mode: SlideTextMode,
  derived: SlidesSessionDerivedState,
): boolean {
  if (mode !== "ocr") return true;
  return derived.ocrAvailable;
}
