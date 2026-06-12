export const YT_DLP_PROGRESS_TEMPLATE =
  "progress:%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s";

export type YtDlpMediaMetadata = {
  durationSeconds: number | null;
  viewCount: number | null;
};

export function buildYtDlpDownloadArgs({
  url,
  output,
  format,
  extractAudio,
  extraArgs,
  progress,
}: {
  url: string;
  output: string;
  format: string;
  extractAudio: boolean;
  extraArgs?: string[];
  progress: boolean;
}): string[] {
  return [
    "-f",
    format,
    ...(extractAudio ? ["-x", "--audio-format", "mp3"] : []),
    "--concurrent-fragments",
    "4",
    "--no-playlist",
    "--retries",
    "3",
    "--no-warnings",
    ...(url.startsWith("file://") ? ["--enable-file-urls"] : []),
    ...(progress
      ? ["--progress", "--newline", "--progress-template", YT_DLP_PROGRESS_TEMPLATE]
      : []),
    ...(extraArgs?.length ? extraArgs : []),
    "-o",
    output,
    url,
  ];
}

export function parseYtDlpProgressLine(
  line: string,
): { downloadedBytes: number; totalBytes: number | null } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("progress:")) return null;
  const payload = trimmed.slice("progress:".length);
  const [downloadedRaw, totalRaw, estimateRaw] = payload.split("|");
  const downloadedBytes = Number.parseFloat(downloadedRaw);
  if (!Number.isFinite(downloadedBytes) || downloadedBytes < 0) return null;
  const totalCandidate = Number.parseFloat(totalRaw);
  const estimateCandidate = Number.parseFloat(estimateRaw);
  const totalBytes =
    Number.isFinite(totalCandidate) && totalCandidate > 0
      ? totalCandidate
      : Number.isFinite(estimateCandidate) && estimateCandidate > 0
        ? estimateCandidate
        : null;
  return { downloadedBytes, totalBytes };
}

export function parseYtDlpMetadataOutput(stdout: string): YtDlpMediaMetadata | null {
  const jsonLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("{"));
  if (!jsonLine) return null;

  try {
    const parsed = JSON.parse(jsonLine) as { duration?: unknown; view_count?: unknown };
    const duration = typeof parsed.duration === "number" ? parsed.duration : Number.NaN;
    const viewCount = typeof parsed.view_count === "number" ? parsed.view_count : Number.NaN;
    return {
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
      viewCount: Number.isSafeInteger(viewCount) && viewCount >= 0 ? viewCount : null,
    };
  } catch {
    return null;
  }
}
