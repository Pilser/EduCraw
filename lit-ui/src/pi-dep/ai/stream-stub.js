/**
 * Stub - lit-ui always provides its own streamFn via ws-stream-fn.
 * This is never called at runtime but needed as a type default.
 */
export function streamSimple(_model, _context, _options) {
    throw new Error("streamSimple not available in browser build. Provide a custom streamFn.");
}
