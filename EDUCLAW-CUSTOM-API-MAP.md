# Goose Custom APIs

Custom APIs called via same SACP pipe as standard ACP. All use `cx.send_request()`.

**SDK Location**: [goose-sdk/src/custom_requests.rs](goose-workspace/crates/goose-sdk/src/custom_requests.rs)

---

## Extensions Management

### Add Extension
- **Method**: `_goose/extensions/add`
- **Request**: `AddExtensionRequest` (L25-32)
- **Response**: `EmptyResponse`

### Remove Extension
- **Method**: `_goose/extensions/remove`
- **Request**: `RemoveExtensionRequest` (L35-40)
- **Response**: `EmptyResponse`

### Get Extensions Config
- **Method**: `_goose/config/extensions`
- **Request**: `GetExtensionsRequest` (L94-97)
- **Response**: `GetExtensionsResponse` (L101-105)

### Add Extension to Config
- **Method**: `_goose/config/extensions/add`
- **Request**: `AddConfigExtensionRequest` (L108-119)
- **Response**: `EmptyResponse`

### Remove Extension from Config
- **Method**: `_goose/config/extensions/remove`
- **Request**: `RemoveConfigExtensionRequest` (L123-126)
- **Response**: `EmptyResponse`

### Toggle Extension in Config
- **Method**: `_goose/config/extensions/toggle`
- **Request**: `ToggleConfigExtensionRequest` (L130-134)
- **Response**: `EmptyResponse`

### Get Session Extensions
- **Method**: `_goose/session/extensions`
- **Request**: `GetSessionExtensionsRequest` (L137-141)
- **Response**: `GetSessionExtensionsResponse` (L144-146)

---

## Tools

### Get Tools
- **Method**: `_goose/tools`
- **Request**: `GetToolsRequest` (L44-48)
- **Response**: `GetToolsResponse` (L52-55)

---

## Resources

### Read Resource
- **Method**: `_goose/resource/read`
- **Request**: `ReadResourceRequest` (L59-65)
- **Response**: `ReadResourceResponse` (L69-73)

---

## Working Directory

### Update Working Dir
- **Method**: `_goose/working_dir/update`
- **Request**: `UpdateWorkingDirRequest` (L77-82)
- **Response**: `EmptyResponse`

---

## Session Management

### Delete Session
- **Method**: `session/delete`
- **Request**: `DeleteSessionRequest` (L86-90)
- **Response**: `EmptyResponse`

### Update Session Project
- **Method**: `_goose/session/update_project`
- **Request**: `UpdateSessionProjectRequest` (L216-221)
- **Response**: `EmptyResponse`

### Rename Session
- **Method**: `_goose/session/rename`
- **Request**: `RenameSessionRequest` (L225-229)
- **Response**: `EmptyResponse`

### Archive Session
- **Method**: `_goose/session/archive`
- **Request**: `ArchiveSessionRequest` (L233-237)
- **Response**: `EmptyResponse`

### Unarchive Session
- **Method**: `_goose/session/unarchive`
- **Request**: `UnarchiveSessionRequest` (L241-245)
- **Response**: `EmptyResponse`

### Export Session
- **Method**: `_goose/session/export`
- **Request**: `ExportSessionRequest` (L249-253)
- **Response**: `ExportSessionResponse` (L257-259)

### Import Session
- **Method**: `_goose/session/import`
- **Request**: `ImportSessionRequest` (L263-265)
- **Response**: `ImportSessionResponse` (L269-275)

---

## Config Management

### Read Config
- **Method**: `_goose/config/read`
- **Request**: `ReadConfigRequest` (L150-154)
- **Response**: `ReadConfigResponse` (L158-162)

### Upsert Config
- **Method**: `_goose/config/upsert`
- **Request**: `UpsertConfigRequest` (L166-171)
- **Response**: `EmptyResponse`

### Remove Config
- **Method**: `_goose/config/remove`
- **Request**: `RemoveConfigRequest` (L175-179)
- **Response**: `EmptyResponse`

