import MarkdownIt from "markdown-it";
import type { BgToPanel, PanelToBg } from "../../lib/panel-contracts";
import type { SseSlidesData } from "../../lib/runtime-contracts";
import {
  defaultSettings,
  loadSettings,
  patchSettings,
  type SlidesLayout,
} from "../../lib/settings";
import { splitSummaryFromSlides } from "../../lib/slides-text";
import { generateToken } from "../../lib/token";
import { createAppearanceControls } from "./appearance-controls";
import { createSidepanelBgMessageRuntime } from "./bg-message-runtime";
import { bindSidepanelUiEvents } from "./bindings";
import { bootstrapSidepanel } from "./bootstrap-runtime";
import { createSidepanelChatRuntime } from "./chat-runtime";
import { createSidepanelDom } from "./dom";
import { createErrorController } from "./error-controller";
import { createHeaderController } from "./header-controller";
import { createSidepanelInteractionRuntime } from "./interaction-runtime";
import { createMetricsController } from "./metrics-controller";
import { createNavigationRuntime } from "./navigation-runtime";
import { createPanelCacheController, type PanelCachePayload } from "./panel-cache";
import { createPanelMessagingRuntime } from "./panel-messaging";
import { createPanelStateStore } from "./panel-state-store";
import { createPlannedSlidesRuntime } from "./planned-slides-runtime";
import { panelUrlsMatch } from "./session-policy";
import { createSetupControlsRuntime } from "./setup-controls-runtime";
import { friendlyFetchError } from "./setup-runtime";
import { createSidepanelSlidesRuntime } from "./slides-runtime";
import { resolveSlidesInputMode } from "./slides-session-state";
import { selectMarkdownForLayout, type SlideTextMode } from "./slides-state";
import { createSlidesTextController, type SlideSummarySource } from "./slides-text-controller";
import { createSlidesViewRuntime } from "./slides-view-runtime";
import { createSummarizeControlRuntime } from "./summarize-control-runtime";
import { createSummaryRunRuntime } from "./summary-run-runtime";
import { createSummaryStreamRuntime } from "./summary-stream-runtime";
import { createSummaryViewRuntime } from "./summary-view-runtime";
import { registerSidepanelTestHooks } from "./test-hooks";
import { parseTimestampHref } from "./timestamp-links";
import type { PanelPhase, UiState } from "./types";
import { createTypographyController } from "./typography-controller";
import { createUiStateRuntime } from "./ui-state-runtime";

const {
  advancedBtn,
  advancedSettingsBodyEl,
  advancedSettingsEl,
  advancedSettingsSummaryEl,
  autoToggleRoot,
  automationNoticeActionBtn,
  automationNoticeEl,
  automationNoticeMessageEl,
  automationNoticeTitleEl,
  chatContainerEl,
  chatContextStatusEl,
  chatDockEl,
  chatInputEl,
  chatJumpBtn,
  chatMessagesEl,
  chatMetricsSlotEl,
  chatQueueEl,
  chatSendBtn,
  clearBtn,
  drawerEl,
  drawerToggleBtn,
  errorEl,
  errorLogsBtn,
  errorMessageEl,
  errorRetryBtn,
  headerEl,
  inlineErrorCloseBtn,
  inlineErrorEl,
  inlineErrorLogsBtn,
  inlineErrorMessageEl,
  inlineErrorRetryBtn,
  lengthRoot,
  lineLooseBtn,
  lineTightBtn,
  mainEl,
  metricsEl,
  metricsHomeEl,
  modelCustomEl,
  modelPresetEl,
  modelRefreshBtn,
  modelRowEl,
  modelStatusEl,
  pickersRoot,
  progressFillEl,
  refreshBtn,
  renderEl,
  renderMarkdownHostEl,
  renderSlidesHostEl,
  setupEl,
  sizeLgBtn,
  sizeSmBtn,
  slideNoticeEl,
  slideNoticeMessageEl,
  slideNoticeRetryBtn,
  slidesLayoutEl,
  subtitleEl,
  summarizeControlRoot,
  summaryCopyBtn,
  titleEl,
} = createSidepanelDom();

const metricsController = createMetricsController({
  metricsEl,
  metricsHomeEl,
  chatMetricsSlotEl,
});

const typographyController = createTypographyController({
  sizeSmBtn,
  sizeLgBtn,
  lineTightBtn,
  lineLooseBtn,
  defaultFontSize: defaultSettings.fontSize,
  defaultLineHeight: defaultSettings.lineHeight,
});

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});

const slideTagPattern = /^\[slide:(\d+)\]/i;
const slideTagPlugin = (markdown: MarkdownIt) => {
  markdown.inline.ruler.before("emphasis", "slide_tag", (state, silent) => {
    const match = state.src.slice(state.pos).match(slideTagPattern);
    if (!match) return false;
    if (!silent) {
      const token = state.push("slide_tag", "span", 0);
      token.meta = { index: Number(match[1]) };
    }
    state.pos += match[0].length;
    return true;
  });
  markdown.renderer.rules.slide_tag = (tokens, idx) => {
    const index = tokens[idx]?.meta?.index;
    if (!Number.isFinite(index)) return "";
    return `<span class="slideInline" data-slide-index="${index}"></span>`;
  };
};

