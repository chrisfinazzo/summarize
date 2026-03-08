import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_CLI_ORDER,
  DEFAULT_CLI_MODELS,
  envHasRequiredKey,
  isVideoUnderstandingCapableModelId,
  parseCliProviderName,
  requiredEnvForCliProvider,
  requiredEnvForGatewayProvider,
  resolveOpenAiCompatibleClientConfigForProvider,
  resolveRequiredEnvForModelId,
  supportsDocumentAttachments,
  supportsStreaming,
} from "../src/llm/provider-capabilities.js";

describe("llm provider capabilities", () => {
  it("exposes stable CLI defaults and parsing", () => {
    expect(DEFAULT_AUTO_CLI_ORDER).toEqual(["claude", "gemini", "codex", "agent"]);
    expect(DEFAULT_CLI_MODELS.gemini).toBe("gemini-3-flash");
    expect(parseCliProviderName(" GeMiNi ")).toBe("gemini");
    expect(requiredEnvForCliProvider("agent")).toBe("CLI_AGENT");
  });

  it("tracks native provider capabilities centrally", () => {
    expect(requiredEnvForGatewayProvider("google")).toBe("GEMINI_API_KEY");
    expect(supportsDocumentAttachments("google")).toBe(true);
    expect(supportsDocumentAttachments("xai")).toBe(false);
    expect(supportsStreaming("anthropic")).toBe(true);
    expect(isVideoUnderstandingCapableModelId("google/gemini-3-flash")).toBe(true);
    expect(isVideoUnderstandingCapableModelId("openai/gpt-5.2")).toBe(false);
  });

  it("handles provider env aliases", () => {
    expect(
      envHasRequiredKey(
        {
          GOOGLE_GENERATIVE_AI_API_KEY: "gemini",
        },
        "GEMINI_API_KEY",
      ),
    ).toBe(true);
    expect(envHasRequiredKey({ ZAI_API_KEY: "z" }, "Z_AI_API_KEY")).toBe(true);
    expect(envHasRequiredKey({}, "OPENAI_API_KEY")).toBe(false);
  });

  it("resolves provider requirements and OpenAI-compatible config centrally", () => {
    expect(resolveRequiredEnvForModelId("cli/gemini")).toBe("CLI_GEMINI");
    expect(resolveRequiredEnvForModelId("openrouter/openai/gpt-5-mini")).toBe("OPENROUTER_API_KEY");
    expect(resolveRequiredEnvForModelId("nvidia/meta/llama-3.1-8b-instruct")).toBe(
      "NVIDIA_API_KEY",
    );

    expect(
      resolveOpenAiCompatibleClientConfigForProvider({
        provider: "zai",
        openaiApiKey: "z-key",
        openrouterApiKey: null,
        openaiBaseUrlOverride: null,
      }),
    ).toEqual({
      apiKey: "z-key",
      baseURL: "https://api.z.ai/api/paas/v4",
      useChatCompletions: true,
      isOpenRouter: false,
    });
  });
});
