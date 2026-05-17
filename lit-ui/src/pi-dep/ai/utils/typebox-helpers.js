/**
 * Creates a string enum schema compatible with Google's API and other providers
 * that don't support anyOf/const patterns.
 */
export function StringEnum(values, options) {
    return {
        type: "string",
        enum: [...values],
        ...(options?.description && { description: options.description }),
        ...(options?.default && { default: options.default }),
    };
}
/**
 * Stub - tool validation is handled by backend.
 * Returns arguments as-is without validation.
 */
export function validateToolArguments(_tool, toolCall) {
    return toolCall.arguments;
}