md.use(slideTagPlugin);

const panelStateStore = createPanelStateStore();
const panelState = panelStateStore.state;
const getActiveTabId = () => panelState.navigation.activeTabId;
const getActiveTabUrl = () => panelState.navigation.activeTabUrl;
const getSlidesState = () => panelState.slidesSession;
const updateSlidesState = (value: Partial<typeof panelState.slidesSession>) => {
  panelStateStore.dispatch({ type: "slides-session-update", value });
};
const getPanelSession = () => panelState.panelSession;
const updatePanelSession = (value: Partial<typeof panelState.panelSession>) => {
  panelStateStore.dispatch({ type: "panel-session-update", value });
};

const panelMessagingRuntime = createPanelMessagingRuntime({
  panelState,
  dispatchPanelState: panelStateStore.dispatch,
  onMessage: (msg) => {
    handleBgMessage(msg);
  },
});
const { handleLocalSlidesResponse, resolveLocalSlides, send, sendRaw } = panelMessagingRuntime;

let autoKickTimer = 0;

let slidesRenderer: {
  applyLayout: () => void;
  clear: () => void;
  forceRender: () => void;
} | null = null;
let slidesHydrator: {
  getActiveRunId: () => string | null;
  handlePayload: (data: SseSlidesData) => void;
  handleSummaryFromCache: (value: boolean | null) => void;
  hydrateSnapshot: (reason: "timeout" | "resume") => Promise<void>;
  isStreaming: () => boolean;
  start: (runId: string) => Promise<void>;
  stop: () => void;
  syncFromCache: (payload: {
    runId: string | null;
    summaryFromCache: boolean | null;
    hasSlides: boolean;
  }) => void;
} | null = null;
const slidesTextController = createSlidesTextController({
  getSlides: () => panelState.slides?.slides ?? null,
  getLengthValue: () => appearanceControls.getLengthValue(),
  getSlidesOcrEnabled: () => getSlidesState().slidesOcrEnabled,
});

function showSlideNotice(message: string, opts?: { allowRetry?: boolean }) {
  slideNoticeMessageEl.textContent = message;
  slideNoticeRetryBtn.hidden = !opts?.allowRetry;
  slideNoticeEl.classList.remove("hidden");
  headerController.updateHeaderOffset();
}

function hideSlideNotice() {
  slideNoticeEl.classList.add("hidden");
  slideNoticeMessageEl.textContent = "";
  slideNoticeRetryBtn.hidden = true;
  headerController.updateHeaderOffset();
}

function stopSlidesStream() {
  slidesRuntime.stopSlidesStream();
}

function setSlidesTranscriptTimedText(value: string | null) {
  slidesTextController.setTranscriptTimedText(value);
}

renderEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const link = target.closest("a.chatTimestamp") as HTMLAnchorElement | null;
  if (!link) return;
  const href = link.getAttribute("href") ?? "";
  if (!href.startsWith("timestamp:")) return;
  event.preventDefault();
  event.stopPropagation();
  const seconds = parseTimestampHref(href);
  if (seconds == null) return;
  void send({ type: "panel:seek", seconds });
});

let summarizeControlRuntime: ReturnType<typeof createSummarizeControlRuntime> | null = null;

async function handleSummarizeControlChange(value: { mode: "page" | "video"; slides: boolean }) {
  await summarizeControlRuntime?.handleSummarizeControlChange(value);
}

function retrySlidesStream() {
  summarizeControlRuntime?.retrySlidesStream();
}

function applySlidesLayout() {
  summarizeControlRuntime?.applySlidesLayout();
}

function setSlidesLayout(next: SlidesLayout) {
  summarizeControlRuntime?.setSlidesLayout(next);
}

function refreshSummarizeControl() {
  summarizeControlRuntime?.refreshSummarizeControl();
}

const isStreaming = () => panelState.phase === "connecting" || panelState.phase === "streaming";

const optionsTabStorageKey = "summarize:options-tab";

const openOptionsTab = (tabId: string) => {
  try {
    localStorage.setItem(optionsTabStorageKey, tabId);
  } catch {
    // ignore
  }
  void send({ type: "panel:openOptions" });
};

const headerController = createHeaderController({
  headerEl,
  titleEl,
  subtitleEl,
  progressFillEl,
  getState: () => ({
    phase: panelState.phase,
    summaryFromCache: panelState.summaryFromCache,
  }),
});

headerController.updateHeaderOffset();
window.addEventListener("resize", headerController.updateHeaderOffset);

