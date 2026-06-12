import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import {
  probeMediaDurationSecondsWithFfprobe,
  type DiarizationPreference,
  type TranscriptionProvider,
  type TranscriptionSegment,
  transcribeMediaFileWithWhisper,
} from "../../../../transcription/whisper.js";
import { buildMissingTranscriptionProviderMessage } from "../../../../transcription/whisper/provider-setup.js";
import { buildSharedVideoMediaCacheKey, type MediaCache } from "../../../cache/types.js";
import type { LinkPreviewProgressEvent } from "../../../link-preview/deps.js";
import { ProgressKind } from "../../../link-preview/deps.js";
import { resolveLocalDirectMediaSource } from "../../../local-file.js";
import {
  resolveTranscriptionConfig,
  type TranscriptionConfig,
} from "../../transcription-config.js";
import { resolveTranscriptionStartInfo } from "../transcription-start.js";
import { runYtDlpDownload } from "./yt-dlp-process.js";

export {
  buildYtDlpDownloadArgs,
  fetchDurationSecondsWithYtDlp,
  fetchMediaMetadataWithYtDlp,
  type YtDlpMediaMetadata,
} from "./yt-dlp-process.js";

const DEFAULT_AUDIO_FORMAT =
  "bestaudio[vcodec=none]/best[height<=360]/best[height<=480]/best[height<=720]/best";
const DEFAULT_SHARED_VIDEO_FORMAT =
  "bestvideo[height<=720][vcodec^=avc1][ext=mp4]/bestvideo[height<=720][ext=mp4]/bestvideo[height<=720],bestaudio[vcodec=none]";

type YtDlpTranscriptResult = {
  text: string | null;
  provider: TranscriptionProvider | null;
  error: Error | null;
  notes: string[];
  segments?: TranscriptionSegment[] | null;
};

type YtDlpRequest = {
  ytDlpPath: string | null;
  transcription?: Partial<TranscriptionConfig> | null;
  env?: Record<string, string | undefined>;
  groqApiKey?: string | null;
  assemblyaiApiKey?: string | null;
  elevenlabsApiKey?: string | null;
  geminiApiKey?: string | null;
  openaiApiKey?: string | null;
  falApiKey?: string | null;
  diarization?: DiarizationPreference | null;
  downloadVideo?: boolean;
  url: string;
  onProgress?: ((event: LinkPreviewProgressEvent) => void) | null;
  service?: "youtube" | "podcast" | "generic";
  mediaKind?: "video" | "audio" | null;
  mediaCache?: MediaCache | null;
  extraArgs?: string[];
};

