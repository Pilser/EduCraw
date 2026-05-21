// NOTE: LIST_CODES is REFERENCE-ONLY (file is a comment block).
// The actual list_codes query is built dynamically in
// educlaw-helix/src/backend/token_codes.rs :: _list_codes()
// using raw_query() directly, bypassing the template system.
pub const LIST_CODES: &str = include_str!("../../../../helixQueries/educraw-queries/read/token_codes/list_codes.json");
pub const EXPORT_CODES: &str = include_str!("../../../../helixQueries/educraw-queries/read/token_codes/export_codes.json");
pub const REDEEM_CODE_LOOKUP: &str = include_str!("../../../../helixQueries/educraw-queries/read/token_codes/redeem_code_lookup.json");