const errorController = createErrorController({
  panelEl: errorEl,
  panelMessageEl: errorMessageEl,
  panelRetryBtn: errorRetryBtn,
  panelLogsBtn: errorLogsBtn,
  inlineEl: inlineErrorEl,
  inlineMessageEl: inlineErrorMessageEl,
  inlineRetryBtn: inlineErrorRetryBtn,
  inlineLogsBtn: inlineErrorLogsBtn,
  inlineCloseBtn: inlineErrorCloseBtn,
  onRetry: () => retryLastAction(),
  onOpenLogs: () => openOptionsTab("logs"),
  onPanelVisibilityChange: () => headerController.updateHeaderOffset(),
});

slideNoticeRetryBtn.addEventListener("click", () => {
  retrySlidesStream();
});

const setPhase = (phase: PanelPhase, opts?: { error?: string | null }) => {
  panelStateStore.dispatch({ type: "phase", phase, error: opts?.error });
  if (phase === "error") {
    const message =
      panelState.error && panelState.error.trim().length > 0
        ? panelState.error
        : "Something went wrong.";
    errorController.showPanelError(message);
    setSlidesBusy(false);
  } else {
    errorController.clearPanelError();
    if (phase !== "streaming" && phase !== "connecting") {
      setSlidesBusy(false);
    }
  }
  if (phase === "connecting" || phase === "streaming") {
    headerController.armProgress();
  }
  if (phase !== "connecting" && phase !== "streaming") {
    headerController.stopProgress();
  }
  if (phase !== "connecting" && phase !== "streaming" && panelState.slides) {
    rebuildSlideDescriptions();
    queueSlidesRender();
  }
};

const navigationRuntime = createNavigationRuntime({
  getCurrentSource: () => panelState.currentSource,
  setCurrentSource: (source) => {
    panelStateStore.dispatch({ type: "source", source });
  },
  resetForNavigation: (preserveChat) => {
    setPhase("idle");
    resetSummaryView({ preserveChat });
    headerController.setBaseSubtitle("");
  },
  setBaseTitle: (title) => {
    headerController.setBaseTitle(title);
  },
});

const chatRuntime = createSidepanelChatRuntime({
  panelState,
  dispatchPanelState: panelStateStore.dispatch,
  markdown: md,
  mainEl,
  renderEl,
  chatContainerEl,
  chatContextStatusEl,
  chatDockEl,
  chatInputEl,
  chatJumpBtn,
  chatMessagesEl,
  chatQueueEl,
  chatSendBtn,
  automationNoticeActionBtn,
  automationNoticeEl,
  automationNoticeMessageEl,
  automationNoticeTitleEl,
  getActiveTabId,
  getActiveTabUrl,
  getNavigationRuntime: () => navigationRuntime,
  send,
  setStatus: (value) => {
    headerController.setStatus(value);
  },
  clearErrors: () => {
    errorController.clearAll();
  },
  showInlineError: (message) => {
    errorController.showInlineError(message);
  },
  clearChatMetrics: () => {
    metricsController.clearForMode("chat");
  },
  setChatMetricsMode: () => {
    metricsController.setActiveMode("chat");
  },
  setLastActionChat: () => {
    updatePanelSession({ lastAction: "chat" });
  },
  renderInlineSlides: () => {
    renderInlineSlides(chatMessagesEl);
  },
  seekToTimestamp: (seconds) => {
    void send({ type: "panel:seek", seconds });
  },
});

const syncWithActiveTab = () => navigationRuntime.syncWithActiveTab();

async function clearCurrentView() {
  panelStateStore.dispatch({ type: "retained-slide-summary", value: null });
  if (panelState.chat.streaming) {
    chatRuntime.requestAbort("Cleared");
  }
  streamController.abort();
  stopSlidesStream();
  resetSummaryView({ preserveChat: false });
  await chatRuntime.clearHistoryForActiveTab();
  panelCacheController.scheduleSync();
  headerController.setStatus("");
  setPhase("idle");
}

const summaryViewRuntime = createSummaryViewRuntime({
  panelState,
  dispatchPanelState: panelStateStore.dispatch,
  renderEl,
  renderSlidesHostEl,
  renderMarkdownHostEl,
  summaryCopyBtn,
  getSlidesRenderer: () =>
    slidesRenderer ?? {
      applyLayout: () => {},
      clear: () => {},
      forceRender: () => {},
    },
  metricsController,
  headerController,
  slidesTextController,
  getSlidesHydrator: () =>
    slidesHydrator ?? {
      handlePayload: () => {},
      handleSummaryFromCache: () => {},
      hydrateSnapshot: async () => {},
      isStreaming: () => false,
      start: async () => {},
      stop: () => {},
      syncFromCache: () => {},
    },
  stopSlidesStream,
  refreshSummarizeControl,
  resetChatState: chatRuntime.reset,
  setSlidesTranscriptTimedText,
  getSlidesSummaryState: () => ({
    runId: slidesSummaryController.getRunId(),
    markdown: slidesSummaryController.getMarkdown(),
    complete: slidesSummaryController.getComplete(),
    model: slidesSummaryController.getModel(),
  }),
  setSlidesSummaryState: (payload) => {
    slidesSummaryController.setSnapshot(payload);
  },
  clearSlidesSummaryPending: () => {
    slidesSummaryController.clearPending();
  },
  clearSlidesSummaryError: () => {
    slidesSummaryController.clearError();
  },
  updateSlidesTextState,
  requestSlidesContext,
  requestSlidesCapture: () => {
    void send({ type: "panel:slides-capture" });
  },
  updateSlideSummaryFromMarkdown,
  renderMarkdown,
  renderMarkdownDisplay,
  queueSlidesRender,
  setPhase,
});
const { applyPanelCache, buildPanelCachePayload, resetSummaryView } = summaryViewRuntime;

