import { describe, expect, it } from "vitest";
import { buildSummaryEmptyState } from "../apps/chrome-extension/src/entrypoints/sidepanel/summary-empty-state.js";

describe("sidepanel summary empty state", () => {
  it("shows a ready state for manual summarize", () => {
    expect(
      buildSummaryEmptyState({
        tabTitle: "Example Video",
        tabUrl: "https://www.youtube.com/watch?v=abc",
        autoSummarize: false,
        phase: "idle",
        hasSlides: false,
      }),
    ).toEqual({
      label: "Ready",
      message: "Click Summarize to start.",
      detail: "Example Video",
    });
  });

  it("shows a loading state when auto summarize is active", () => {
    expect(
      buildSummaryEmptyState({
        tabTitle: "Example Video",
        tabUrl: "https://www.youtube.com/watch?v=abc",
        autoSummarize: true,
        phase: "idle",
        hasSlides: false,
      }),
    ).toEqual({
      label: "Loading",
      message: "Preparing summary",
      detail: "Example Video",
    });
  });

  it("shows a quiet no-page state without extra detail", () => {
    expect(
      buildSummaryEmptyState({
        tabTitle: null,
        tabUrl: null,
        autoSummarize: false,
        phase: "idle",
        hasSlides: false,
      }),
    ).toEqual({
      label: "No page",
      message: "Open a page to summarize.",
      detail: null,
    });
  });

  it("hides the empty state once slides exist", () => {
    expect(
      buildSummaryEmptyState({
        tabTitle: "Example Video",
        tabUrl: "https://www.youtube.com/watch?v=abc",
        autoSummarize: false,
        phase: "idle",
        hasSlides: true,
      }),
    ).toBeNull();
  });
});
