import type { Model } from "@earendil-works/pi-ai";
import type { EduModel } from "./edu-types";

/**
 * Convert an EduCrawl server model to a pi-ai Model
 * that the Agent can use for display purposes.
 *
 * Since EduCrawl handles LLM calls server-side,
 * we only need minimal model info for the UI.
 */
export function eduModelToPiModel(eduModel: EduModel): Model<any> {
  return {
    id: eduModel.id,
    name: eduModel.display_name || eduModel.name,
    api: "unknown", // Server handles this
    provider: eduModel.provider || "unknown",
    baseUrl: "", // Not used (server-side)
    reasoning: eduModel.think_mode === 1,
    input: eduModel.visual_support === 1 ? ["text", "image"] : ["text"],
    contextWindow: 200000,
    maxTokens: 8192,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
  };
}