const panelCacheController = createPanelCacheController({
  getSnapshot: buildPanelCachePayload,
  sendCache: (payload) => {
    void send({ type: "panel:cache", cache: payload });
  },
  sendRequest: (request) => {
    void send({ type: "panel:get-cache", ...request });
  },
});

window.addEventListener("error", (event) => {
  const message =
    event.error instanceof Error ? event.error.stack || event.error.message : event.message;
  headerController.setStatus(`Error: ${message}`);
  setPhase("error", { error: message });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = (event as PromiseRejectionEvent).reason;
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  headerController.setStatus(`Error: ${message}`);
  setPhase("error", { error: message });
});

let slidesViewRuntime: ReturnType<typeof createSlidesViewRuntime> | null = null;

function renderEmptySummaryState() {
  slidesViewRuntime?.renderEmptySummaryState();
}

function renderMarkdownDisplay() {
  slidesViewRuntime?.renderMarkdownDisplay();
}

function renderMarkdown(markdown: string) {
  summaryRunRuntime.rememberRenderedMarkdown(markdown);
  slidesViewRuntime?.renderMarkdown(markdown);
}

function setSlidesBusy(next: boolean) {
  slidesViewRuntime?.setSlidesBusy(next);
}

function updateSlideSummaryFromMarkdown(
  markdown: string,
  opts?: { preserveIfEmpty?: boolean; source?: Exclude<SlideSummarySource, null> },
) {
  slidesViewRuntime?.updateSlideSummaryFromMarkdown(markdown, opts);
}

function seekToSlideTimestamp(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return;
  void send({ type: "panel:seek", seconds: Math.floor(seconds) });
}
function updateSlidesTextState() {
  slidesViewRuntime?.updateSlidesTextState();
}

function rebuildSlideDescriptions() {
  slidesViewRuntime?.rebuildSlideDescriptions();
}

slidesViewRuntime = createSlidesViewRuntime({
  renderMarkdownHostEl,
  renderSlidesHostEl,
  summaryCopyBtn,
  chatMessagesEl,
  md,
  headerSetStatus: (text) => headerController.setStatus(text),
  headerSetProgressOverride: (busy) => headerController.setProgressOverride(busy),
  slidesTextController,
  panelCacheController,
  send,
  refreshSummarizeControl,
  hideSlideNotice,
  panelState,
  dispatchPanelState: panelStateStore.dispatch,
  getFallbackSummaryMarkdown: () => summaryRunRuntime.getRetainedMarkdown(),
});

slidesRenderer = slidesViewRuntime.slidesRenderer;

function applySlidesPayload(data: SseSlidesData) {
  slidesViewRuntime.applySlidesPayload(data, setSlidesTranscriptTimedText);
}

