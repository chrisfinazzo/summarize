import { executeSummarize } from "../application/execute-summarize.js";
import type { SummarizeRunRequest } from "../application/run-spec.js";
import type { SummarizeRequest, SummarizeRuntime } from "../application/summarize-contracts.js";
import type { SlideSettings } from "../slides/index.js";
import { presentCliSummarizeResult } from "./cli-summarize-output.js";
import type { UrlFlowContext } from "./flows/url/types.js";

export type CliUrlSummaryExecutor = (options: {
  ctx: UrlFlowContext;
  url: string;
  isYoutubeUrl: boolean;
}) => Promise<void>;

export function createCliUrlSummaryExecutor(options: {
  baseRequest: SummarizeRunRequest;
  runtime: SummarizeRuntime;
  slides: SlideSettings | null;
  maxExtractCharacters: number | null;
}): CliUrlSummaryExecutor {
  const { input, slides: plannedSlides, ...requestDefaults } = options.baseRequest;
  void input;
  void plannedSlides;

  return async ({ ctx, url, isYoutubeUrl }) => {
    const request: SummarizeRequest = {
      ...requestDefaults,
      input: {
        kind: "url",
        url,
        title: null,
        maxCharacters: options.maxExtractCharacters,
      },
      slides: options.slides,
    };
    const result = await executeSummarize(request, options.runtime, undefined, {
      urlFlowContext: ctx,
      isYoutubeUrl,
    });
    await presentCliSummarizeResult({ ctx, result });
  };
}
