// API types shared across the frontend

export interface LoginResponse {
  token: string
  student_id: string
  display_name: string
  role: string
  cohort_id: string
  subject_ids: string[]
}

export interface Session {
  session_id: string
  token: string
}

export interface FileNode {
  name: string
  path: string
  kind: 'file' | 'dir'
  size?: number
  children?: FileNode[]
}

export type WsEnvelopeType =
  | 'show_image'
  | 'file_change'
  | 'progress_update'
  | 'chat_start'
  | 'tool_start'
  | 'tool_result'
  | 'tool_end'
  | 'assistant_text'
  | 'chat_end'

export interface WsEnvelope {
  type: WsEnvelopeType
  payload: unknown
}

export interface ShowImagePayload {
  path: string        // path inside student workspace
  data_url: string    // base64 PNG data-URL
}

export interface AssignmentProgress {
  assignment_id: string
  title: string
  total_score: number
  max_score: number
  submitted: boolean
  questions: QuestionProgress[]
}

export interface QuestionProgress {
  question_id: string
  prompt: string
  type: string
  answered: boolean
  correct: boolean
  score: number
  max_points: number
  attempts: number
}

// Chat panel message types
export type ChatRole = 'user' | 'assistant'

export type MessageSegment =
  | { kind: 'text'; content: string }
  | { kind: 'tool'; tool: string; command: string; exitCode: number; done: boolean; output: string }
  | { kind: 'image'; dataUrl: string; mimeType: string }

export interface ChatMessage {
  id: string
  role: ChatRole
  segments: MessageSegment[]
  pending: boolean    // true while still streaming
}

// Admin entity shapes
export interface Cohort {
  id: string
  title: string
  created_at: string
}

export interface Subject {
  id: string
  cohort_id: string
  slug: string
  title: string
  created_at: string
}

export interface Assignment {
  id: string
  subject_id: string
  title: string
  description: string
  due_date: string | null
  created_by: string
  created_at: string
}

// Model / token types
export interface Model {
  id: string
  name: string
  display_name: string
  enabled: number   // 1 = enabled
  multiplier: number
  created_at: string
}

export interface SessionModels {
  models: string[]  // model name strings, default first
  active: string
}

export interface TokenUsage {
  total_tokens_used: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_creation_tokens: number
  total_cache_read_tokens: number
  turn_count: number
}

export interface TurnTokenUsage {
  model: string
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export interface Cost {
  amount: number
  currency: string
}

export interface TokenUsageUpdate {
  used: number           // total tokens used
  size?: number          // token context window size
  cost?: Cost | null     // cost from goose provider
}

