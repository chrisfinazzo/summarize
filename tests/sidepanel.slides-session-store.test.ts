import { describe, expect, it } from "vitest";
import { createSlidesSessionStore } from "../apps/chrome-extension/src/entrypoints/sidepanel/slides-session-store.js";

describe("sidepanel slides session store", () => {
  it("re-derives slide summaries when slides arrive after summary markdown", () => {
    let slides: Array<{
      index: number;
      timestamp: number;
      imageUrl: string;
      ocrText: string | null;
    }> = [];

    const store = createSlidesSessionStore({
      getSlides: () => slides,
      getLengthValue: () => "short",
      getSlidesOcrEnabled: () => true,
    });

    expect(
      store.updateSummaryFromMarkdown(
        [
          "### Slides",
          "Slide 1 · 0:01",
          "Microwave briefing",
          "The report frames the attacks as deliberate and tied to a portable classified device.",
          "",
          "Slide 2 · 3:12",
          "CIA fallout",
          "Officials admit the pattern reaches US personnel and no longer looks like coincidence.",
        ].join("\n"),
        { source: "slides" },
      ),
    ).toBe(true);

    slides = [
      { index: 1, timestamp: 1, imageUrl: "x", ocrText: "raw fallback one" },
      { index: 2, timestamp: 192, imageUrl: "y", ocrText: "raw fallback two" },
    ];
    store.syncTextState();

    expect(store.getTitles().get(1)).toBe("Microwave briefing");
    expect(store.getDescriptions().get(1)).toContain("portable classified device");
    expect(store.getDescriptions().get(2)).toContain("no longer looks like coincidence");
  });

  it("re-derives slide summaries when transcript arrives after summary markdown", () => {
    const slides = [
      { index: 1, timestamp: 0, imageUrl: "x", ocrText: null },
      { index: 2, timestamp: 30, imageUrl: "y", ocrText: null },
    ];
    const store = createSlidesSessionStore({
      getSlides: () => slides,
      getLengthValue: () => "short",
      getSlidesOcrEnabled: () => true,
    });

    store.updateSummaryFromMarkdown(
      [
        "Overall intro paragraph.",
        "",
        "### Slides",
        "Slide 1 · 0:00",
        "Opening move",
        "Summary body for the first chunk.",
        "",
        "Slide 2 · 0:30",
        "Follow-through",
        "Summary body for the second chunk.",
      ].join("\n"),
      { source: "slides" },
    );

    store.setTranscriptTimedText("[00:00] raw one\n[00:30] raw two");
    store.syncTextState();

    expect(store.getDescriptions().get(1)).toContain("Summary body for the first chunk.");
    expect(store.getDescriptions().get(2)).toContain("Summary body for the second chunk.");
  });

  it("keeps slide-sourced summaries authoritative over later summary markdown", () => {
    const slides = [{ index: 1, timestamp: 2, imageUrl: "x", ocrText: null }];
    const store = createSlidesSessionStore({
      getSlides: () => slides,
      getLengthValue: () => "short",
      getSlidesOcrEnabled: () => true,
    });

    store.updateSummaryFromMarkdown(
      ["### Slides", "Slide 1 · 0:02", "Canonical title", "Canonical body"].join("\n"),
      { source: "slides" },
    );

    expect(
      store.updateSummaryFromMarkdown(
        ["### Slides", "Slide 1 · 0:02", "Wrong title", "Wrong body"].join("\n"),
        { source: "summary" },
      ),
    ).toBe(false);
    expect(store.getTitles().get(1)).toBe("Canonical title");
    expect(store.getDescriptions().get(1)).toContain("Canonical body");
  });
});
