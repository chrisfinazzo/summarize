import type { AssistantMessage, Message, Tool, ToolCall } from "@earendil-works/pi-ai";
import { providerLabel, type DirectModelConfig } from "./config";

export type DirectStreamEvent =
  | { type: "text"; text: string }
  | { type: "assistant"; assistant: AssistantMessage };

export type ProviderStreamOptions = {
  config: DirectModelConfig;
  system: string;
  messages: Message[];
  tools: Tool[];
  maxTokens: number;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
};

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function assistantMessage(
  config: DirectModelConfig,
  text: string,
  toolCalls: ToolCall[],
): AssistantMessage {
  return {
    role: "assistant",
    content: [...(text ? [{ type: "text" as const, text }] : []), ...toolCalls],
    timestamp: Date.now(),
    api:
      config.provider === "anthropic"
        ? "anthropic-messages"
        : config.provider === "google"
          ? "google-generative-ai"
          : "openai-completions",
    provider: config.provider,
    model: config.model,
    usage: emptyUsage(),
    stopReason: toolCalls.length > 0 ? "toolUse" : "stop",
  } as AssistantMessage;
}

export function safeJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length > 0 ? { event, data: data.join("\n") } : null;
}

export async function* parseSse(
  response: Response,
): AsyncGenerator<{ event: string; data: string }> {
  if (!response.body) throw new Error("Provider returned no response body.");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      while (true) {
        const boundary = /\r?\n\r?\n/.exec(buffer);
        if (!boundary || boundary.index == null) break;
        const parsed = parseSseBlock(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (parsed) yield parsed;
      }
    }
    const parsed = parseSseBlock(buffer);
    if (parsed) yield parsed;
  } finally {
    reader.releaseLock();
  }
}

export function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export async function providerHttpError(
  response: Response,
  config: DirectModelConfig,
): Promise<Error> {
  const raw = await response.text().catch(() => "");
  let detail = raw.trim();
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string } | string;
      message?: string;
    };
    detail =
      typeof parsed.error === "string"
        ? parsed.error
        : parsed.error?.message || parsed.message || detail;
  } catch {
    // Keep plain-text provider response.
  }
  const suffix = detail ? `: ${detail.slice(0, 600)}` : "";
  return new Error(`${providerLabel(config.provider)} API error (${response.status})${suffix}`);
}
