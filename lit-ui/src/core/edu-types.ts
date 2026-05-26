// API types mirroring EduCrawl server responses

export interface LoginResponse {
  token: string;
  student_id: string;
  display_name: string;
  role: string;
  cohort_id: string;
  subject_ids: string[];
}

export interface Session {
  session_id: string;
  ws_url: string;
  token: string;
}

export interface EduModel {
  id: string;
  name: string;
  display_name: string;
  enabled: number; // 1 = enabled
  multiplier: number;
  provider?: string | null;
  think_mode?: number | null; // 1 = thinking supported
  visual_support: number; // 1 = vision supported
  thinking_params?: Record<string, unknown> | null;
  created_at: string;
}

export interface SessionModels {
  models: EduModel[];
  active: string;
}

// Backend SessionTokenTotals structure
export interface TokenUsage {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  turn_count: number;
}

// WebSocket frame types (from server → client)
// Only streaming types stay on WS (others moved to REST)
export type WsFrameType =
  | "user_text"
  | "assistant_text"
  | "thinking"
  | "tool_start"
  | "tool_end"
  | "token_usage"
  | "plan_update"
  | "mode_update"
  | "session_info_update"
  | "config_update"
  | "available_commands";

export interface WsFrame {
  type: WsFrameType;
  [key: string]: unknown;
}

// Thread / session management types (REST)
export interface SessionListItem {
  id: string;
  title?: string;
  updated_at?: string;
  cwd: string;
  metadata?: { messageCount?: number; [key: string]: unknown };
}

export interface ForkThreadResult {
  new_session_id: string;
}

export interface ImportThreadResult {
  session_id: string;
  title: string | null;
  message_count: number;
}

export interface WsToolStartFrame extends WsFrame {
  type: "tool_start";
  name: string;
  input: string;
}

export interface WsToolEndFrame extends WsFrame {
  type: "tool_end";
  status: "completed" | "failed";
  exit_code: number;
  stdout: string;
  stderr: string;
}

export interface WsTokenUsageFrame extends WsFrame {
  type: "token_usage";
  used: number;
  size?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cost?: { amount: number; currency: string } | null;
}

export interface WsTextFrame extends WsFrame {
  type: "assistant_text" | "user_text";
  text: string;
}

// Cohort
export interface Cohort {
  id: string;
  title: string;
  created_at: string;
}

// GET /me response
export interface MeResponse {
  id: string;
  username: string;
  display_name: string;
  role: string;
  cohort_id: string;
  cohort_title?: string | null;
  token_balance: number;
  available_cohorts: Cohort[];
}

// PATCH /me request
export interface UpdateMeRequest {
  display_name?: string;
  cohort_id?: string;
  current_password?: string;
  new_password?: string;
}

// GET /files/student/:session_id/quota response
export interface QuotaResponse {
  used_bytes: number;
  quota_bytes: number;
}

// PATCH /me response
export interface UpdateMeResponse {
  token: string;
  display_name: string;
  cohort_id: string;
  subject_ids: string[];
}

// ============================================================================
// Backend-native message types (no pi-ai dependencies)
// ============================================================================

export interface BackendTextBlock {
  type: "text";
  text: string;
}

export interface BackendThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface BackendToolCallBlock {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  resultStatus?: string;
  resultStdout?: string;
  resultStderr?: string;
  resultExitCode?: number;
}

export type BackendContentBlock =
  | BackendTextBlock
  | BackendThinkingBlock
  | BackendToolCallBlock;

export interface BackendAssistantMessage {
  role: "assistant";
  content: BackendContentBlock[];
  model?: string;
  provider?: string;
  api?: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  };
  stopReason?: string;
  errorMessage?: string;
  timestamp: number;
}

export interface BackendUserMessage {
  role: "user";
  content: string | Array<{ type: "text"; text: string }>;
  timestamp: number;
}

export interface BackendUserMessageWithAttachments {
  role: "user-with-attachments";
  content: string | Array<{ type: "text"; text: string }>;
  timestamp: number;
  attachments?: Array<{
    id: string;
    type: "image" | "document";
    fileName: string;
    mimeType: string;
    size: number;
    content: string;
    extractedText?: string;
    preview?: string;
  }>;
}

export type BackendMessage =
  | BackendUserMessage
  | BackendUserMessageWithAttachments
  | BackendAssistantMessage;
