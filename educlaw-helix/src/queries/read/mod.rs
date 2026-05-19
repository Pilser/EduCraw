mod models;
mod students;
mod sessions;
mod token_usage;
mod token_codes;
mod cohorts;
mod subjects;
mod api;

pub const ALL_NAMES: &[&str] = &[
    "list_models",
    "list_enabled",
    "get_model_by_name",
    "get_model_multipliers",
    "models_for_student",
    "raw_assignments_for_student",
    "get_student",
    "get_student_by_username",
    "list_students",
    "get_token_balance",
    "get_session",
    "list_active_sessions",
    "get_last_token_checkpoint",
    "student_total_tokens",
    "session_totals",
    "list_codes",
    "export_codes",
    "redeem_code_lookup",
    "get_cohort",
    "list_cohorts",
    "get_subject",
    "get_subject_by_slug",
    "list_subjects",
    "get_me",
    "get_session_models",
    "students_with_active_sessions",
    "deduction_history",
];

pub fn get(name: &str) -> Option<&'static str> {
    match name {
        "list_models" => Some(models::LIST_MODELS),
        "list_enabled" => Some(models::LIST_ENABLED),
        "get_model_by_name" => Some(models::GET_MODEL_BY_NAME),
        "get_model_multipliers" => Some(models::GET_MODEL_MULTIPLIERS),
        "models_for_student" => Some(models::MODELS_FOR_STUDENT),
        "raw_assignments_for_student" => Some(models::RAW_ASSIGNMENTS_FOR_STUDENT),
        "get_student" => Some(students::GET_STUDENT),
        "get_student_by_username" => Some(students::GET_STUDENT_BY_USERNAME),
        "list_students" => Some(students::LIST_STUDENTS),
        "get_token_balance" => Some(students::GET_TOKEN_BALANCE),
        "get_session" => Some(sessions::GET_SESSION),
        "list_active_sessions" => Some(sessions::LIST_ACTIVE_SESSIONS),
        "get_last_token_checkpoint" => Some(sessions::GET_LAST_TOKEN_CHECKPOINT),
        "student_total_tokens" => Some(token_usage::STUDENT_TOTAL_TOKENS),
        "session_totals" => Some(token_usage::SESSION_TOTALS),
        "list_codes" => Some(token_codes::LIST_CODES),
        "export_codes" => Some(token_codes::EXPORT_CODES),
        "redeem_code_lookup" => Some(token_codes::REDEEM_CODE_LOOKUP),
        "get_cohort" => Some(cohorts::GET_COHORT),
        "list_cohorts" => Some(cohorts::LIST_COHORTS),
        "get_subject" => Some(subjects::GET_SUBJECT),
        "get_subject_by_slug" => Some(subjects::GET_SUBJECT_BY_SLUG),
        "list_subjects" => Some(subjects::LIST_SUBJECTS),
        "get_me" => Some(api::GET_ME),
        "get_session_models" => Some(api::GET_SESSION_MODELS),
        "students_with_active_sessions" => Some(api::STUDENTS_WITH_ACTIVE_SESSIONS),
        "deduction_history" => Some(api::DEDUCTION_HISTORY),
        _ => None,
    }
}
