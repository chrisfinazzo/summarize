export function resolveUrlFlowYtDlpPath({
  urlFetch,
  ytDlpPath,
  allowGuardedExternalDownloader = false,
}: {
  urlFetch?: typeof fetch;
  ytDlpPath: string | null;
  allowGuardedExternalDownloader?: boolean;
}): string | null {
  // External downloaders cannot share the daemon URL guard's DNS pinning or redirect checks.
  // Callers may opt in only after resolving the media source to a bounded,
  // trusted downloader target such as a canonical YouTube video URL.
  return urlFetch && !allowGuardedExternalDownloader ? null : ytDlpPath;
}
