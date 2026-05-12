// Stub — Attachment overlay not needed for Phase 3
import { LitElement } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("attachment-overlay")
export class AttachmentOverlay extends LitElement {
  createRenderRoot() {
    return this;
  }
  static async open(_attachment: any): Promise<void> {}
}