export const fetchTranscriptWithYtDlp = async ({
  ytDlpPath,
  transcription,
  env,
  groqApiKey,
  assemblyaiApiKey,
  elevenlabsApiKey,
  geminiApiKey,
  openaiApiKey,
  falApiKey,
  diarization = null,
  downloadVideo = false,
  url,
  onProgress,
  service = "youtube",
  mediaKind = null,
  mediaCache = null,
  extraArgs,
}: YtDlpRequest): Promise<YtDlpTranscriptResult> => {
  const notes: string[] = [];
  const effectiveTranscription = resolveTranscriptionConfig({
    env,
    transcription,
    groqApiKey,
    assemblyaiApiKey,
    elevenlabsApiKey,
    geminiApiKey,
    openaiApiKey,
    falApiKey,
  });

  const localFileInput = resolveLocalDirectMediaSource(url, mediaKind);
  if (!ytDlpPath && !localFileInput) {
    return {
      text: null,
      provider: null,
      error: new Error("yt-dlp is not configured (set YT_DLP_PATH or ensure yt-dlp is on PATH)"),
      notes,
    };
  }
  const effectiveEnv = effectiveTranscription.env ?? process.env;
  const startInfo = await resolveTranscriptionStartInfo({
    transcription: effectiveTranscription,
    diarization,
  });

  if (
    (diarization && startInfo.providerHint === "unknown") ||
    (!diarization && !startInfo.availability.hasAnyProvider)
  ) {
    return {
      text: null,
      provider: null,
      error: new Error(
        diarization
          ? "Speaker diarization requires ELEVENLABS_API_KEY or OPENAI_API_KEY"
          : buildMissingTranscriptionProviderMessage(),
      ),
      notes,
    };
  }

  const progress = typeof onProgress === "function" ? onProgress : null;
  const providerHint = startInfo.providerHint;
  const modelId = startInfo.modelId;
  const mediaCacheKey = url;
  const sharedVideoMediaCacheKey = buildSharedVideoMediaCacheKey(url);
  const cachedMedia = localFileInput
    ? null
    : mediaCache
      ? await mediaCache.get({ url: mediaCacheKey })
      : null;
  const cachedSharedVideo =
    !localFileInput && downloadVideo && mediaCache
      ? await mediaCache.get({ url: sharedVideoMediaCacheKey })
      : null;
  if (cachedSharedVideo?.filePath) notes.push("shared slide video cache hit");

  const outputFile = join(tmpdir(), `summarize-${randomUUID()}.mp3`);
  let filePath = localFileInput?.filePath ?? cachedMedia?.filePath ?? outputFile;
  let mediaType =
    localFileInput?.mediaType ??
    cachedMedia?.mediaType ??
    inferMediaType(
      cachedMedia?.filename ?? cachedMedia?.filePath ?? "",
      downloadVideo ? "video" : "audio",
    ) ??
    "audio/mpeg";
  let filename =
    localFileInput?.filename ??
    cachedMedia?.filename ??
    (cachedMedia?.filePath ? basename(cachedMedia.filePath) : null) ??
    "audio.mp3";
  let cleanupDownloaded: (() => Promise<void>) | null = null;
  try {
    if (localFileInput) {
      notes.push("local file input");
    } else if (cachedMedia?.filePath) {
      progress?.({
        kind: ProgressKind.TranscriptMediaDownloadStart,
        url,
        service,
        mediaUrl: url,
        mediaKind,
        totalBytes: cachedMedia.sizeBytes ?? null,
      });
      progress?.({
        kind: ProgressKind.TranscriptMediaDownloadDone,
        url,
        service,
        downloadedBytes: cachedMedia.sizeBytes ?? 0,
        totalBytes: cachedMedia.sizeBytes ?? null,
        mediaKind,
      });
      notes.push("media cache hit");
    } else {
      if (!ytDlpPath) {
        throw new Error("yt-dlp is not configured (set YT_DLP_PATH or ensure yt-dlp is on PATH)");
      }
      progress?.({
        kind: ProgressKind.TranscriptMediaDownloadStart,
        url,
        service,
        mediaUrl: url,
        mediaKind,
        totalBytes: null,
      });
      const onDownloadProgress = progress
        ? (downloadedBytes: number, totalBytes: number | null) => {
            progress({
              kind: ProgressKind.TranscriptMediaDownloadProgress,
              url,
              service,
              downloadedBytes,
              totalBytes,
              mediaKind,
            });
          }
        : null;
      const downloaded =
        downloadVideo && !cachedSharedVideo?.filePath
          ? await downloadSlidesVideoAndAudio(ytDlpPath, url, extraArgs, onDownloadProgress)
          : await downloadAudio(ytDlpPath, url, outputFile, extraArgs, onDownloadProgress);
      filePath = downloaded.filePath;
      mediaType = downloaded.mediaType;
      filename = downloaded.filename;
      cleanupDownloaded = downloaded.cleanup;
      const stat = await fs.stat(filePath);
      progress?.({
        kind: ProgressKind.TranscriptMediaDownloadDone,
        url,
        service,
        downloadedBytes: stat.size,
        totalBytes: null,
        mediaKind,
      });

      if (downloaded.sharedVideo && mediaCache) {
        const storedVideo = await mediaCache.put({
          url: sharedVideoMediaCacheKey,
          filePath: downloaded.sharedVideo.filePath,
          mediaType: downloaded.sharedVideo.mediaType,
          filename: downloaded.sharedVideo.filename,
        });
        if (storedVideo?.filePath) notes.push("shared slide video cached");
      } else if (mediaCache) {
        const stored = await mediaCache.put({
          url: mediaCacheKey,
          filePath,
          mediaType,
          filename,
        });
        if (stored?.filePath) {
          filePath = stored.filePath;
          mediaType = stored.mediaType ?? mediaType;
          filename = stored.filename ?? filename;
          await cleanupDownloaded?.();
          cleanupDownloaded = null;
          notes.push("media cached");
        }
      }
    }

    const probedDurationSeconds = await probeMediaDurationSecondsWithFfprobe(filePath);
    progress?.({
      kind: ProgressKind.TranscriptWhisperStart,
      url,
      service,
      providerHint,
      modelId,
      totalDurationSeconds: probedDurationSeconds,
      parts: null,
    });
    const result = await transcribeMediaFileWithWhisper({
      filePath,
      mediaType,
      filename,
      groqApiKey: effectiveTranscription.groqApiKey,
      assemblyaiApiKey: effectiveTranscription.assemblyaiApiKey,
      elevenlabsApiKey: effectiveTranscription.elevenlabsApiKey,
      geminiApiKey: effectiveTranscription.geminiApiKey,
      openaiApiKey: effectiveTranscription.openaiApiKey,
      falApiKey: effectiveTranscription.falApiKey,
      diarization,
      totalDurationSeconds: probedDurationSeconds,
      env: effectiveEnv,
      onProgress: (event) => {
        progress?.({
          kind: ProgressKind.TranscriptWhisperProgress,
          url,
          service,
          processedDurationSeconds: event.processedDurationSeconds,
          totalDurationSeconds: event.totalDurationSeconds,
          partIndex: event.partIndex,
          parts: event.parts,
        });
      },
    });
    if (result.notes.length > 0) notes.push(...result.notes);
    return {
      text: result.text,
      provider: result.provider,
      error: result.error,
      notes,
      segments: result.segments ?? null,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("unable to obtain file audio codec with ffprobe")
    ) {
      return {
        text: "",
        provider: null,
        error: null,
        notes: [...notes, "yt-dlp: Media has no audio stream"],
      };
    }
    return {
      text: null,
      provider: null,
      error: wrapError("yt-dlp failed to download audio", error),
      notes,
    };
  } finally {
    await cleanupDownloaded?.();
  }
};

