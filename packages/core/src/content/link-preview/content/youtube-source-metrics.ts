import {
  extractYoutubePlayerMetadata,
  fetchYoutubePlayerMetadata,
} from "../../transcript/providers/youtube/captions.js";
import { fetchMediaMetadataWithYtDlp } from "../../transcript/providers/youtube/yt-dlp.js";
import { extractYouTubeVideoId } from "../../url.js";
import type { LinkPreviewDeps } from "../deps.js";
import { fetchWithTimeout } from "../fetch-with-timeout.js";
import type { TranscriptResolution, TranscriptSource } from "../types.js";
import type { SourceMetrics } from "./types.js";
import type { DetectedVideo } from "./video.js";

const SOURCE_METRICS_TTL_MS = 60 * 60 * 1_000;
const METRICS_BEST_EFFORT_TIMEOUT_MS = 5_000;
const YOUTUBE_TRANSCRIPT_SOURCES = new Set<TranscriptSource>([
  "youtubei",
  "captionTracks",
  "youtube-media",
  "apify",
  "yt-dlp",
]);

function readSourceMetrics(value: unknown): SourceMetrics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.platform !== "youtube" ||
    typeof record.videoId !== "string" ||
    record.videoId.length === 0 ||
    (record.viewCount !== null &&
      (typeof record.viewCount !== "number" ||
        !Number.isSafeInteger(record.viewCount) ||
        record.viewCount < 0)) ||
    typeof record.observedAt !== "string" ||
    !Number.isFinite(Date.parse(record.observedAt))
  ) {
    return null;
  }
  return {
    platform: "youtube",
    videoId: record.videoId,
    viewCount: record.viewCount as number | null,
    observedAt: record.observedAt,
  };
}

export async function refreshYoutubeSourceMetrics({
  url,
  html,
  detectedVideo,
  transcriptResolution,
  deps,
  timeoutMs,
  startedAtMs,
}: {
  url: string;
  html: string;
  detectedVideo: DetectedVideo | null;
  transcriptResolution: TranscriptResolution;
  deps: LinkPreviewDeps;
  timeoutMs: number;
  startedAtMs: number;
}): Promise<void> {
  const metricsDeadlineMs = startedAtMs + Math.min(timeoutMs, METRICS_BEST_EFFORT_TIMEOUT_MS);
  const remainingMetricsMs = () => Math.max(0, metricsDeadlineMs - Date.now());
  const existingMetrics = readSourceMetrics(transcriptResolution.metadata?.sourceMetrics);
  const existingVideoId = existingMetrics?.videoId ?? null;
  const urlVideoId = extractYouTubeVideoId(url);
  const detectedVideoId =
    detectedVideo?.kind === "youtube" ? extractYouTubeVideoId(detectedVideo.url) : null;
  const resolvedEmbedId =
    detectedVideoId &&
    transcriptResolution.text &&
    transcriptResolution.source &&
    YOUTUBE_TRANSCRIPT_SOURCES.has(transcriptResolution.source)
      ? detectedVideoId
      : null;
  const resolvedVideoId = urlVideoId ?? existingVideoId ?? resolvedEmbedId;
  if (!resolvedVideoId) return;

  const htmlPlayerMetadata = urlVideoId ? extractYoutubePlayerMetadata(html) : null;
  let sourceMetrics =
    htmlPlayerMetadata && urlVideoId
      ? {
          platform: "youtube" as const,
          videoId: urlVideoId,
          viewCount: htmlPlayerMetadata.viewCount,
          observedAt: new Date(startedAtMs).toISOString(),
        }
      : existingMetrics?.videoId === resolvedVideoId
        ? existingMetrics
        : null;
  const observedTime = sourceMetrics ? Date.parse(sourceMetrics.observedAt) : Number.NaN;
  const metricsAreStale =
    !Number.isFinite(observedTime) || Date.now() - observedTime >= SOURCE_METRICS_TTL_MS;
  const shouldRefresh =
    htmlPlayerMetadata?.viewCount === null ||
    (htmlPlayerMetadata === null && (sourceMetrics === null || metricsAreStale));
  const remainingTimeoutMs = remainingMetricsMs();

  if (shouldRefresh && remainingTimeoutMs > 0) {
    if (!urlVideoId) {
      const refreshedMetrics = await fetchYoutubeSourceMetrics({
        fetchImpl: deps.fetch,
        ytDlpPath: deps.ytDlpPath,
        videoId: resolvedVideoId,
        timeoutMs: remainingTimeoutMs,
      });
      if (refreshedMetrics) {
        sourceMetrics = refreshedMetrics;
      }
    } else {
      const refreshed = await fetchYoutubePlayerMetadata(deps.fetch, {
        html,
        videoId: resolvedVideoId,
        timeoutMs: remainingTimeoutMs,
      });
      let refreshedViewCount = refreshed?.viewCount ?? null;
      let refreshObserved = refreshed !== null;
      const ytDlpTimeoutMs = remainingMetricsMs();
      if (refreshedViewCount === null && deps.ytDlpPath && ytDlpTimeoutMs > 0) {
        const ytDlpMetadata = await fetchMediaMetadataWithYtDlp({
          ytDlpPath: deps.ytDlpPath,
          url: `https://www.youtube.com/watch?v=${resolvedVideoId}`,
          timeoutMs: ytDlpTimeoutMs,
        });
        refreshedViewCount = ytDlpMetadata?.viewCount ?? null;
        refreshObserved ||= ytDlpMetadata !== null;
      }
      if (refreshObserved) {
        sourceMetrics = {
          platform: "youtube",
          videoId: resolvedVideoId,
          viewCount: refreshedViewCount,
          observedAt: new Date().toISOString(),
        };
      }
    }
  }

  if (!sourceMetrics) return;
  transcriptResolution.metadata = {
    ...(transcriptResolution.metadata ?? {}),
    sourceMetrics,
  };
}

