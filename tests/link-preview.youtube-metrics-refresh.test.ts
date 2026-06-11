import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveTranscriptForLink = vi.hoisted(() => vi.fn());
const extractYoutubePlayerMetadata = vi.hoisted(() => vi.fn(() => null));
const fetchYoutubePlayerMetadata = vi.hoisted(() => vi.fn(async () => null));
const fetchMediaMetadataWithYtDlp = vi.hoisted(() => vi.fn());

vi.mock("../packages/core/src/content/transcript/index.js", () => ({
  resolveTranscriptForLink,
}));
vi.mock("../packages/core/src/content/transcript/providers/youtube/captions.js", () => ({
  extractYoutubePlayerMetadata,
  fetchYoutubePlayerMetadata,
}));
vi.mock("../packages/core/src/content/transcript/providers/youtube/yt-dlp.js", () => ({
  fetchMediaMetadataWithYtDlp,
}));

import { buildResultFromFirecrawl } from "../packages/core/src/content/link-preview/content/firecrawl.js";
import { buildResultFromHtmlDocument } from "../packages/core/src/content/link-preview/content/html.js";

describe("YouTube source metric refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extractYoutubePlayerMetadata.mockReturnValue(null);
    fetchYoutubePlayerMetadata.mockResolvedValue(null);
  });

  it("falls back to yt-dlp when cached transcript metrics cannot refresh via player metadata", async () => {
    resolveTranscriptForLink.mockResolvedValue({
      text: "cached transcript",
      source: "captionTracks",
      metadata: {
        sourceMetrics: {
          platform: "youtube",
          videoId: "abcdefghijk",
          viewCount: 10,
          observedAt: "2026-06-01T00:00:00.000Z",
        },
      },
      diagnostics: {
        cacheMode: "default",
        cacheStatus: "hit",
        textProvided: true,
        provider: "captionTracks",
        attemptedProviders: [],
      },
    });
    fetchMediaMetadataWithYtDlp.mockResolvedValue({
      durationSeconds: 60,
      viewCount: 20,
    });

    const result = await buildResultFromHtmlDocument({
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      html: "<!doctype html><html><head><title>Video</title></head><body></body></html>",
      cacheMode: "default",
      maxCharacters: null,
      youtubeTranscriptMode: "web",
      mediaTranscriptMode: "auto",
      firecrawlDiagnostics: {
        attempted: false,
        used: false,
        cacheMode: "default",
        cacheStatus: "bypassed",
        notes: null,
      },
      markdownRequested: false,
      markdownMode: "off",
      timeoutMs: 2_000,
      deps: {
        fetch: vi.fn(),
        ytDlpPath: "/usr/bin/yt-dlp",
      } as never,
      readabilityCandidate: null,
    });

    expect(fetchMediaMetadataWithYtDlp).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://www.youtube.com/watch?v=abcdefghijk",
        timeoutMs: expect.any(Number),
      }),
    );
    expect(result.sourceMetrics).toMatchObject({
      videoId: "abcdefghijk",
      viewCount: 20,
    });
  });

  it("records a fresh unavailable observation after a successful metadata refresh", async () => {
    resolveTranscriptForLink.mockResolvedValue({
      text: "cached transcript",
      source: "captionTracks",
      metadata: {
        sourceMetrics: {
          platform: "youtube",
          videoId: "abcdefghijk",
          viewCount: 10,
          observedAt: "2026-06-01T00:00:00.000Z",
        },
      },
      diagnostics: { cacheStatus: "hit" },
    });
    fetchYoutubePlayerMetadata.mockResolvedValue({
      durationSeconds: 60,
      viewCount: null,
    });

    const result = await buildResultFromHtmlDocument({
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      html: "<!doctype html><html><head><title>Video</title></head><body></body></html>",
      cacheMode: "default",
      maxCharacters: null,
      youtubeTranscriptMode: "web",
      mediaTranscriptMode: "auto",
      firecrawlDiagnostics: {
        attempted: false,
        used: false,
        cacheMode: "default",
        cacheStatus: "bypassed",
        notes: null,
      },
      markdownRequested: false,
      markdownMode: "off",
      timeoutMs: 2_000,
      deps: { fetch: vi.fn(), ytDlpPath: null } as never,
      readabilityCandidate: null,
    });

    expect(result.sourceMetrics?.viewCount).toBeNull();
    expect(result.sourceMetrics?.observedAt).not.toBe("2026-06-01T00:00:00.000Z");
  });

  it("falls back to yt-dlp when HTML player metadata has no view count", async () => {
    resolveTranscriptForLink.mockResolvedValue({
      text: "fresh transcript",
      source: "captionTracks",
      metadata: {},
      diagnostics: { cacheStatus: "miss" },
    });
    extractYoutubePlayerMetadata.mockReturnValue({
      durationSeconds: 60,
      viewCount: null,
    });
    fetchMediaMetadataWithYtDlp.mockResolvedValue({
      durationSeconds: 60,
      viewCount: 25,
    });

    const result = await buildResultFromHtmlDocument({
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      html: "<!doctype html><html><head><title>Video</title></head><body></body></html>",
      cacheMode: "default",
      maxCharacters: null,
      youtubeTranscriptMode: "web",
      mediaTranscriptMode: "auto",
      firecrawlDiagnostics: {
        attempted: false,
        used: false,
        cacheMode: "default",
        cacheStatus: "bypassed",
        notes: null,
      },
      markdownRequested: false,
      markdownMode: "off",
      timeoutMs: 2_000,
      deps: { fetch: vi.fn(), ytDlpPath: "/usr/bin/yt-dlp" } as never,
      readabilityCandidate: null,
    });

    expect(fetchMediaMetadataWithYtDlp).toHaveBeenCalled();
    expect(result.sourceMetrics).toMatchObject({
      videoId: "abcdefghijk",
      viewCount: 25,
    });
  });

  it("does not refresh a fresh unavailable observation from the transcript cache", async () => {
    const observedAt = new Date().toISOString();
    resolveTranscriptForLink.mockResolvedValue({
      text: "cached transcript",
      source: "captionTracks",
      metadata: {
        sourceMetrics: {
          platform: "youtube",
          videoId: "abcdefghijk",
          viewCount: null,
          observedAt,
        },
      },
      diagnostics: { cacheStatus: "hit" },
    });

    const result = await buildResultFromHtmlDocument({
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      html: "<!doctype html><html><head><title>Video</title></head><body></body></html>",
      cacheMode: "default",
      maxCharacters: null,
      youtubeTranscriptMode: "web",
      mediaTranscriptMode: "auto",
      firecrawlDiagnostics: {
        attempted: false,
        used: false,
        cacheMode: "default",
        cacheStatus: "bypassed",
        notes: null,
      },
      markdownRequested: false,
      markdownMode: "off",
      timeoutMs: 2_000,
      deps: { fetch: vi.fn(), ytDlpPath: "/usr/bin/yt-dlp" } as never,
      readabilityCandidate: null,
    });

    expect(result.sourceMetrics).toMatchObject({ viewCount: null, observedAt });
    expect(fetchYoutubePlayerMetadata).not.toHaveBeenCalled();
    expect(fetchMediaMetadataWithYtDlp).not.toHaveBeenCalled();
  });

  it("does not invent an observation when every metadata source fails", async () => {
    resolveTranscriptForLink.mockResolvedValue({
      text: "fresh transcript",
      source: "captionTracks",
      metadata: {},
      diagnostics: { cacheStatus: "miss" },
    });

    const result = await buildResultFromHtmlDocument({
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      html: "<!doctype html><html><head><title>Video</title></head><body></body></html>",
      cacheMode: "default",
      maxCharacters: null,
      youtubeTranscriptMode: "web",
      mediaTranscriptMode: "auto",
      firecrawlDiagnostics: {
        attempted: false,
        used: false,
        cacheMode: "default",
        cacheStatus: "bypassed",
        notes: null,
      },
      markdownRequested: false,
      markdownMode: "off",
      timeoutMs: 2_000,
      deps: { fetch: vi.fn(), ytDlpPath: null } as never,
      readabilityCandidate: null,
    });

    expect(result.sourceMetrics).toBeNull();
  });

  it("recovers an embedded video ID from HTML for a legacy transcript-cache hit", async () => {
    resolveTranscriptForLink.mockResolvedValue({
      text: "cached transcript",
      source: "captionTracks",
      metadata: {},
      diagnostics: { cacheStatus: "hit" },
    });
    extractYoutubePlayerMetadata.mockReturnValue({
      durationSeconds: 60,
      viewCount: 30,
    });
    const fetchImpl = vi.fn(async () => new Response("<html></html>", { status: 200 }));

    const result = await buildResultFromHtmlDocument({
      url: "https://example.com/episode",
      html: '<!doctype html><html><head><title>Episode</title></head><body><iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe></body></html>',
      cacheMode: "default",
      maxCharacters: null,
      youtubeTranscriptMode: "web",
      mediaTranscriptMode: "auto",
      firecrawlDiagnostics: {
        attempted: false,
        used: false,
        cacheMode: "default",
        cacheStatus: "bypassed",
        notes: null,
      },
      markdownRequested: false,
      markdownMode: "off",
      timeoutMs: 2_000,
      deps: { fetch: fetchImpl, ytDlpPath: null } as never,
      readabilityCandidate: null,
    });

    expect(result.sourceMetrics).toMatchObject({
      videoId: "abcdefghijk",
      viewCount: 30,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=abcdefghijk",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("recovers embedded video metrics for a legacy yt-dlp transcript", async () => {
    resolveTranscriptForLink.mockResolvedValue({
      text: "cached transcript",
      source: "yt-dlp",
      metadata: {},
      diagnostics: { cacheStatus: "hit" },
    });
    extractYoutubePlayerMetadata.mockReturnValue({
      durationSeconds: 60,
      viewCount: 35,
    });
    const fetchImpl = vi.fn(async () => new Response("<html></html>", { status: 200 }));

    const result = await buildResultFromHtmlDocument({
      url: "https://example.com/episode",
      html: '<!doctype html><html><head><title>Episode</title></head><body><iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe></body></html>',
      cacheMode: "default",
      maxCharacters: null,
      youtubeTranscriptMode: "web",
      mediaTranscriptMode: "auto",
      firecrawlDiagnostics: {
        attempted: false,
        used: false,
        cacheMode: "default",
        cacheStatus: "bypassed",
        notes: null,
      },
      markdownRequested: false,
      markdownMode: "off",
      timeoutMs: 2_000,
      deps: { fetch: fetchImpl, ytDlpPath: null } as never,
      readabilityCandidate: null,
    });

    expect(result.sourceMetrics).toMatchObject({
      videoId: "abcdefghijk",
      viewCount: 35,
    });
  });

  it("does not attach embed metrics to an article resolved by the generic provider", async () => {
    resolveTranscriptForLink.mockResolvedValue({
      text: "article transcript",
      source: "html",
      metadata: {},
      diagnostics: { cacheStatus: "miss" },
    });

    const result = await buildResultFromHtmlDocument({
      url: "https://example.com/article",
      html: '<!doctype html><html><head><title>Article</title></head><body><article>Long article</article><iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe></body></html>',
      cacheMode: "default",
      maxCharacters: null,
      youtubeTranscriptMode: "web",
      mediaTranscriptMode: "auto",
      firecrawlDiagnostics: {
        attempted: false,
        used: false,
        cacheMode: "default",
        cacheStatus: "bypassed",
        notes: null,
      },
      markdownRequested: false,
      markdownMode: "off",
      timeoutMs: 2_000,
      deps: { fetch: vi.fn(), ytDlpPath: null } as never,
      readabilityCandidate: null,
    });

    expect(result.sourceMetrics).toBeNull();
    expect(fetchYoutubePlayerMetadata).not.toHaveBeenCalled();
  });

  it("refreshes cached metrics on the Firecrawl result path", async () => {
    resolveTranscriptForLink.mockResolvedValue({
      text: "cached transcript",
      source: "captionTracks",
      metadata: {
        sourceMetrics: {
          platform: "youtube",
          videoId: "abcdefghijk",
          viewCount: 10,
          observedAt: "2026-06-01T00:00:00.000Z",
        },
      },
      diagnostics: { cacheStatus: "hit" },
    });
    fetchYoutubePlayerMetadata.mockResolvedValue({
      durationSeconds: 60,
      viewCount: 40,
    });

    const result = await buildResultFromFirecrawl({
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      payload: {
        markdown: "Firecrawl content",
        html: "<!doctype html><html><head><title>Video</title></head><body></body></html>",
      },
      cacheMode: "default",
      maxCharacters: null,
      youtubeTranscriptMode: "web",
      mediaTranscriptMode: "auto",
      firecrawlDiagnostics: {
        attempted: true,
        used: false,
        cacheMode: "default",
        cacheStatus: "miss",
        notes: null,
      },
      markdownRequested: true,
      timeoutMs: 2_000,
      deps: { fetch: vi.fn(), ytDlpPath: null } as never,
    });

    expect(result?.sourceMetrics).toMatchObject({
      videoId: "abcdefghijk",
      viewCount: 40,
    });
  });
});
