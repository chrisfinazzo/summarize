type Env = Record<string, string | undefined>;

export const DEFAULT_GEMINI_TRANSCRIPTION_MODEL = "gemini-2.5-flash";
export const GEMINI_TRANSCRIPTION_MODEL_ENV = "SUMMARIZE_GEMINI_TRANSCRIPTION_MODEL";
export const TRANSCRIPTION_PROVIDER_ENV_LIST = [
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "FAL_KEY",
] as const;
export const TRANSCRIPTION_PROVIDER_ENV_LABEL =
  "GROQ_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or FAL_KEY";

export function normalizeApiKey(raw: string | null | undefined): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveGeminiApiKey({
  env,
  geminiApiKey,
}: {
  env?: Env;
  geminiApiKey?: string | null;
}): string | null {
  const explicit = normalizeApiKey(geminiApiKey);
  if (explicit) return explicit;
  const source = env ?? process.env;
  return (
    normalizeApiKey(source.GEMINI_API_KEY) ??
    normalizeApiKey(source.GOOGLE_GENERATIVE_AI_API_KEY) ??
    normalizeApiKey(source.GOOGLE_API_KEY)
  );
}

export function resolveGeminiTranscriptionModel(env?: Env): string {
  const source = env ?? process.env;
  return source[GEMINI_TRANSCRIPTION_MODEL_ENV]?.trim() || DEFAULT_GEMINI_TRANSCRIPTION_MODEL;
}

export function buildMissingTranscriptionProviderMessage(): string {
  return `No transcription providers available (install whisper-cpp or set ${TRANSCRIPTION_PROVIDER_ENV_LABEL})`;
}

export function buildMissingTranscriptionProviderNote(): string {
  return `Missing transcription provider (install whisper-cpp or set ${TRANSCRIPTION_PROVIDER_ENV_LIST.join("/")})`;
}
