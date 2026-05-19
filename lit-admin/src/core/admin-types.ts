export interface LoginResponse {
  token: string;
  student_id: string;
  display_name: string;
  role: string;
  cohort_id: string;
  subject_ids: string[];
}

export interface AdminStudent {
  id: string;
  username: string;
  display_name: string;
  role: string;
  cohort_id: string;
  last_seen: string | null;
  has_active_session: boolean;
  token_limit: number | null;
  token_balance: number;
  restriction_status: string | null;
  restriction_message: string | null;
}

export interface CreateStudentBody {
  username: string;
  password: string;
  display_name: string;
  role?: string;
  cohort_id?: string;
}

export interface UpdateStudentBody {
  display_name?: string;
  cohort_id?: string;
  new_password?: string;
}

export interface TokenDeduction {
  id: string;
  session_id: string;
  model_name: string;
  input_multiplier: number;
  output_multiplier: number;
  input_tokens_used: number;
  output_tokens_used: number;
  input_tokens_deducted: number;
  output_tokens_deducted: number;
  tokens_used: number;
  tokens_deducted: number;
  balance_before: number;
  balance_after: number;
  recorded_at: string;
}

export interface StudentTokenUsage {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  turn_count: number;
}

export interface Cohort {
  id: string;
  title: string;
  created_at: string;
}

export interface Subject {
  id: string;
  cohort_id: string;
  slug: string;
  title: string;
  created_at: string;
}

export interface AdminSession {
  id: string;
  student_id: string;
  state: string;
  idle_secs: number | null;
  started_at: string;
}

export interface Model {
  id: string;
  name: string;
  display_name: string;
  enabled: number;
  input_multiplier: number;
  output_multiplier: number;
  provider?: string | null;
  think_mode?: number | null;
  visual_support: number;
  thinking_params?: Record<string, unknown> | null;
  created_at: string;
}

export interface ProviderSchema {
  provider: string;
  params: ConfigParamDef[];
}

export interface ConfigParamDef {
  key: string;
  type: "select" | "integer";
  values?: string[];
  default?: unknown;
  min?: number;
  max?: number;
  description?: string;
}

export interface TokenCode {
  id: string;
  code: string;
  tokens: number;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
}
