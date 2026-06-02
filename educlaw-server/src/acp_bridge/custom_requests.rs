// educlaw-server/src/acp_bridge/custom_requests.rs
//
// Re-exports of goose-sdk custom ACP request/response types. Every
// consumer in educlaw-server imports through this module so swapping
// the upstream SDK is a one-file change.

pub use goose_sdk::custom_requests::{
    // Session management
    DeleteSessionRequest, ExportSessionRequest, ImportSessionRequest, ImportSessionResponse,
    // Recipe CRUD + session integration
    ApplyRecipeToSessionRequest, ApplyRecipeToSessionResponse, CreateRecipeRequest,
    CreateRecipeResponse, DeleteRecipeRequest, ExportRecipeRequest, ExportRecipeResponse,
    GenerateFromSessionRequest, GenerateFromSessionResponse, ImportRecipeRequest,
    ImportRecipeResponse, ListRecipesRequest, ListRecipesResponse, ReadRecipeRequest,
    ReadRecipeResponse, RecipeEntry, RecipeParameterDto,
};