registerSidepanelTestHooks({
  applySlidesPayload,
  getRunId: () => panelState.runId,
  getSummaryMarkdown: () => panelState.summaryMarkdown ?? "",
  getRetainedSlideSummaryMarkdown: () => summaryRunRuntime.getRetainedMarkdown() ?? "",
  getSlideDescriptions: () => slidesTextController.getDescriptionEntries(),
  getSlideSummaryEntries: () => slidesTextController.getSummaryEntries(),
  getSlideTitleEntries: () => Array.from(slidesTextController.getTitles().entries()),
  getPhase: () => panelState.phase,
  getModel: () => panelState.lastMeta.model ?? null,
  getSlidesTimeline: () =>
    panelState.slides?.slides.map((slide) => ({
      index: slide.index,
      timestamp: Number.isFinite(slide.timestamp) ? slide.timestamp : null,
    })) ?? [],
  getTranscriptTimedText: () => slidesTextController.getTranscriptTimedText(),
  getSlidesSummaryMarkdown: () => slidesSummaryController.getMarkdown(),
  getSlidesSummaryComplete: () => slidesSummaryController.getComplete(),
  getSlidesSummaryModel: () => slidesSummaryController.getModel(),
  getChatEnabled: () => getPanelSession().chatEnabled,
  getSettingsHydrated: () => getPanelSession().settingsHydrated,
  setTranscriptTimedText: (value) => {
    setSlidesTranscriptTimedText(value);
    updateSlidesTextState();
  },
  setSummarizeMode: async (payload) => {
    await handleSummarizeControlChange(payload);
  },
  getSummarizeMode: () => ({
    mode: resolveSlidesInputMode(getSlidesState()),
    slides: getSlidesState().slidesEnabled,
    mediaAvailable: getSlidesState().mediaAvailable,
  }),
  getSlidesState: () => ({
    slidesCount: panelState.slides?.slides.length ?? 0,
    layout: getSlidesState().slidesLayout,
    hasSlides: Boolean(panelState.slides),
  }),
  renderSlidesNow: () => {
    queueSlidesRender();
  },
  applyUiState: (state) => {
    panelStateStore.dispatch({ type: "ui", ui: state });
    updateControls(state);
  },
  applyBgMessage: (message) => {
    handleBgMessage(message);
  },
  applySummarySnapshot: (payload) => {
    summaryRunRuntime.applySnapshot(payload);
  },
  applySummaryMarkdown: (markdown) => {
    renderMarkdown(markdown);
    setPhase("idle");
  },
  applySlidesSummaryMarkdown: (markdown) => {
    updateSlideSummaryFromMarkdown(markdown, {
      preserveIfEmpty: true,
      source: "slides-partial",
    });
    setPhase("idle");
  },
  forceRenderSlides: () => {
    updateSlidesState({
      slidesEnabled: true,
      inputMode: "video",
      inputModeOverride: "video",
    });
    return slidesRenderer?.forceRender();
  },
  showInlineError: (message) => {
    errorController.showInlineError(message);
  },
  isInlineErrorVisible: () => !inlineErrorEl.classList.contains("hidden"),
  getInlineErrorMessage: () => inlineErrorMessageEl.textContent ?? "",
});

async function requestSlidesContext() {
  await slidesViewRuntime.requestSlidesContext();
}

function queueSlidesRender() {
  slidesViewRuntime.queueSlidesRender();
}

function renderInlineSlides(container: HTMLElement, opts?: { fallback?: boolean }) {
  slidesViewRuntime.renderInlineSlides(container, opts);
}

const LINE_HEIGHT_STEP = 0.1;

const appearanceControls = createAppearanceControls({
  autoToggleRoot,
  pickersRoot,
  lengthRoot,
  patchSettings,
  sendSetAuto: (checked) => {
    updatePanelSession({ autoSummarize: checked });
    void send({ type: "panel:setAuto", value: checked });
  },
  sendSetLength: (value) => {
    void send({ type: "panel:setLength", value });
  },
  applyTypography: (fontFamily, fontSize, lineHeight) => {
    typographyController.apply(fontFamily, fontSize, lineHeight);
    typographyController.setCurrentFontSize(fontSize);
    typographyController.setCurrentLineHeight(lineHeight);
  },
});

const plannedSlidesRuntime = createPlannedSlidesRuntime({
  panelState,
  dispatchPanelState: panelStateStore.dispatch,
  getActiveTabUrl,
  getLengthValue: () => appearanceControls.getLengthValue(),
  updateSlidesTextState,
  queueSlidesRender,
  schedulePanelCacheSync: (delayMs) => panelCacheController.scheduleSync(delayMs),
});

const setupControlsRuntime = createSetupControlsRuntime({
  advancedSettingsBodyEl,
  advancedSettingsEl,
  defaultModel: defaultSettings.model,
  drawerEl,
  drawerToggleBtn,
  friendlyFetchError,
  generateToken,
  getStatusResetText: () => panelState.ui?.status ?? "",
  headerSetStatus: (text) => {
    headerController.setStatus(text);
  },
  loadSettings,
  modelCustomEl,
  modelPresetEl,
  modelRefreshBtn,
  modelRowEl,
  modelStatusEl,
  patchSettings,
  setupEl,
});
const {
  drawerControls,
  isRefreshFreeRunning,
  maybeShowSetup,
  readCurrentModelValue,
  refreshModelsIfStale,
  runRefreshFree,
  setDefaultModelPresets,
  setModelPlaceholderFromDiscovery,
  setModelValue,
  updateModelRowUI,
} = setupControlsRuntime;

const slidesRuntime = createSidepanelSlidesRuntime({
  applySlidesPayload,
  clearSummarySource: () => {
    slidesTextController.clearSummarySource();
  },
  panelState,
  dispatchPanelState: panelStateStore.dispatch,
  friendlyFetchError,
  getLengthValue: () => appearanceControls.getLengthValue(),
  getToken: async () => (await loadSettings()).token,
  resolveLocalSlides,
  getTranscriptTimedText: () => slidesTextController.getTranscriptTimedText(),
  headerSetStatus: (text) => {
    headerController.setStatus(text);
  },
  hideSlideNotice,
  isStreaming,
  panelUrlsMatch,
  refreshSummarizeControl,
  renderInlineSlidesFallback: () => {
    renderInlineSlides(renderMarkdownHostEl, { fallback: true });
  },
  renderMarkdown,
  schedulePanelCacheSync: () => {
    panelCacheController.scheduleSync();
  },
  setSlidesBusy,
  showSlideNotice,
  updateSlideSummaryFromMarkdown,
});
const {
  applySlidesSummaryMarkdown,
  handleSlidesStatus,
  isActiveSlidesRunLocal,
  maybeApplyPendingSlidesSummary,
  maybeStartPendingSlidesForUrl,
  rememberPendingSlidesRun,
  resolveActiveSlidesRunId,
  slidesHydrator: activeSlidesHydrator,
  slidesSummaryController,
  startSlidesStream,
  startSlidesStreamForRunId,
  startSlidesSummaryStreamForRunId,
} = slidesRuntime;
slidesHydrator = activeSlidesHydrator;