async function downloadAudio(
  ytDlpPath: string,
  url: string,
  outputFile: string,
  extraArgs?: string[],
  onProgress?: ((downloadedBytes: number, totalBytes: number | null) => void) | null,
): Promise<{
  filePath: string;
  mediaType: string;
  filename: string;
  sharedVideo?: undefined;
  cleanup: () => Promise<void>;
}> {
  await runYtDlpDownload({
    ytDlpPath,
    url,
    output: outputFile,
    format: DEFAULT_AUDIO_FORMAT,
    extractAudio: true,
    extraArgs,
    onProgress,
  });
  return {
    filePath: outputFile,
    mediaType: "audio/mpeg",
    filename: "audio.mp3",
    cleanup: async () => {
      await fs.unlink(outputFile).catch(() => {});
    },
  };
}

async function downloadSlidesVideoAndAudio(
  ytDlpPath: string,
  url: string,
  extraArgs?: string[],
  onProgress?: ((downloadedBytes: number, totalBytes: number | null) => void) | null,
): Promise<{
  filePath: string;
  mediaType: string;
  filename: string;
  sharedVideo: {
    filePath: string;
    mediaType: string;
    filename: string;
  };
  cleanup: () => Promise<void>;
}> {
  const dir = await fs.mkdtemp(join(tmpdir(), `summarize-shared-video-${randomUUID()}-`));
  const outputTemplate = join(dir, "media.%(vcodec)s.%(acodec)s.%(ext)s");
  try {
    await runYtDlpDownload({
      ytDlpPath,
      url,
      output: outputTemplate,
      format: DEFAULT_SHARED_VIDEO_FORMAT,
      extractAudio: false,
      extraArgs,
      onProgress,
    });
    const entries = await fs.readdir(dir);
    const candidates = (
      await Promise.all(
        entries
          .filter((entry) => !entry.endsWith(".part") && !entry.endsWith(".ytdl"))
          .map(async (entry) => {
            const filePath = join(dir, entry);
            const stat = await fs.stat(filePath).catch(() => null);
            return stat?.isFile() ? { filePath, size: stat.size } : null;
          }),
      )
    ).filter((entry): entry is { filePath: string; size: number } => entry !== null);
    const audio = candidates
      .filter((entry) => basename(entry.filePath).startsWith("media.none."))
      .sort((a, b) => b.size - a.size)[0];
    const video = candidates
      .filter((entry) => !basename(entry.filePath).startsWith("media.none."))
      .sort((a, b) => b.size - a.size)[0];
    if (!audio || !video) {
      throw new Error("yt-dlp completed without both audio and video streams");
    }
    const audioFilename = basename(audio.filePath);
    const videoFilename = basename(video.filePath);
    return {
      filePath: audio.filePath,
      mediaType: inferMediaType(audioFilename, "audio") ?? "audio/webm",
      filename: audioFilename,
      sharedVideo: {
        filePath: video.filePath,
        mediaType: inferMediaType(videoFilename, "video") ?? "video/mp4",
        filename: videoFilename,
      },
      cleanup: async () => {
        await fs.rm(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function inferMediaType(value: string, kind: "audio" | "video"): string | null {
  switch (extname(value).toLowerCase()) {
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".mp4":
    case ".m4v":
    case ".mov":
      return kind === "audio" ? "audio/mp4" : "video/mp4";
    case ".webm":
      return kind === "audio" ? "audio/webm" : "video/webm";
    case ".mkv":
      return "video/x-matroska";
    default:
      return null;
  }
}

function wrapError(prefix: string, error: unknown): Error {
  if (error instanceof Error) {
    return new Error(`${prefix}: ${error.message}`, { cause: error });
  }
  return new Error(`${prefix}: ${String(error)}`);
}
