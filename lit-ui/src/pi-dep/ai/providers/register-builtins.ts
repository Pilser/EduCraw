export function registerBuiltInApiProviders(): void {
	// No-op in browser environment - providers are not needed
	// when using a proxy/stream function (e.g. ws-stream-fn)
}

export function resetApiProviders(): void {
	// No-op in browser environment
}

// Do not auto-register providers in browser
