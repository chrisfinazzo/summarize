export {
  DEFAULT_AUTO_CLI_ORDER,
  DEFAULT_CLI_MODELS,
  envHasRequiredKey,
  getGatewayProviderProfile,
  isVideoUnderstandingCapableModelId,
  isVideoUnderstandingCapableProvider,
  parseCliProviderName,
  requiredEnvForCliProvider,
  requiredEnvForGatewayProvider,
  resolveOpenAiCompatibleClientConfigForProvider,
  resolveRequiredEnvForModelId,
  supportsDocumentAttachments,
  supportsStreaming,
} from "./provider-profile.js";

export type { GatewayProvider, RequiredModelEnv } from "./provider-profile.js";
