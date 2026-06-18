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

function toAnthropicMessages(messages: Message[]) {
  const out: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: messageText(message) });
      continue;
    }
    if (message.role === "assistant") {
      const content = Array.isArray(message.content)
        ? message.content.map((part) =>
            part.type === "toolCall"
              ? {
                  type: "tool_use",
                  id: part.id,
                  name: part.name,
                  input: part.arguments,
                }
              : part.type === "text"
                ? { type: "text", text: part.text }
                : { type: "text", text: "" },
          )
        : [{ type: "text", text: messageText(message) }];
      out.push({ role: "assistant", content });
      continue;
    }
    if (message.role === "toolResult") {
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId,
            content: messageText(message),
            is_error: message.isError,
          },
        ],
      });
    }
  }
  return out;
}

export async function* streamAnthropic(
  options: ProviderStreamOptions,
): AsyncGenerator<DirectStreamEvent> {
  const response = await options.fetchImpl(`${options.config.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": options.config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: options.config.model,
      system: options.system,
      messages: toAnthropicMessages(options.messages),
      max_tokens: options.maxTokens,
      stream: true,
      ...(options.tools.length > 0
        ? {
            tools: options.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
          }
        : {}),
    }),
    signal: options.signal,
  });
  if (!response.ok) throw await providerHttpError(response, options.config);

  let text = "";
  const pendingCalls = new Map<number, { id: string; name: string; arguments: string }>();
  for await (const event of parseSse(response)) {
    const payload = safeJsonObject(event.data);
    if (event.event === "content_block_start") {
      const index = typeof payload.index === "number" ? payload.index : 0;
      const block =
        payload.content_block && typeof payload.content_block === "object"
          ? (payload.content_block as Record<string, unknown>)
          : {};
      if (block.type === "tool_use") {
        pendingCalls.set(index, {
          id: typeof block.id === "string" ? block.id : "",
          name: typeof block.name === "string" ? block.name : "",
          arguments: "",
        });
      }
    }
    if (event.event !== "content_block_delta") continue;
    const index = typeof payload.index === "number" ? payload.index : 0;
    const delta =
      payload.delta && typeof payload.delta === "object"
        ? (payload.delta as Record<string, unknown>)
        : {};
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      text += delta.text;
      yield { type: "text", text: delta.text };
    }
    if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
      const call = pendingCalls.get(index);
      if (call) call.arguments += delta.partial_json;
    }
  }
  const toolCalls = Array.from(pendingCalls.values()).map(
    (call, index) =>
      ({
        type: "toolCall",
        id: call.id || `call-${Date.now()}-${index}`,
        name: call.name,
        arguments: safeJsonObject(call.arguments),
      }) as ToolCall,
  );
  yield {
    type: "assistant",
    assistant: assistantMessage(options.config, text, toolCalls),
  };
}
