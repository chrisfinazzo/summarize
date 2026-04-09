import { describe, expect, it, vi } from "vitest";
import { createTranscriptProgressRenderer } from "../src/tty/progress/transcript.js";

describe("tty transcript progress renderer", () => {
  it("renders download line with total + rate and throttles rapid updates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const setText = vi.fn();
    const { onProgress, stop } = createTranscriptProgressRenderer({ spinner: { setText } });

    onProgress({
      kind: "transcript-media-download-start",
      url: "https://example.com",
      service: "podcast",
      mediaUrl: "https://cdn.example/episode.mp3",
      totalBytes: 4096,
    });
    expect(setText).toHaveBeenLastCalledWith("Downloading audio…");

    vi.setSystemTime(3_000);
    onProgress({
      kind: "transcript-media-download-progress",
      url: "https://example.com",
      service: "podcast",
      downloadedBytes: 2048,
      totalBytes: 4096,
    });
    expect(setText).toHaveBeenLastCalledWith(expect.stringContaining("2.0 KB/4.0 KB"));
    expect(setText).toHaveBeenLastCalledWith(expect.stringContaining("2.0s"));
    expect(setText).toHaveBeenLastCalledWith(expect.stringContaining("KB/s"));

    // Throttle: <100ms should skip spinner updates.
    const callsBefore = setText.mock.calls.length;
    vi.setSystemTime(3_050);
    onProgress({
      kind: "transcript-media-download-progress",
      url: "https://example.com",
      service: "podcast",
      downloadedBytes: 3072,
      totalBytes: 4096,
    });
    expect(setText.mock.calls.length).toBe(callsBefore);

    stop();
    vi.useRealTimers();
  });

  it("renders whisper line with duration-only and part counters", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const setText = vi.fn();
    const { onProgress } = createTranscriptProgressRenderer({ spinner: { setText } });

    onProgress({
      kind: "transcript-whisper-start",
      url: "https://example.com",
      service: "podcast",
      providerHint: "openai->fal",
      modelId: "whisper-1->fal-ai/wizper",
      totalDurationSeconds: 44,
      parts: 3,
    });

    const first = setText.mock.calls.at(-1)?.[0] ?? "";
    expect(first).toContain("Whisper/OpenAI, whisper-1");
    expect(first).not.toContain("FAL");
    expect(first).toContain("44s");

    vi.setSystemTime(12_000);
    onProgress({
      kind: "transcript-whisper-progress",
      url: "https://example.com",
      service: "podcast",
      processedDurationSeconds: 10,
      totalDurationSeconds: 44,
      partIndex: 1,
      parts: 3,
    });
    const next = setText.mock.calls.at(-1)?.[0] ?? "";
    expect(next).toContain("10s/44s");
    expect(next).toContain("1/3");
    expect(next).toContain("2.0s");

    vi.useRealTimers();
  });

  it("handles progress events before start (elapsed=0, no rate) and service variants", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const setText = vi.fn();
    const { onProgress } = createTranscriptProgressRenderer({ spinner: { setText } });

    onProgress({
      kind: "transcript-media-download-progress",
      url: "https://example.com",
      service: "youtube",
      downloadedBytes: 0,
      totalBytes: null,
    });
    const download = setText.mock.calls.at(-1)?.[0] ?? "";
    expect(download).toContain("Downloading audio (youtube, 0 B");
    expect(download).toContain("0.0s");
    expect(download).not.toContain("B/s");

    vi.setSystemTime(2_000);
    onProgress({
      kind: "transcript-whisper-progress",
      url: "https://example.com",
      service: "generic",
      processedDurationSeconds: null,
      totalDurationSeconds: null,
      partIndex: null,
      parts: null,
    });
    const whisper = setText.mock.calls.at(-1)?.[0] ?? "";
    expect(whisper).toContain("Transcribing (media, Whisper");
    expect(whisper).toContain("0.0s");

    vi.useRealTimers();
  });

  it("renders whisper.cpp label with model name", () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);

    const setText = vi.fn();
    const { onProgress } = createTranscriptProgressRenderer({ spinner: { setText } });

    onProgress({
      kind: "transcript-whisper-start",
      url: "https://example.com",
      service: "podcast",
      providerHint: "cpp",
      modelId: "base",
      totalDurationSeconds: 10,
      parts: null,
    });
    const line = setText.mock.calls.at(-1)?.[0] ?? "";
    expect(line).toContain("Whisper.cpp, base");

    vi.useRealTimers();
  });

  it("shows the active cloud transcriber instead of the fallback chain", () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);

    const setText = vi.fn();
    const { onProgress } = createTranscriptProgressRenderer({ spinner: { setText } });

    onProgress({
      kind: "transcript-whisper-start",
      url: "https://example.com",
      service: "podcast",
      providerHint: "groq->assemblyai->gemini->openai",
      modelId:
        "groq/whisper-large-v3-turbo->assemblyai/universal-2->google/gemini-2.5-flash->whisper-1",
      totalDurationSeconds: 10,
      parts: null,
    });
    const line = setText.mock.calls.at(-1)?.[0] ?? "";
    expect(line).toContain("Whisper/Groq, groq/whisper-large-v3-turbo");
    expect(line).not.toContain("AssemblyAI");
    expect(line).not.toContain("->");

    vi.useRealTimers();
  });

  it("updates OSC progress determinately when totals are known", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const setText = vi.fn();
    const setPercent = vi.fn();
    const setIndeterminate = vi.fn();
    const clear = vi.fn();
    const oscProgress = { setPercent, setIndeterminate, clear };
    const { onProgress, stop } = createTranscriptProgressRenderer({
      spinner: { setText },
      oscProgress,
    });

    onProgress({
      kind: "transcript-media-download-start",
      url: "https://example.com",
      service: "podcast",
      mediaUrl: "https://cdn.example/episode.mp3",
      totalBytes: 100,
    });
    expect(setPercent).toHaveBeenCalledWith("Downloading audio", 0);

    onProgress({
      kind: "transcript-whisper-start",
      url: "https://example.com",
      service: "podcast",
      providerHint: "openai",
      modelId: "whisper-1",
      totalDurationSeconds: 100,
      parts: 10,
    });
    expect(setPercent).toHaveBeenCalledWith("Transcribing", 0);

    onProgress({
      kind: "transcript-whisper-progress",
      url: "https://example.com",
      service: "podcast",
      processedDurationSeconds: 40,
      totalDurationSeconds: 100,
      partIndex: 4,
      parts: 10,
    });
    expect(setPercent).toHaveBeenLastCalledWith("Transcribing", 40);

    stop();
    vi.useRealTimers();
  });
});
