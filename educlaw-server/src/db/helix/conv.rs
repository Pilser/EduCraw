// Conversion functions between helix and server types
use crate::db::{Model, Student, Session, Cohort, Subject, TokenCode, TokenDeductionRecord};

pub fn helix_model_to_local(h: educlaw_helix::Model) -> Model {
    Model {
        id: h.id, name: h.name, display_name: h.display_name, enabled: h.enabled,
        input_multiplier: h.input_multiplier, output_multiplier: h.output_multiplier,
        provider: h.provider, think_mode: h.think_mode, visual_support: h.visual_support,
        thinking_params: h.thinking_params, created_at: h.created_at,
    }
}

pub fn helix_student_to_local(h: educlaw_helix::Student) -> Student {
    Student {
        id: h.id, username: h.username, password_hash: h.password_hash,
        display_name: h.display_name, role: h.role, cohort_id: h.cohort_id,
        home_dir: h.home_dir, uid_slot: h.uid_slot, token_limit: h.token_limit,
        token_balance: h.token_balance, restriction_status: h.restriction_status,
        restriction_message: h.restriction_message, last_model: h.last_model,
        created_at: h.created_at, last_seen: h.last_seen,
    }
}

pub fn local_student_to_helix(l: &Student) -> educlaw_helix::Student {
    educlaw_helix::Student {
        id: l.id.clone(), username: l.username.clone(), password_hash: l.password_hash.clone(),
        display_name: l.display_name.clone(), role: l.role.clone(), cohort_id: l.cohort_id.clone(),
        home_dir: l.home_dir.clone(), uid_slot: l.uid_slot, token_limit: l.token_limit,
        token_balance: l.token_balance, restriction_status: l.restriction_status.clone(),
        restriction_message: l.restriction_message.clone(), last_model: l.last_model.clone(),
        created_at: l.created_at.clone(), last_seen: l.last_seen.clone(),
    }
}

pub fn helix_session_to_local(h: educlaw_helix::Session) -> Session {
    Session {
        id: h.id, student_id: h.student_id, state: h.state,
        namespace_pid: h.namespace_pid, overlay_mount: h.overlay_mount,
        model: h.model, last_input_at: h.last_input_at,
        last_token_checkpoint: h.last_token_checkpoint,
        started_at: h.started_at, ended_at: h.ended_at,
    }
}

pub fn local_session_to_helix(l: &Session) -> educlaw_helix::Session {
    educlaw_helix::Session {
        id: l.id.clone(), student_id: l.student_id.clone(), state: l.state.clone(),
        namespace_pid: l.namespace_pid, overlay_mount: l.overlay_mount.clone(),
        model: l.model.clone(), last_input_at: l.last_input_at.clone(),
        last_token_checkpoint: l.last_token_checkpoint,
        started_at: l.started_at.clone(), ended_at: l.ended_at.clone(),
    }
}

pub fn helix_cohort_to_local(h: educlaw_helix::Cohort) -> Cohort {
    Cohort { id: h.id, title: h.title, created_at: h.created_at }
}

pub fn local_cohort_to_helix(l: &Cohort) -> educlaw_helix::Cohort {
    educlaw_helix::Cohort { id: l.id.clone(), title: l.title.clone(), created_at: l.created_at.clone() }
}

pub fn helix_subject_to_local(h: educlaw_helix::Subject) -> Subject {
    Subject { id: h.id, cohort_id: h.cohort_id, slug: h.slug, title: h.title, created_at: h.created_at }
}

pub fn local_subject_to_helix(l: &Subject) -> educlaw_helix::Subject {
    educlaw_helix::Subject { id: l.id.clone(), cohort_id: l.cohort_id.clone(), slug: l.slug.clone(), title: l.title.clone(), created_at: l.created_at.clone() }
}

pub fn helix_token_code_to_local(h: educlaw_helix::TokenCode) -> TokenCode {
    TokenCode { id: h.id, code: h.code, tokens: h.tokens, used_by: h.used_by, used_at: h.used_at, created_at: h.created_at }
}

pub fn helix_deduction_to_local(h: educlaw_helix::TokenDeduction) -> TokenDeductionRecord {
    TokenDeductionRecord {
        id: h.id, student_id: h.student_id, session_id: h.session_id,
        model_name: h.model_name, input_multiplier: h.input_multiplier,
        output_multiplier: h.output_multiplier, input_tokens_used: h.input_tokens_used,
        output_tokens_used: h.output_tokens_used, input_tokens_deducted: h.input_tokens_deducted,
        output_tokens_deducted: h.output_tokens_deducted, tokens_used: h.tokens_used,
        tokens_deducted: h.tokens_deducted, balance_before: h.balance_before,
        balance_after: h.balance_after, recorded_at: h.recorded_at,
    }
}
