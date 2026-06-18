import type { Message, ToolCall } from "@earendil-works/pi-ai";
import {
  assistantMessage,
  messageText,
  parseSse,
  providerHttpError,
  safeJsonObject,
  type DirectStreamEvent,
  type ProviderStreamOptions,
} from "./shared";

function toGoogleContents(messages: Message[]) {
  const out: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", parts: [{ text: messageText(message) }] });
    } else if (message.role === "assistant") {
      const parts = Array.isArray(message.content)
        ? message.content.map((part) =>
            part.type === "toolCall"
              ? { functionCall: { name: part.name, args: part.arguments } }
              : part.type === "text"
                ? { text: part.text }
                : { text: "" },
          )
        : [{ text: messageText(message) }];
      out.push({ role: "model", parts });
    } else if (message.role === "toolResult") {
      out.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: message.toolName,
              response: {
                output: messageText(message),
                isError: message.isError,
              },
            },
          },
        ],
      });
    }
  }
  return out;
}

export async function* streamGoogle(
  options: ProviderStreamOptions,
): AsyncGenerator<DirectStreamEvent> {
  const endpoint = `${options.config.baseUrl}/models/${encodeURIComponent(
    options.config.model,
  )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(options.config.apiKey)}`;
  const response = await options.fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: options.system }] },
      contents: toGoogleContents(options.messages),
      generationConfig: { maxOutputTokens: options.maxTokens },
      ...(options.tools.length > 0
        ? {
            tools: [
              {
                functionDeclarations: options.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                })),
              },
            ],
          }
        : {}),
    }),
    signal: options.signal,
  });
  if (!response.ok) throw await providerHttpError(response, options.config);

  let text = "";
  const toolCalls: ToolCall[] = [];
  for await (const event of parseSse(response)) {
    const payload = safeJsonObject(event.data);
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    for (const rawCandidate of candidates) {
      if (!rawCandidate || typeof rawCandidate !== "object") continue;
      const candidate = rawCandidate as Record<string, unknown>;
      const content =
        candidate.content && typeof candidate.content === "object"
          ? (candidate.content as Record<string, unknown>)
          : {};
      const parts = Array.isArray(content.parts) ? content.parts : [];
      for (const rawPart of parts) {
        if (!rawPart || typeof rawPart !== "object") continue;
        const part = rawPart as Record<string, unknown>;
        if (typeof part.text === "string" && part.text) {
          text += part.text;
          yield { type: "text", text: part.text };
        }
        const fn =
          part.functionCall && typeof part.functionCall === "object"
            ? (part.functionCall as Record<string, unknown>)
            : null;
        if (fn && typeof fn.name === "string") {
          toolCalls.push({
            type: "toolCall",
            id: `call-${Date.now()}-${toolCalls.length}`,
            name: fn.name,
            arguments:
              fn.args && typeof fn.args === "object" ? (fn.args as Record<string, unknown>) : {},
          } as ToolCall);
        }
      }
    }
  }
  yield {
    type: "assistant",
    assistant: assistantMessage(options.config, text, toolCalls),
  };
}