const summaryStreamRuntime = createSummaryStreamRuntime({
  friendlyFetchError,
  getFallbackModel: () => panelState.ui?.settings.model ?? null,
  getToken: async () => (await loadSettings()).token,
  handleSlides: (data) => {
    slidesHydrator.handlePayload(data);
  },
  handleSummaryFromCache: (value) => {
    slidesHydrator.handleSummaryFromCache(value);
  },
  headerArmProgress: () => {
    headerController.armProgress();
  },
  headerSetBaseSubtitle: (text) => {
    headerController.setBaseSubtitle(text);
  },
  headerSetBaseTitle: (text) => {
    headerController.setBaseTitle(text);
  },
  headerSetStatus: (text) => {
    headerController.setStatus(text);
  },
  headerStopProgress: () => {
    headerController.stopProgress();
  },
  isStreaming,
  maybeApplyPendingSlidesSummary,
  panelState,
  dispatchPanelState: panelStateStore.dispatch,
  queueSlidesRender,
  rebuildSlideDescriptions,
  refreshSummaryMetrics: (summary) => {
    metricsController.setForMode(
      "summary",
      summary,
      panelState.lastMeta.inputSummary,
      panelState.currentSource?.url ?? null,
    );
    metricsController.setActiveMode("summary");
  },
  rememberUrl: (url) => {
    void send({ type: "panel:rememberUrl", url });
  },
  renderMarkdown,
  resetSummaryView,
  schedulePanelCacheSync: () => {
    panelCacheController.scheduleSync();
  },
  seedPlannedSlidesForPendingRun: () => {
    plannedSlidesRuntime.seedPendingRunAndConsumeWhenReady();
  },
  setSlidesBusy,
  setPhase,
  shouldRebuildSlideDescriptions: () => !slidesTextController.hasSummaryTitles(),
  syncWithActiveTab,
});
const { streamController } = summaryStreamRuntime;

const summaryRunRuntime = createSummaryRunRuntime({
  panelState,
  dispatchPanelState: panelStateStore.dispatch,
  getActiveTabId,
  getActiveTabUrl,
  clearAutoKickTimer: () => {
    window.clearTimeout(autoKickTimer);
  },
  summaryStream: {
    isStreaming: streamController.isStreaming,
    setPreserveChatOnNextReset: summaryStreamRuntime.setPreserveChatOnNextReset,
    start: streamController.start,
  },
  slides: {
    getHydratedRunId: () => slidesHydrator.getActiveRunId(),
    queueRender: queueSlidesRender,
    seedPlannedRun: plannedSlidesRuntime.seedForRun,
    setTranscriptTimedText: setSlidesTranscriptTimedText,
    start: startSlidesStream,
    stop: stopSlidesStream,
    updateTextState: updateSlidesTextState,
  },
  chat: {
    clearHistory: chatRuntime.clearHistoryForActiveTab,
    finishStreamingMessage: chatRuntime.finishStreamingMessage,
    reset: chatRuntime.reset,
    shouldPreserveForRun: navigationRuntime.shouldPreserveChatForRun,
  },
  view: {
    queueEmptyRender: renderMarkdownDisplay,
    renderMarkdown,
    reset: resetSummaryView,
    setHeaderSubtitle: (value) => headerController.setBaseSubtitle(value),
    setHeaderTitle: (value) => headerController.setBaseTitle(value),
    setMetricsMode: (mode) => metricsController.setActiveMode(mode),
    setPhase,
  },
});

