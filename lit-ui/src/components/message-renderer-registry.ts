import type { BackendMessage } from "../core/edu-types.js";
import type { TemplateResult } from "lit";

export type MessageRole = BackendMessage["role"];

export interface MessageRenderer<TMessage extends BackendMessage = BackendMessage> {
	render(message: TMessage): TemplateResult;
}

const messageRenderers = new Map<MessageRole, MessageRenderer<any>>();

export function registerMessageRenderer<TRole extends MessageRole>(
	role: TRole,
	renderer: MessageRenderer<Extract<BackendMessage, { role: TRole }>>,
): void {
	messageRenderers.set(role, renderer);
}

export function getMessageRenderer(role: MessageRole): MessageRenderer | undefined {
	return messageRenderers.get(role);
}

export function renderMessage(message: BackendMessage): TemplateResult | undefined {
	return messageRenderers.get(message.role)?.render(message);
}
