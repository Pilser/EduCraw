# Recipe APIs via SDK

Recipes in Goose are accessed via the Sources API system (`_goose/sources/*`).

## Recipe Source Type

Recipes are identified with `"type": "recipe"` in requests. Available types:
- `skill` - Custom skills
- `builtin_skill` - Built-in skills
- `recipe` - Recipe files
- `subrecipe` - Sub-recipe files
- `agent` - Agent definitions

---

## Available APIs

### Create Recipe
- **Method**: `_goose/sources/create`
- **SDK**: `CreateSourceRequest` / `CreateSourceResponse`
- **Request**: 
  - `type`: "recipe"
  - `name`: string
  - `description`: string
  - `content`: string (recipe YAML/JSON content)
  - `global`: bool (true = user-wide, false = project-scoped)
  - `project_dir`: string (optional, required if global=false)
- **Response**: `{ "source": SourceEntry }`

### List Recipes
- **Method**: `_goose/sources/list`
- **SDK**: `ListSourcesRequest` / `ListSourcesResponse`
- **Request**:
  - `type`: "recipe" (optional, defaults to "skill")
  - `project_dir`: string (optional, includes project + global)
- **Response**: `{ "sources": [SourceEntry, ...] }`

### Update Recipe
- **Method**: `_goose/sources/update`
- **SDK**: `UpdateSourceRequest` / `UpdateSourceResponse`
- **Request**:
  - `type`: "recipe"
  - `path`: string (absolute path to recipe file)
  - `name`: string
  - `description`: string
  - `content`: string (updated YAML/JSON content)
- **Response**: `{ "source": SourceEntry }`

### Delete Recipe
- **Method**: `_goose/sources/delete`
- **SDK**: `DeleteSourceRequest` / `EmptyResponse`
- **Request**:
  - `type`: "recipe"
  - `path`: string (absolute path to recipe file)
- **Response**: `{}`

### Export Recipe
- **Method**: `_goose/sources/export`
- **SDK**: `ExportSourceRequest` / `ExportSourceResponse`
- **Request**:
  - `type`: "recipe"
  - `path`: string (absolute path to recipe file)
- **Response**: `{ "json": string, "filename": string }`

### Import Recipe
- **Method**: `_goose/sources/import`
- **SDK**: `ImportSourcesRequest` / `ImportSourcesResponse`
- **Request**:
  - `data`: string (JSON export from export API)
  - `global`: bool
  - `project_dir`: string (optional, required if global=false)
- **Response**: `{ "sources": [SourceEntry, ...] }`

---

## SourceEntry Structure

```json
{
  "type": "recipe",
  "name": "Recipe Name",
  "description": "Recipe description",
  "content": "version: 1.0.0\ntitle: ...",
  "directory": "/absolute/path/to/recipe.yaml",
  "global": true,
  "supporting_files": []
}
```

---

## SDK Location

- **File**: [goose-sdk/src/custom_requests.rs](goose-workspace/crates/goose-sdk/src/custom_requests.rs)
- **SourceType enum**: L596-610
- **SourceEntry struct**: L614-645
- **CreateSourceRequest**: L650-662
- **ListSourcesRequest**: L675-684
- **UpdateSourceRequest**: L693-703
- **DeleteSourceRequest**: L713-718
- **ExportSourceRequest**: L721-728
- **ImportSourcesRequest**: L736-744

---

## Notes

- Recipe content must be valid YAML or JSON matching Recipe schema
- Recipe files are stored in filesystem (global or project-scoped)
- These are custom _goose/* APIs (not standard ACP)
- No HTTP transport for recipes - these are SDK/internal APIs only

---

Last Updated: 2026-05-04
