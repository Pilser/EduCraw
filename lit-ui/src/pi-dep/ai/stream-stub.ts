import { AssistantMessageEventStream } from "./utils/event-stream.js";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "./types.js";

/**
 * Stub - lit-ui always provides its own streamFn via ws-stream-fn.
 * This is never called at runtime but needed as a type default.
 */
export function streamSimple<TApi extends Api>(
	_model: Model<TApi>,
	_context: Context,
	_options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	throw new Error("streamSimple not available in browser build. Provide a custom streamFn.");
}
