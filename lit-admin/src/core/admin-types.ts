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
  token_blocked_at: string | null;
  token_block_banner: string | null;
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
  student_id: string;
  amount: number;
  reason: string;
  created_at: string;
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

export interface Assignment {
  id: string;
  subject_id: string;
  title: string;
  description: string;
  due_date: string | null;
  created_by: string;
  created_at: string;
}

export interface CreateAssignmentBody {
  subject_id: string;
  title: string;
  description?: string;
  due_date?: string;
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
  multiplier: number;
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
