import type { AssistantMessage, Message, Tool } from "@earendil-works/pi-ai";
import { streamAnthropic } from "./direct-provider/anthropic";
import { resolveDirectModel, type DirectModelConfig } from "./direct-provider/config";
import { streamGoogle } from "./direct-provider/google";
import { streamOpenAiCompatible } from "./direct-provider/openai-compatible";
import type { DirectStreamEvent, ProviderStreamOptions } from "./direct-provider/shared";
import type { ProviderSettings } from "./settings";

export {
  providerLabel,
  resolveDirectModel,
  resolveDirectProviderForModel,
} from "./direct-provider/config";
export type { DirectModelConfig } from "./direct-provider/config";
export type { DirectStreamEvent } from "./direct-provider/shared";

type DirectStreamOptions = {
  model: string;
  providerSettings: ProviderSettings;
  system: string;
  messages: Message[];
  tools?: Tool[];
  maxTokens?: number;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
};

function providerStreamOptions(
  options: DirectStreamOptions,
  config: DirectModelConfig,
): ProviderStreamOptions {
  return {
    config,
    system: options.system,
    messages: options.messages,
    tools: options.tools ?? [],
    maxTokens: options.maxTokens ?? 4096,
    signal: options.signal,
    fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis),
  };
}

async function* streamResolvedDirectModel(
  options: ProviderStreamOptions,
): AsyncGenerator<DirectStreamEvent> {
  switch (options.config.provider) {
    case "anthropic":
      yield* streamAnthropic(options);
      return;
    case "google":
      yield* streamGoogle(options);
      return;
    default:
      yield* streamOpenAiCompatible(options);
  }
}

export async function* streamDirectModel(
  options: DirectStreamOptions,
): AsyncGenerator<DirectStreamEvent> {
  const config = resolveDirectModel(options.model, options.providerSettings);
  yield* streamResolvedDirectModel(providerStreamOptions(options, config));
}

export async function completeDirectText(
  options: Omit<DirectStreamOptions, "messages"> & { prompt: string },
): Promise<{ text: string; assistant: AssistantMessage; config: DirectModelConfig }> {
  const config = resolveDirectModel(options.model, options.providerSettings);
  const streamOptions = providerStreamOptions(
    {
      ...options,
      messages: [{ role: "user", content: options.prompt, timestamp: Date.now() }],
    },
    config,
  );
  let text = "";
  let assistant: AssistantMessage | null = null;
  for await (const event of streamResolvedDirectModel(streamOptions)) {
    if (event.type === "text") text += event.text;
    else assistant = event.assistant;
  }
  if (!assistant || !text.trim()) throw new Error("Provider returned no text.");
  return { text: text.trim(), assistant, config };
}
