import type { PanelPhase } from "./types";

type SummaryEmptyStateInput = {
  tabTitle: string | null;
  tabUrl: string | null;
  autoSummarize: boolean;
  phase: PanelPhase;
  hasSlides: boolean;
};

export type SummaryEmptyState = {
  label: string;
  message: string;
  detail: string | null;
};

export function buildSummaryEmptyState(input: SummaryEmptyStateInput): SummaryEmptyState | null {
  if (input.hasSlides) return null;

  const subject = input.tabTitle?.trim() || input.tabUrl?.trim() || "this page";
  if (!input.tabUrl) {
    return {
      label: "No page",
      message: "Open a page to summarize.",
      detail: null,
    };
  }

  if (input.phase === "connecting" || input.phase === "streaming" || input.autoSummarize) {
    return {
      label: "Loading",
      message: "Preparing summary",
      detail: subject,
    };
  }

  return {
    label: "Ready",
    message: "Click Summarize to start.",
    detail: subject,
  };
}
