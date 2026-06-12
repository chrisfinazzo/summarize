import {
  probeMediaDurationSecondsWithFfprobe,
  type DiarizationPreference,
  type TranscriptionProvider,
  type TranscriptionSegment,
  transcribeMediaFileWithWhisper,
} from "../../../../transcription/whisper.js";
import { buildMissingTranscriptionProviderMessage } from "../../../../transcription/whisper/provider-setup.js";
import type { MediaCache } from "../../../cache/types.js";
import type { LinkPreviewProgressEvent } from "../../../link-preview/deps.js";
import { ProgressKind } from "../../../link-preview/deps.js";
import {
  resolveTranscriptionConfig,
  type TranscriptionConfig,
} from "../../transcription-config.js";
import { resolveTranscriptionStartInfo } from "../transcription-start.js";
import {
  acquireYtDlpMedia,
  type AcquiredYtDlpMedia,
  resolveYtDlpLocalMediaSource,
} from "./yt-dlp-media.js";

export {
  buildYtDlpDownloadArgs,
  fetchDurationSecondsWithYtDlp,
  fetchMediaMetadataWithYtDlp,
  type YtDlpMediaMetadata,
} from "./yt-dlp-process.js";

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

  const localFileInput = resolveYtDlpLocalMediaSource(url, mediaKind);
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
  let acquiredMedia: AcquiredYtDlpMedia | null = null;

  try {
    acquiredMedia = await acquireYtDlpMedia({
      ytDlpPath,
      url,
      service,
      mediaKind,
      mediaCache,
      downloadVideo,
      extraArgs,
      localFileInput,
      onProgress: progress,
      onNote: (note) => notes.push(note),
    });

    const probedDurationSeconds = await probeMediaDurationSecondsWithFfprobe(
      acquiredMedia.filePath,
    );
    progress?.({
      kind: ProgressKind.TranscriptWhisperStart,
      url,
      service,
      providerHint: startInfo.providerHint,
      modelId: startInfo.modelId,
      totalDurationSeconds: probedDurationSeconds,
      parts: null,
    });
    const result = await transcribeMediaFileWithWhisper({
      filePath: acquiredMedia.filePath,
      mediaType: acquiredMedia.mediaType,
      filename: acquiredMedia.filename,
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
    await acquiredMedia?.cleanup();
  }
};

function wrapError(prefix: string, error: unknown): Error {
  if (error instanceof Error) {
    return new Error(`${prefix}: ${error.message}`, { cause: error });
  }
  return new Error(`${prefix}: ${String(error)}`);
}
