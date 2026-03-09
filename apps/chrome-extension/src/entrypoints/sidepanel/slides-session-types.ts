import type { SseSlidesData } from "../../../../../src/shared/sse-events.js";
import type { SlideTextMode } from "./slides-state";

export type SlideSummarySource = "summary" | "slides" | null;

export type SlideLike = SseSlidesData["slides"][number];

export type SlidesSessionRawState = {
  summaryMarkdown: string;
  summarySource: SlideSummarySource;
  textMode: SlideTextMode;
  transcriptTimedText: string | null;
};

export type SlidesSessionDerivedState = {
  descriptions: Map<number, string>;
  summaryByIndex: Map<number, string>;
  titleByIndex: Map<number, string>;
  textMode: SlideTextMode;
  textToggleVisible: boolean;
  transcriptAvailable: boolean;
  ocrAvailable: boolean;
};

export type SlidesSessionState = {
  raw: SlidesSessionRawState;
  derived: SlidesSessionDerivedState;
};

export type SlidesSessionSummaryOpts = {
  preserveIfEmpty?: boolean;
  source?: Exclude<SlideSummarySource, null>;
};

export type SlidesSessionSnapshot = {
  raw: SlidesSessionRawState;
  derived: SlidesSessionDerivedState;
};
