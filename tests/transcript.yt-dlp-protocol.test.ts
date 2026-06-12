import { describe, expect, it } from "vitest";
import {
  buildYtDlpDownloadArgs,
  parseYtDlpMetadataOutput,
  parseYtDlpProgressLine,
  YT_DLP_PROGRESS_TEMPLATE,
} from "../packages/core/src/content/transcript/providers/youtube/yt-dlp-protocol";

describe("yt-dlp protocol", () => {
  it("builds file-safe progress download arguments", () => {
    expect(
      buildYtDlpDownloadArgs({
        url: "file:///tmp/video.mp4",
        output: "/tmp/audio.mp3",
        format: "bestaudio",
        extractAudio: true,
        extraArgs: ["--cookies", "/tmp/cookies.txt"],
        progress: true,
      }),
    ).toEqual([
      "-f",
      "bestaudio",
      "-x",
      "--audio-format",
      "mp3",
      "--concurrent-fragments",
      "4",
      "--no-playlist",
      "--retries",
      "3",
      "--no-warnings",
      "--enable-file-urls",
      "--progress",
      "--newline",
      "--progress-template",
      YT_DLP_PROGRESS_TEMPLATE,
      "--cookies",
      "/tmp/cookies.txt",
      "-o",
      "/tmp/audio.mp3",
      "file:///tmp/video.mp4",
    ]);
  });

  it("parses exact, estimated, missing, and invalid progress totals", () => {
    expect(parseYtDlpProgressLine("progress:1024|4096|0")).toEqual({
      downloadedBytes: 1024,
      totalBytes: 4096,
    });
    expect(parseYtDlpProgressLine("progress:2048||8192")).toEqual({
      downloadedBytes: 2048,
      totalBytes: 8192,
    });
    expect(parseYtDlpProgressLine("progress:3072||")).toEqual({
      downloadedBytes: 3072,
      totalBytes: null,
    });
    expect(parseYtDlpProgressLine("not-progress")).toBeNull();
    expect(parseYtDlpProgressLine("progress:-1|4096|0")).toBeNull();
  });

  it("normalizes metadata output", () => {
    expect(
      parseYtDlpMetadataOutput(
        'warning\n{"duration":123.5,"view_count":42}\n{"duration":999,"view_count":999}',
      ),
    ).toEqual({ durationSeconds: 123.5, viewCount: 42 });
    expect(parseYtDlpMetadataOutput('{"duration":0,"view_count":-1}')).toEqual({
      durationSeconds: null,
      viewCount: null,
    });
    expect(parseYtDlpMetadataOutput("warning only")).toBeNull();
    expect(parseYtDlpMetadataOutput("{invalid")).toBeNull();
  });
});
