import { applyPanelStateAction, type PanelStateAction } from "./panel-state-store";
import { normalizePanelUrl, panelUrlsMatch } from "./session-policy";
import { resolveSlidesInputMode } from "./slides-session-state";
import type { PanelPhase, PanelState, RunStart } from "./types";

type SummaryStreamPort = {
  isStreaming: () => boolean;
  setPreserveChatOnNextReset: (value: boolean) => void;
  start: (run: RunStart) => Promise<void>;
};

type SlidesRunPort = {
  getHydratedRunId: () => string | null;
  queueRender: () => void;
  seedPlannedRun: (run: RunStart) => boolean;
  setTranscriptTimedText: (value: string | null) => void;
  start: (run: RunStart) => void;
  stop: () => void;
  updateTextState: () => void;
};

type ChatRunPort = {
  clearHistory: () => void | Promise<void>;
  finishStreamingMessage: () => void;
  reset: () => void;
  shouldPreserveForRun: (url: string) => boolean;
};

type SummaryViewPort = {
  queueEmptyRender: () => void;
  renderMarkdown: (markdown: string) => void;
  reset: (options: { preserveChat?: boolean; clearRunId?: boolean; stopSlides?: boolean }) => void;
  setHeaderSubtitle: (value: string) => void;
  setHeaderTitle: (value: string) => void;
  setMetricsMode: (mode: "summary") => void;
  setPhase: (phase: PanelPhase) => void;
};