const uiStateRuntime = createUiStateRuntime({
  panelState,
  dispatchPanelState: panelStateStore.dispatch,
  appearanceControls,
  typographyController,
  navigationRuntime,
  panelCacheController,
  headerController,
  clearInlineError: () => {
    errorController.clearInlineError();
  },
  requestAgentAbort: chatRuntime.requestAbort,
  clearChatHistoryForActiveTab: chatRuntime.clearHistoryForActiveTab,
  resetChatState: chatRuntime.reset,
  migrateChatHistory: chatRuntime.migrateHistory,
  maybeStartPendingSummaryRunForUrl: summaryRunRuntime.maybeStartPendingForUrl,
  maybeStartPendingSlidesForUrl,
  requestSlidesCapture: () => {
    void send({ type: "panel:slides-capture" });
  },
  resolveActiveSlidesRunId,
  applyPanelCache,
  resetSummaryView,
  abortSummaryStream: () => {
    streamController.abort();
  },
  hideAutomationNotice: chatRuntime.hideAutomationNotice,
  hideSlideNotice,
  maybeApplyPendingSlidesSummary,
  applyChatEnabled: chatRuntime.applyEnabled,
  restoreChatHistory: chatRuntime.restoreHistory,
  rebuildSlideDescriptions,
  renderInlineSlides,
  setSlidesLayout: (value) => {
    setSlidesLayout(value as SlidesLayout);
  },
  maybeSeedPlannedSlidesForPendingRun: plannedSlidesRuntime.maybeSeedPendingRun,
  refreshSummarizeControl,
  maybeShowSetup,
  setPhase,
  renderMarkdownDisplay,
  readCurrentModelValue,
  setModelValue,
  updateModelRowUI,
  isRefreshFreeRunning,
  setModelRefreshDisabled: (value) => {
    modelRefreshBtn.disabled = value;
  },
  renderMarkdownHostEl,
  isStreaming,
  onSlidesOcrChanged: updateSlidesTextState,
});

function updateControls(state: UiState) {
  uiStateRuntime.apply(state);
}

const bgMessageRuntime = createSidepanelBgMessageRuntime({
  panelState,
  dispatchPanelState: panelStateStore.dispatch,
  applyUiState: updateControls,
  setStatus: (text) => {
    headerController.setStatus(text);
  },
  isStreaming,
  setPhase,
  finishStreamingMessage: chatRuntime.finishStreamingMessage,
  setSlidesBusy,
  showSlideNotice,
  getActiveTabUrl,
  rememberPendingSlidesRun: (value) => {
    rememberPendingSlidesRun(value);
  },
  startSlidesStreamForRunId,
  startSlidesSummaryStreamForRunId: (runId, url) => {
    startSlidesSummaryStreamForRunId(runId, url ?? null);
  },
  handleSlidesLocal: handleLocalSlidesResponse,
  getSlidesContextRequestId: () => getSlidesState().slidesContextRequestId,
  setSlidesContextPending: (value) => {
    updateSlidesState({ slidesContextPending: value });
  },
  setSlidesTranscriptTimedText,
  updateSlidesTextState,
  getSlidesSummaryState: () => ({
    complete: slidesSummaryController.getComplete(),
    markdown: slidesSummaryController.getMarkdown(),
  }),
  updateSlideSummaryFromMarkdown,
  renderInlineSlidesFallback: () => {
    renderInlineSlides(renderMarkdownHostEl, { fallback: true });
  },
  schedulePanelCacheSync: () => {
    panelCacheController.scheduleSync();
  },
  consumeUiCache: (cacheMessage) => panelCacheController.consumeResponse(cacheMessage),
  clearPanelCache: () => {
    panelCacheController.clear();
  },
  getActiveTabId,
  applyPanelCache: (cache, opts) => {
    applyPanelCache(cache as PanelCachePayload, opts);
  },
  rememberPendingSummaryRun: (run) => {
    summaryRunRuntime.rememberPendingRun(run);
  },
  rememberPendingSummarySnapshot: (payload) => {
    summaryRunRuntime.rememberPendingSnapshot(payload);
  },
  attachSummaryRun: summaryRunRuntime.attachRun,
  applySummarySnapshot: (payload) => {
    summaryRunRuntime.applySnapshot(payload);
  },
  handleChatHistory: chatRuntime.handleHistory,
  handleAgentChunk: chatRuntime.handleAgentChunk,
  handleAgentResponse: chatRuntime.handleAgentResponse,
});

function handleBgMessage(msg: BgToPanel) {
  bgMessageRuntime.handle(msg);
}

function scheduleAutoKick() {
  if (!getPanelSession().autoSummarize) return;
  window.clearTimeout(autoKickTimer);
  autoKickTimer = window.setTimeout(() => {
    if (!getPanelSession().autoSummarize) return;
    if (panelState.phase !== "idle") return;
    if (panelState.summaryMarkdown) return;
    sendSummarize();
  }, 350);
}

