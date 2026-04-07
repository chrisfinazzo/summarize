import { describe, expect, it } from "vitest";
import {
  buildGitHubModelsHeaders,
  GITHUB_MODELS_API_VERSION,
  resolveGitHubCopilotBackendModelId,
  resolveGitHubModelsApiKey,
} from "../src/llm/github-models.js";

describe("github models helpers", () => {
  it("prefers GITHUB_TOKEN over GH_TOKEN and trims blanks", () => {
    expect(resolveGitHubModelsApiKey({ GITHUB_TOKEN: "  ghu_123  ", GH_TOKEN: "ghp_456" })).toBe(
      "ghu_123",
    );
    expect(resolveGitHubModelsApiKey({ GITHUB_TOKEN: "   ", GH_TOKEN: " ghp_456 " })).toBe(
      "ghp_456",
    );
    expect(resolveGitHubModelsApiKey({ GITHUB_TOKEN: "   ", GH_TOKEN: "   " })).toBeNull();
  });

  it("normalizes shorthand github-copilot model ids", () => {
    expect(resolveGitHubCopilotBackendModelId("gpt-5.4")).toBe("openai/gpt-5.4");
    expect(resolveGitHubCopilotBackendModelId("gpt-5.4-mini")).toBe("openai/gpt-5.4-mini");
    expect(resolveGitHubCopilotBackendModelId("gpt-5.4-nano")).toBe("openai/gpt-5.4-nano");
    expect(resolveGitHubCopilotBackendModelId("chatgpt-5")).toBe("openai/chatgpt-5");
    expect(resolveGitHubCopilotBackendModelId("o5")).toBe("openai/o5");
    expect(resolveGitHubCopilotBackendModelId("claude-sonnet-4.5")).toBe(
      "anthropic/claude-sonnet-4.5",
    );
    expect(resolveGitHubCopilotBackendModelId("claude-opus-4.6")).toBe("anthropic/claude-opus-4.6");
    expect(resolveGitHubCopilotBackendModelId("opus-4.6")).toBe("anthropic/claude-opus-4.6");
    expect(resolveGitHubCopilotBackendModelId("sonnet-4.6")).toBe("anthropic/claude-sonnet-4.6");
    expect(resolveGitHubCopilotBackendModelId("gemini-3-flash")).toBe("google/gemini-3-flash");
    expect(resolveGitHubCopilotBackendModelId("gemini-3.1-pro")).toBe("google/gemini-3.1-pro");
    expect(resolveGitHubCopilotBackendModelId("grok-code-fast-1")).toBe("xai/grok-code-fast-1");
    expect(resolveGitHubCopilotBackendModelId("meta/llama-3.3-70b-instruct")).toBe(
      "meta/llama-3.3-70b-instruct",
    );
    expect(resolveGitHubCopilotBackendModelId(" mistral-large ")).toBe("mistral-large");
    expect(resolveGitHubCopilotBackendModelId("")).toBe("");
    expect(resolveGitHubCopilotBackendModelId(" openai/gpt-5-chat ")).toBe("openai/gpt-5-chat");
  });

  it("adds github api headers without dropping existing ones", () => {
    expect(buildGitHubModelsHeaders()).toEqual({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_MODELS_API_VERSION,
    });
    expect(buildGitHubModelsHeaders({ Authorization: "Bearer token" })).toEqual({
      Authorization: "Bearer token",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_MODELS_API_VERSION,
    });
  });
});