---

## Secrets Management

### Check Secret
- **Method**: `_goose/secret/check`
- **Request**: `CheckSecretRequest` (L183-187)
- **Response**: `CheckSecretResponse` (L191-194)

### Upsert Secret
- **Method**: `_goose/secret/upsert`
- **Request**: `UpsertSecretRequest` (L198-203)
- **Response**: `EmptyResponse`

### Remove Secret
- **Method**: `_goose/secret/remove`
- **Request**: `RemoveSecretRequest` (L207-211)
- **Response**: `EmptyResponse`

---

## Sources Management

See [EDUCLAW-RECIPE-API-MAP.md](EDUCLAW-RECIPE-API-MAP.md) for full details.

### Create Source
- **Method**: `_goose/sources/create`
- **Request**: `CreateSourceRequest` (L650-662)
- **Response**: `CreateSourceResponse` (L664-667)

### List Sources
- **Method**: `_goose/sources/list`
- **Request**: `ListSourcesRequest` (L676-684)
- **Response**: `ListSourcesResponse` (L687-689)

### Update Source
- **Method**: `_goose/sources/update`
- **Request**: `UpdateSourceRequest` (L693-703)
- **Response**: `UpdateSourceResponse` (L706-709)

### Delete Source
- **Method**: `_goose/sources/delete`
- **Request**: `DeleteSourceRequest` (L713-718)
- **Response**: `EmptyResponse`

### Export Source
- **Method**: `_goose/sources/export`
- **Request**: `ExportSourceRequest` (L722-728)
- **Response**: `ExportSourceResponse` (L731-735)

### Import Sources
- **Method**: `_goose/sources/import`
- **Request**: `ImportSourcesRequest` (L741-749)
- **Response**: `ImportSourcesResponse` (L752-755)

---

## Dictation

### Transcribe Audio
- **Method**: `_goose/dictation/transcribe`
- **Request**: `DictationTranscribeRequest` (L758-766)
- **Response**: `DictationTranscribeResponse` (L770-772)

### Get Dictation Config
- **Method**: `_goose/dictation/config`
- **Request**: `DictationConfigRequest` (L777-778)
- **Response**: `DictationConfigResponse` (L812-814)

### List Dictation Models
- **Method**: `_goose/dictation/models/list`
- **Request**: `DictationModelsListRequest` (L950-955)
- **Response**: `DictationModelsListResponse` (L958-961)

### Download Dictation Model
- **Method**: `_goose/dictation/models/download`
- **Request**: `DictationModelsDownloadRequest` (L969-972)
- **Response**: `EmptyResponse`

### Cancel Dictation Model Download
- **Method**: `_goose/dictation/models/cancel`
- **Request**: `CancelDictationModelDownloadRequest` (L1006-1009)
- **Response**: `EmptyResponse`

### Delete Dictation Model
- **Method**: `_goose/dictation/models/delete`
- **Request**: `DeleteDictationModelRequest` (L1014-1017)
- **Response**: `EmptyResponse`

### Select Dictation Model
- **Method**: `_goose/dictation/model/select`
- **Request**: `DictationModelSelectRequest` (L1022-1027)
- **Response**: `EmptyResponse`

---

## Providers

### List Providers
- **Method**: `_goose/providers/list`
- **Request**: `ListProvidersRequest` (L818-824)
- **Response**: `ListProvidersResponse` (L828-830)

### Refresh Provider Inventory
- **Method**: `_goose/providers/inventory/refresh`
- **Request**: `RefreshProviderInventoryRequest` (L834-843)
- **Response**: `RefreshProviderInventoryResponse` (L847-854)

---

## Integration Notes

- **Transport**: Same stdin/stdout pipe as standard ACP
- **Usage**: `cx.send_request(CustomRequest).block_task().await`
- **Dependency**: Add `goose-sdk` to Cargo.toml
- **No HTTP**: All custom APIs use existing SACP connection

---

Last Updated: 2026-05-04