export async function fetchYoutubeSourceMetrics({
  fetchImpl,
  ytDlpPath,
  videoId,
  timeoutMs,
}: {
  fetchImpl: typeof fetch;
  ytDlpPath: string | null;
  videoId: string;
  timeoutMs: number;
}): Promise<SourceMetrics | null> {
  const startedAt = Date.now();
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let html = "";
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      watchUrl,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      },
      timeoutMs,
    );
    if (response.ok) html = await response.text();
  } catch {
    // yt-dlp remains available as an independent metadata fallback.
  }

  const htmlPlayerMetadata = html ? extractYoutubePlayerMetadata(html) : null;
  const htmlObservation: SourceMetrics | null = htmlPlayerMetadata
    ? {
        platform: "youtube",
        videoId,
        viewCount: htmlPlayerMetadata.viewCount,
        observedAt: new Date(startedAt).toISOString(),
      }
    : null;
  if (htmlObservation?.viewCount !== null) return htmlObservation;

  const remainingAfterHtml = Math.max(0, timeoutMs - (Date.now() - startedAt));
  let playerObservation: SourceMetrics | null = null;
  if (html && remainingAfterHtml > 0) {
    const player = await fetchYoutubePlayerMetadata(fetchImpl, {
      html,
      videoId,
      timeoutMs: remainingAfterHtml,
    });
    if (player) {
      playerObservation = {
        platform: "youtube",
        videoId,
        viewCount: player.viewCount,
        observedAt: new Date().toISOString(),
      };
      if (player.viewCount !== null) return playerObservation;
    }
  }

  const remainingAfterPlayer = Math.max(0, timeoutMs - (Date.now() - startedAt));
  if (ytDlpPath && remainingAfterPlayer > 0) {
    const metadata = await fetchMediaMetadataWithYtDlp({
      ytDlpPath,
      url: watchUrl,
      timeoutMs: remainingAfterPlayer,
    });
    if (metadata) {
      return {
        platform: "youtube",
        videoId,
        viewCount: metadata.viewCount,
        observedAt: new Date().toISOString(),
      };
    }
  }

  return playerObservation ?? htmlObservation;
}
