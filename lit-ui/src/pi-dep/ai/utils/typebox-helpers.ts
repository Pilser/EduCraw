import { type TUnsafe, type TSchema } from "typebox";

/**
 * Creates a string enum schema compatible with Google's API and other providers
 * that don't support anyOf/const patterns.
 */
export function StringEnum<T extends readonly string[]>(
	values: T,
	options?: { description?: string; default?: T[number] },
): TUnsafe<T[number]> {
	return {
		type: "string",
		enum: [...values],
		...(options?.description && { description: options.description }),
		...(options?.default && { default: options.default }),
	} as unknown as TUnsafe<T[number]>;
}

/**
 * Stub - tool validation is handled by backend.
 * Returns arguments as-is without validation.
 */
export function validateToolArguments(_tool: { parameters: TSchema }, toolCall: { arguments: unknown }): unknown {
	return toolCall.arguments;
}