export function createSummaryRunRuntime({
  panelState,
  dispatchPanelState,
  getActiveTabId,
  getActiveTabUrl,
  clearAutoKickTimer,
  summaryStream,
  slides,
  chat,
  view,
}: {
  panelState: PanelState;
  dispatchPanelState?: (action: PanelStateAction) => void;
  getActiveTabId: () => number | null;
  getActiveTabUrl: () => string | null;
  clearAutoKickTimer: () => void;
  summaryStream: SummaryStreamPort;
  slides: SlidesRunPort;
  chat: ChatRunPort;
  view: SummaryViewPort;
}) {
  const dispatch = (action: PanelStateAction) => {
    if (dispatchPanelState) {
      dispatchPanelState(action);
    } else {
      applyPanelStateAction(panelState, action);
    }
  };

  const getSummaryScopeUrl = () => panelState.currentSource?.url ?? getActiveTabUrl() ?? null;

  const rememberRenderedMarkdown = (markdown: string) => {
    if (!markdown.trim()) return;
    dispatch({
      type: "retained-slide-summary",
      value: {
        markdown,
        url: getSummaryScopeUrl(),
      },
    });
  };

  const getRetainedMarkdown = () => {
    const retained = panelState.retainedSlideSummary;
    if (!retained) return null;
    const currentUrl = getSummaryScopeUrl();
    if (retained.url && currentUrl && !panelUrlsMatch(retained.url, currentUrl)) return null;
    return retained.markdown;
  };

  const attachRun = (run: RunStart) => {
    const activeSlidesRun = panelState.slidesLifecycle.activeRun;
    const preserveActiveLocalSlideRun = Boolean(
      activeSlidesRun?.local && activeSlidesRun.url && panelUrlsMatch(activeSlidesRun.url, run.url),
    );
    if (!preserveActiveLocalSlideRun) slides.stop();

    view.setPhase("connecting");
    dispatch({ type: "panel-session-update", value: { lastAction: "summarize" } });
    clearAutoKickTimer();
    if (panelState.chat.streaming) chat.finishStreamingMessage();

    const preserveChat = chat.shouldPreserveForRun(run.url);
    if (preserveChat) {
      summaryStream.setPreserveChatOnNextReset(true);
    } else {
      void chat.clearHistory();
      chat.reset();
    }

    view.setMetricsMode("summary");
    const runRequestsSlides =
      run.slides === true ||
      (run.slides !== false &&
        panelState.slidesSession.slidesEnabled &&
        (resolveSlidesInputMode(panelState.slidesSession) === "video" ||
          panelState.slidesSession.mediaAvailable));
    const slidesRunId = runRequestsSlides
      ? run.id
      : preserveActiveLocalSlideRun
        ? (activeSlidesRun?.runId ?? null)
        : null;
    view.setHeaderTitle(run.title || run.url || "Summarize");
    view.setHeaderSubtitle("");
    const fallbackModel = panelState.ui?.settings.model ?? null;
    dispatch({
      type: "attach-run",
      tabId: getActiveTabId(),
      runId: run.id,
      slidesRunId,
      plannedSlidesRun: runRequestsSlides ? run : null,
      source: { url: run.url, title: run.title },
      meta: {
        inputSummary: null,
        model: fallbackModel,
        modelLabel: fallbackModel,
      },
    });
    if (runRequestsSlides) {
      slides.start(run);
      slides.seedPlannedRun(run);
    }
    if (!panelState.summaryMarkdown?.trim()) view.queueEmptyRender();
    void summaryStream.start(run);
  };

  const applySnapshot = (payload: { run: RunStart; markdown: string }) => {
    const activeSlidesRun = panelState.slidesLifecycle.activeRun;
    const preserveActiveSlideRun =
      payload.run.slides === true &&
      (slides.getHydratedRunId() === payload.run.id ||
        Boolean(
          activeSlidesRun?.local &&
          activeSlidesRun.url &&
          panelUrlsMatch(activeSlidesRun.url, payload.run.url),
        ));
    const preservedSlides =
      payload.run.slides &&
      panelState.slides &&
      panelState.slides.sourceUrl &&
      panelUrlsMatch(panelState.slides.sourceUrl, payload.run.url)
        ? panelState.slides
        : null;
    view.reset({
      preserveChat: false,
      clearRunId: false,
      stopSlides: !preserveActiveSlideRun,
    });
    const slidesRunId =
      preservedSlides?.sourceId ??
      (preserveActiveSlideRun ? (activeSlidesRun?.runId ?? null) : null);
    dispatch({
      type: "restore-session",
      tabId: getActiveTabId(),
      runId: payload.run.id,
      slidesRunId,
      source: { url: payload.run.url, title: payload.run.title },
      meta: {
        inputSummary: null,
        model: payload.run.model,
        modelLabel: payload.run.model,
      },
      summaryFromCache: null,
      ...(preservedSlides ? { slides: preservedSlides } : {}),
    });
    view.setHeaderTitle(payload.run.title || payload.run.url || "Summarize");
    view.setHeaderSubtitle("");
    if (preservedSlides) {
      slides.setTranscriptTimedText(preservedSlides.transcriptTimedText ?? null);
      slides.updateTextState();
    }
    view.renderMarkdown(payload.markdown);
    if (preservedSlides) slides.queueRender();
    view.setPhase("idle");
  };

  const rememberPendingRun = (run: RunStart) => {
    dispatch({
      type: "pending-summary-run",
      urlKey: normalizePanelUrl(run.url),
      value: { type: "run", run },
    });
  };

  const rememberPendingSnapshot = (payload: { run: RunStart; markdown: string }) => {
    dispatch({
      type: "pending-summary-run",
      urlKey: normalizePanelUrl(payload.run.url),
      value: {
        type: "snapshot",
        run: payload.run,
        markdown: payload.markdown,
      },
    });
  };

  const maybeStartPendingForUrl = (url: string | null) => {
    if (!url) return false;
    const key = normalizePanelUrl(url);
    const pending = panelState.pendingRuns.summaryByUrl[key];
    if (!pending || summaryStream.isStreaming()) return false;
    dispatch({ type: "pending-summary-run", urlKey: key, value: null });
    if (pending.type === "snapshot") {
      applySnapshot({ run: pending.run, markdown: pending.markdown });
    } else {
      attachRun(pending.run);
    }
    return true;
  };

  return {
    applySnapshot,
    attachRun,
    getRetainedMarkdown,
    maybeStartPendingForUrl,
    rememberPendingRun,
    rememberPendingSnapshot,
    rememberRenderedMarkdown,
  };
}
