import { buildMissingTranscriptionProviderNote } from "../../../transcription/whisper/provider-setup.js";
import type { ProviderResult, TranscriptSource } from "../types.js";
import type { TranscriptionConfig } from "../transcription-config.js";
import {
  resolveTranscriptionAvailability,
  type TranscriptionAvailability,
} from "./transcription-start.js";

export type TranscriptProviderCapabilities = {
  availability: TranscriptionAvailability;
  canTranscribe: boolean;
  canRunYtDlp: boolean;
  missingProviderNote: string;
};

export async function resolveTranscriptProviderCapabilities({
  transcription,
  ytDlpPath,
}: {
  transcription: TranscriptionConfig;
  ytDlpPath?: string | null;
}): Promise<TranscriptProviderCapabilities> {
  const availability = await resolveTranscriptionAvailability({ transcription });
  return {
    availability,
    canTranscribe: availability.hasAnyProvider,
    canRunYtDlp: Boolean(ytDlpPath && availability.hasAnyProvider),
    missingProviderNote: buildMissingTranscriptionProviderNote(),
  };
}

export function buildMissingTranscriptionProviderResult(args: {
  attemptedProviders: TranscriptSource[];
  metadata: NonNullable<ProviderResult["metadata"]>;
  notes?: string[] | null;
}): ProviderResult {
  const notes = args.notes?.filter((note) => note.trim().length > 0) ?? [];
  return {
    text: null,
    source: null,
    attemptedProviders: args.attemptedProviders,
    metadata: args.metadata,
    notes: [buildMissingTranscriptionProviderNote(), ...notes].join("; "),
  };
}

