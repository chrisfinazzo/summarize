import { describe, expect, it, vi } from "vitest";

const whisperMock = vi.hoisted(() => ({
  isWhisperCppReady: vi.fn(),
  resolveWhisperCppModelNameForDisplay: vi.fn(),
}));

vi.mock("../packages/core/src/transcription/whisper.js", () => whisperMock);

import {
  buildMissingTranscriptionProviderResult,
  resolveTranscriptProviderCapabilities,
} from "../packages/core/src/content/transcript/providers/transcription-capability.js";

describe("transcription provider capabilities", () => {
  it("reports missing providers and yt-dlp fallback as unavailable", async () => {
    whisperMock.isWhisperCppReady.mockResolvedValue(false);
    whisperMock.resolveWhisperCppModelNameForDisplay.mockResolvedValue(null);

    const capabilities = await resolveTranscriptProviderCapabilities({
      transcription: {
        env: {},
        groqApiKey: null,
        assemblyaiApiKey: null,
        geminiApiKey: null,
        openaiApiKey: null,
        falApiKey: null,
      },
      ytDlpPath: "/usr/bin/yt-dlp",
    });

    expect(capabilities.canTranscribe).toBe(false);
    expect(capabilities.canRunYtDlp).toBe(false);
    expect(capabilities.missingProviderNote).toContain("Missing transcription provider");
  });

  it("reports yt-dlp fallback as available when a transcription provider exists", async () => {
    whisperMock.isWhisperCppReady.mockResolvedValue(false);
    whisperMock.resolveWhisperCppModelNameForDisplay.mockResolvedValue(null);

    const capabilities = await resolveTranscriptProviderCapabilities({
      transcription: {
        env: {},
        groqApiKey: null,
        assemblyaiApiKey: "AAI",
        geminiApiKey: null,
        openaiApiKey: null,
        falApiKey: null,
      },
      ytDlpPath: "/usr/bin/yt-dlp",
    });

    expect(capabilities.canTranscribe).toBe(true);
    expect(capabilities.canRunYtDlp).toBe(true);
  });

  it("builds a provider-missing result with appended notes", () => {
    const result = buildMissingTranscriptionProviderResult({
      attemptedProviders: [],
      metadata: { provider: "podcast", reason: "missing_transcription_keys" },
      notes: ["extra context"],
    });

    expect(result.text).toBeNull();
    expect(result.source).toBeNull();
    expect(result.metadata).toEqual({
      provider: "podcast",
      reason: "missing_transcription_keys",
    });
    expect(result.notes).toContain("Missing transcription provider");
    expect(result.notes).toContain("extra context");
  });
});