const interactionRuntime = createSidepanelInteractionRuntime({
  sendRawMessage: (message) => sendRaw(message as PanelToBg),
  setLastAction: (value) => {
    updatePanelSession({ lastAction: value });
  },
  clearInlineError: () => {
    errorController.clearInlineError();
  },
  getInputModeOverride: () => getSlidesState().inputModeOverride,
  retryChat: chatRuntime.retry,
  chatEnabled: () => getPanelSession().chatEnabled,
  getRawChatInput: () => chatInputEl.value,
  clearChatInput: () => {
    chatInputEl.value = "";
    chatInputEl.style.height = "auto";
  },
  restoreChatInput: (value) => {
    chatInputEl.value = value;
  },
  getChatInputScrollHeight: () => chatInputEl.scrollHeight,
  setChatInputHeight: (value) => {
    chatInputEl.style.height = value;
  },
  isChatStreaming: () => panelState.chat.streaming,
  getQueuedChatCount: chatRuntime.getQueueLength,
  enqueueChatMessage: chatRuntime.enqueueMessage,
  maybeSendQueuedChat: chatRuntime.maybeSendQueuedMessage,
  startChatMessage: chatRuntime.startMessage,
  typographyController,
  patchSettings,
  updateModelRowUI,
  isCustomModelHidden: () => modelCustomEl.hidden,
  focusCustomModel: () => {
    modelCustomEl.focus();
  },
  blurCustomModel: () => {
    modelCustomEl.blur();
  },
  readCurrentModelValue,
});
const { sendSummarize, sendChatMessage, bumpFontSize, bumpLineHeight, persistCurrentModel } =
  interactionRuntime;

summarizeControlRuntime = createSummarizeControlRuntime({
  summarizeControlRoot,
  renderMarkdownHostEl,
  renderSlidesHostEl,
  slidesLayoutEl,
  slidesTextController,
  panelState,
  dispatchPanelState: panelStateStore.dispatch,
  patchSettings,
  loadSettings,
  showSlideNotice: (message) => {
    showSlideNotice(message);
  },
  hideSlideNotice,
  setSlidesBusy,
  stopSlidesStream,
  maybeApplyPendingSlidesSummary,
  maybeStartPendingSlidesForUrl,
  sendSummarize: (opts) => {
    sendSummarize(opts);
  },
  resolveActiveSlidesRunId,
  isActiveSlidesRunLocal,
  startSlidesStreamForRunId,
  startSlidesSummaryStreamForRunId: (runId, url) => {
    startSlidesSummaryStreamForRunId(runId, url ?? null);
  },
  renderMarkdownDisplay,
  renderInlineSlidesFallback: () => {
    renderInlineSlides(renderMarkdownHostEl, { fallback: true });
  },
  queueSlidesRender,
  applySlidesRendererLayout: () => {
    slidesRenderer?.applyLayout();
  },
});

function retryLastAction() {
  interactionRuntime.retryLastAction(getPanelSession().lastAction ?? "summarize");
}

bindSidepanelUiEvents({
  refreshBtn,
  clearBtn,
  drawerToggleBtn,
  advancedBtn,
  advancedSettingsSummaryEl,
  chatSendBtn,
  chatInputEl,
  sizeSmBtn,
  sizeLgBtn,
  lineTightBtn,
  lineLooseBtn,
  modelPresetEl,
  modelCustomEl,
  slidesLayoutEl,
  modelRefreshBtn,
  advancedSettingsEl,
  lineHeightStep: LINE_HEIGHT_STEP,
  sendSummarize,
  clearCurrentView,
  toggleDrawer: () => drawerControls.toggleDrawer(),
  openOptions: () => send({ type: "panel:openOptions" }),
  toggleAdvancedSettings: drawerControls.toggleAdvancedSettings,
  sendChatMessage,
  bumpFontSize,
  bumpLineHeight,
  persistCurrentModel,
  setSlidesLayout: (next) => {
    setSlidesLayout(next);
    void (async () => {
      await patchSettings({ slidesLayout: next });
    })();
  },
  refreshModelsIfStale: () => {
    if (drawerControls.hasAdvancedSettingsAnimation() && advancedSettingsEl.open) return;
    refreshModelsIfStale();
  },
  runRefreshFree,
});

bootstrapSidepanel({
  ensurePanelPort: () => panelMessagingRuntime.ensure(),
  loadSettings,
  panelState,
  dispatchPanelState: panelStateStore.dispatch,
  typographyController,
  setSlidesLayoutInputValue: (value) => {
    slidesLayoutEl.value = value;
  },
  hideAutomationNotice: chatRuntime.hideAutomationNotice,
  appearanceControls,
  applyChatEnabled: chatRuntime.applyEnabled,
  applySlidesLayout,
  setDefaultModelPresets,
  setModelValue,
  setModelPlaceholderFromDiscovery,
  updateModelRowUI,
  setModelRefreshDisabled: (value) => {
    modelRefreshBtn.disabled = value;
  },
  toggleDrawerClosed: () => {
    drawerControls.toggleDrawer(false, { animate: false });
  },
  renderMarkdownDisplay,
  sendReady: () => {
    void send({ type: "panel:ready" });
  },
  scheduleAutoKick,
  sendPing: () => {
    void send({ type: "panel:ping" });
  },
  bindSidepanelLifecycle: {
    sendReady: () => {
      void send({ type: "panel:ready" });
    },
    sendClosed: () => {
      window.clearTimeout(autoKickTimer);
      void send({ type: "panel:closed" });
    },
    scheduleAutoKick,
    syncWithActiveTab,
    clearInlineError: () => {
      errorController.clearInlineError();
    },
    sendSummarize,
  },
});
