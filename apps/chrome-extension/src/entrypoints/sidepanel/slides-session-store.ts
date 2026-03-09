import {
  buildInitialSlidesSessionState,
  deriveSlidesSessionSnapshot,
  reduceSlidesSessionRawState,
  type SlidesSessionAction,
} from "./slides-session-reducer";
import type { SlidesSessionSummaryOpts } from "./slides-session-types";
import type { SlideTextMode } from "./slides-state";

export function createSlidesSessionStore(options: {
  getSlides: () => Parameters<typeof deriveSlidesSessionSnapshot>[0]["slides"];
  getLengthValue: () => string;
  getSlidesOcrEnabled: () => boolean;
}) {
  let state = buildInitialSlidesSessionState();

  const recompute = (raw = state.raw) => {
    state = deriveSlidesSessionSnapshot({
      raw,
      slides: options.getSlides() ?? [],
      lengthValue: options.getLengthValue(),
      slidesOcrEnabled: options.getSlidesOcrEnabled(),
    });
    return state;
  };

  const dispatch = (action: SlidesSessionAction) => {
    const nextRaw = reduceSlidesSessionRawState(state.raw, action, state.derived);
    const changed = nextRaw !== state.raw;
    if (changed || action.type === "reset") {
      recompute(nextRaw);
    }
    return changed;
  };

  const rebuild = () => {
    recompute();
  };

  return {
    reset() {
      state = buildInitialSlidesSessionState();
    },
    clearSummarySource() {
      dispatch({ type: "summary-source:clear" });
    },
    rebuildDescriptions() {
      rebuild();
    },
    setTranscriptTimedText(value: string | null) {
      dispatch({ type: "transcript:set", value });
    },
    syncTextState() {
      rebuild();
    },
    setTextMode(next: SlideTextMode) {
      const before = state.raw.textMode;
      dispatch({ type: "text-mode:set", value: next });
      return state.raw.textMode !== before;
    },
    updateSummaryFromMarkdown(markdown: string, opts?: SlidesSessionSummaryOpts) {
      const beforeMarkdown = state.raw.summaryMarkdown;
      const beforeSource = state.raw.summarySource;
      const beforeSummaries = state.derived.summaryByIndex;
      const beforeTitles = state.derived.titleByIndex;
      dispatch({ type: "summary:apply", markdown, opts });
      return (
        state.raw.summaryMarkdown !== beforeMarkdown ||
        state.raw.summarySource !== beforeSource ||
        state.derived.summaryByIndex !== beforeSummaries ||
        state.derived.titleByIndex !== beforeTitles
      );
    },
    getTextMode: () => state.derived.textMode,
    getTextToggleVisible: () => state.derived.textToggleVisible,
    getTranscriptTimedText: () => state.raw.transcriptTimedText,
    getTranscriptAvailable: () => state.derived.transcriptAvailable,
    getOcrAvailable: () => state.derived.ocrAvailable,
    getDescriptions: () => state.derived.descriptions,
    getDescriptionEntries: () => Array.from(state.derived.descriptions.entries()),
    getSummaryEntries: () => Array.from(state.derived.summaryByIndex.entries()),
    getTitles: () => state.derived.titleByIndex,
    hasSummaryTitles: () => state.derived.titleByIndex.size > 0,
    getSummaryMarkdown: () => state.raw.summaryMarkdown,
    getSummarySource: () => state.raw.summarySource,
  };
}
