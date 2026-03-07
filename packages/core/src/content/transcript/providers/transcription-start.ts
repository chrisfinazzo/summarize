import type { TranscriptionProviderHint } from "../../link-preview/deps.js";
import { isOnnxCliConfigured, resolvePreferredOnnxModel } from "../../../transcription/onnx-cli.js";
import {
  isWhisperCppReady,
  resolveWhisperCppModelNameForDisplay,
} from "../../../transcription/whisper.js";
import { resolveGeminiTranscriptionModel } from "../../../transcription/whisper/provider-setup.js";
import { resolveTranscriptionConfig, type TranscriptionConfig } from "../transcription-config.js";

type Env = Record<string, string | undefined>;

export type TranscriptionAvailability = {
  preferredOnnxModel: ReturnType<typeof resolvePreferredOnnxModel>;
  onnxReady: boolean;
  hasLocalWhisper: boolean;
  hasGroq: boolean;
  hasGemini: boolean;
  hasOpenai: boolean;
  hasFal: boolean;
  hasAnyProvider: boolean;
  geminiModelId: string;
};

export async function resolveTranscriptionAvailability({
  env,
  transcription,
  groqApiKey,
  geminiApiKey,
  openaiApiKey,
  falApiKey,
}: {
  env?: Env;
  transcription?: Partial<TranscriptionConfig> | null;
  groqApiKey?: string | null;
  geminiApiKey?: string | null;
  openaiApiKey?: string | null;
  falApiKey?: string | null;
}): Promise<TranscriptionAvailability> {
  const effective = resolveTranscriptionConfig({
    env,
    transcription,
    groqApiKey,
    geminiApiKey,
    openaiApiKey,
    falApiKey,
  });
  const effectiveEnv = effective.env ?? process.env;
  const preferredOnnxModel = resolvePreferredOnnxModel(effectiveEnv);
  const onnxReady = preferredOnnxModel
    ? isOnnxCliConfigured(preferredOnnxModel, effectiveEnv)
    : false;

  const hasLocalWhisper = await isWhisperCppReady();
  const hasGroq = Boolean(effective.groqApiKey);
  const hasGemini = Boolean(effective.geminiApiKey);
  const hasOpenai = Boolean(effective.openaiApiKey);
  const hasFal = Boolean(effective.falApiKey);
  const hasAnyProvider =
    onnxReady || hasLocalWhisper || hasGroq || hasGemini || hasOpenai || hasFal;

  return {
    preferredOnnxModel,
    onnxReady,
    hasLocalWhisper,
    hasGroq,
    hasGemini,
    hasOpenai,
    hasFal,
    hasAnyProvider,
    geminiModelId: effective.geminiModel ?? resolveGeminiTranscriptionModel(effectiveEnv),
  };
}

export async function resolveTranscriptionStartInfo({
  env,
  transcription,
  groqApiKey,
  geminiApiKey,
  openaiApiKey,
  falApiKey,
}: {
  env?: Env;
  transcription?: Partial<TranscriptionConfig> | null;
  groqApiKey?: string | null;
  geminiApiKey?: string | null;
  openaiApiKey?: string | null;
  falApiKey?: string | null;
}): Promise<{
  availability: TranscriptionAvailability;
  providerHint: TranscriptionProviderHint;
  modelId: string | null;
}> {
  const availability = await resolveTranscriptionAvailability({
    env,
    transcription,
    groqApiKey,
    geminiApiKey,
    openaiApiKey,
    falApiKey,
  });

  const providerHint: TranscriptionProviderHint = availability.onnxReady
    ? "onnx"
    : availability.hasLocalWhisper
      ? "cpp"
      : resolveCloudProviderHint(availability);

  const modelId =
    providerHint === "onnx"
      ? availability.preferredOnnxModel
        ? `onnx/${availability.preferredOnnxModel}`
        : "onnx"
      : providerHint === "cpp"
        ? ((await resolveWhisperCppModelNameForDisplay()) ?? "whisper.cpp")
        : resolveCloudModelId(availability);

  return { availability, providerHint, modelId };
}

function resolveCloudModelId(availability: TranscriptionAvailability): string | null {
  const parts: string[] = [];
  if (availability.hasGroq) parts.push("groq/whisper-large-v3-turbo");
  if (availability.hasGemini) parts.push(`google/${availability.geminiModelId}`);
  if (availability.hasOpenai) parts.push("whisper-1");
  if (availability.hasFal) parts.push("fal-ai/wizper");
  return parts.length > 0 ? parts.join("->") : null;
}

function resolveCloudProviderHint(
  availability: TranscriptionAvailability,
): TranscriptionProviderHint {
  const parts: string[] = [];
  if (availability.hasGroq) parts.push("groq");
  if (availability.hasGemini) parts.push("gemini");
  if (availability.hasOpenai) parts.push("openai");
  if (availability.hasFal) parts.push("fal");
  const chain = parts.join("->");
  return chain.length > 0 ? (chain as TranscriptionProviderHint) : "unknown";
}
