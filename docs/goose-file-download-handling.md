# Goose File Handling — Download, Size Limits, and Line Truncation

## Overview

Goose handles files through the ACP `ReadTextFileRequest` / `WriteTextFileRequest` protocol. It supports line-based reading with truncation but does **not** provide metadata (line count, file size) to the LLM automatically.

---

## 1. File Download / Reading via ACP

Goose uses the ACP file system protocol to read/write files. The ACP `ReadTextFileRequest` (`agent-client-protocol-schema-0.11.3/src/client.rs:848-866`) sends file read requests:

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | SessionId | ACP session |
| `path` | PathBuf | Absolute file path |
| `line` | Option\<u32\> | Start line (1-based), optional |
| `limit` | Option\<u32\> | Max lines to read, optional |

**Response** (`ReadTextFileResponse`, line 911): Only `content: String` — **no metadata** (no line count, no file size, no total lines).

Goose passes this to the LLM as raw text via the `read` tool. The LLM does not automatically know the file's total size or line count unless Goose tells it.

---

## 2. Large File Handling — Line Truncation

### 2.1 Goose Tool-Level Truncation (`apply_line_limit`)

When the LLM calls the `read` tool with `line` and `limit` params, Goose uses `apply_line_limit` (`edit.rs:199-213`) to slice the content:

```rust
fn apply_line_limit(content: &str, line: Option<u32>, limit: Option<u32>) -> String {
    if line.is_none() && limit.is_none() {
        return content.to_string();  // No limit — full file
    }
    let lines: Vec<&str> = content.split_inclusive('\n').collect();
    let start = line.map(|l| (l as usize).saturating_sub(1)).unwrap_or(0).min(lines.len());
    let end = limit.map(|l| start + l as usize).unwrap_or(lines.len()).min(lines.len());
    lines[start..end].concat()
}
```

- **No params**: Returns full file content
- **`line` only**: Returns from that line to end
- **`limit` only**: Returns first N lines
- **`line` + `limit`**: Returns slice from start line, N lines

### 2.2 Shell Output Truncation

The shell tool has hard-coded limits (`shell.rs:699-724`):

```rust
const OUTPUT_LIMIT_LINES: usize = 5000;
const OUTPUT_LIMIT_BYTES: usize = 50_000;
const OUTPUT_PREVIEW_LINES: usize = 100;

fn truncate_output(full_output: &str, ...) -> Result<TruncateResult, String> {
    let lines = full_output.split('\n').collect();
    let total_lines = lines.len();
    let total_bytes = full_output.len();

    if !exceeded_lines && !exceeded_bytes {
        return Ok(TruncateResult { text: full_output.to_string(), truncation: None });
    }

    // Save full output to disk, return last OUTPUT_PREVIEW_LINES (100 lines) only
    let output_path = save_full_output(full_output, label, output_dir)?;
    let preview_start = total_lines.saturating_sub(OUTPUT_PREVIEW_LINES);
    let preview = lines[preview_start..].join("\n");

    let reason = if exceeded_lines {
        format!("Output exceeded {OUTPUT_LIMIT_LINES} line limit ({total_lines} lines total).")
    } else {
        format!("Output exceeded {OUTPUT_LIMIT_BYTES} byte limit ({total_bytes} bytes total).")
    };

    Ok(TruncateResult { text: preview, truncation: Some(TruncationInfo { path: output_path, reason }) })
}
```

**Shell tool limits**:
- **Lines**: 5000 max → truncated to last 100 lines + full file saved to disk
- **Bytes**: 50,000 max → same behavior

### 2.3 No Automatic Truncation for `read` Tool

The `read` tool **does not** have automatic truncation. If the LLM calls `read` with no `line`/`limit`, Goose returns the **full file** regardless of size. It is the LLM's responsibility to use `line`/`limit` to read in chunks.

---

## 3. LLM Visibility — File Size / Line Count

### 3.1 What the LLM Sees

The ACP `ReadTextFileResponse` only contains `content: String`. **No metadata** (line count, file size, total lines) is included. The LLM receives only the raw text content.

### 3.2 What Goose Tells the LLM

Goose exposes the `read` tool schema with `line` and `limit` parameters:

```rust
pub struct FileReadParams {
    pub path: String,
    #[schemars(range(min = 1))]
    pub line: Option<u32>,  // Line number to start (1-based)
    pub limit: Option<u32>, // Max lines to read
}
```

The tool description: "Read a text file from disk."

**The LLM must know to use `line`/`limit` for large files** — Goose does not proactively warn the LLM about file size. The LLM's training or instruction-following prompts guide it to use these params.

### 3.3 Can Goose Tell the LLM About File Size?

**Not currently implemented.** There is no mechanism in Goose to:
1. Check file size before reading
2. Include line count or file size in the tool result
3. Send a "file is too large" warning before returning content

The `read` tool returns raw text with no metadata. The only place line count is mentioned is in the shell output truncation message:
```
Output exceeded 5000 line limit (12345 lines total).
```

### 3.4 How the LLM Knows to Use Line/Limit

The LLM's ability to use `line`/`limit` for large files comes from:
1. **Tool schema** — The tool has `line` and `limit` params, so a capable LLM knows they exist
2. **System prompts** — Goose's instructions to the agent may include guidance on reading large files
3. **On-demand reading** — The LLM can call `read` with `line=1, limit=500` to read in chunks, then use subsequent calls for more content

---

## 4. Summary: Large File Handling Behavior

| Scenario | Behavior |
|----------|----------|
| LLM calls `read` with no params on 10,000-line file | Full 10,000 lines sent to LLM (no auto-truncation) |
| LLM calls `read` with `line=1, limit=500` | Returns lines 1-500 only |
| LLM calls `read` with `line=1000, limit=500` | Returns lines 1000-1499 |
| LLM calls shell command with 10,000-line output | Last 100 lines returned + full output saved to disk |
| File size before reading | **Not checked** — no proactive warning |
| Line count metadata | **Not sent** — `ReadTextFileResponse` has only `content` |
| LLM receives file size info | **No** — only raw text content |

---

## 5. Tool Read Parameter Schema (Full)

From `edit.rs:10-19`:

```rust
#[derive(Debug, Deserialize, JsonSchema)]
pub struct FileReadParams {
    /// Absolute path to the file to read.
    pub path: String,
    /// Line number to start reading from (1-based).
    #[schemars(range(min = 1))]
    pub line: Option<u32>,
    /// Maximum number of lines to read.
    pub limit: Option<u32>,
}
```

The `line` parameter is 1-based (line 1 = first line). `limit` is optional and caps the number of lines returned.

---

## 7. File Outline / Skeleton with Line References (NOT Implemented)

You asked about a mechanism that generates a **file outline with line number references** so the agent can discover which lines it needs, like:

```markdown
# File outline for /path/file.md

# Overview [L3-9]
## Provider-Level [L9-176]
  ### 1. Anthropic [L11-51]
   usage [L18-23]
    input_tokens [L19]
    cache_creation [L20]
```

**Goose does NOT have this feature.** Here is what exists vs. what does not:

### What exists:
1. **ResourceLink → full content**: `read_resource_link()` at `server.rs:500-514` reads the **entire file** and formats it as:
   ```
   # /path/to/file.txt
   ```
   [full file content]
   ```
   ```
   No outline, no line refs — full raw content.

2. **`read` tool with line/limit**: The LLM can call `read` with `line=1, limit=500` to get a slice. But Goose does **not** proactively generate an outline — the LLM must know to use these params.

3. **Analyze tool** (tree-sitter): Returns symbol names (functions, classes) but **no line numbers**:
   ```
   - my_function() → 2 calls, defined at line 42
   - MyStruct → fields, methods
   ```

4. **Summarize tool**: Sends full file content to LLM (100KB/file max) for LLM-generated summary. No structural line references.

### What does NOT exist:
- No automatic file outline generation with `[L1-646]` style line references
- No "skeleton" or "table of contents" for large files
- No proactive warning to LLM about file size or structure
- No line count metadata sent to LLM before reading

### Shell tool truncation (closest to partial view):
The only truncation that exists is shell output (`shell.rs:699-732`):
- 5000 line limit → saves full to disk, returns **last 100 lines** + message
- Message format: `"Output exceeded 5000 line limit (12345 lines total)."`
- This is NOT an outline — just the tail of the output

### Conclusion:
If you need the `[L1-646]` style file outline for EduCraw, this would need to be **added as a new feature** in Goose (either as a new ACP method or as part of the ResourceLink processing). Goose currently has no such mechanism.

---

## 8. Key Locations

- **ACP ReadTextFileRequest/Response**: `agent-client-protocol-schema-0.11.3/src/client.rs:848-938`
- **Goose line limit function**: `goose-workspace/crates/goose/src/agents/platform_extensions/developer/edit.rs:199-213`
- **FileReadParams schema**: `goose-workspace/crates/goose/src/agents/platform_extensions/developer/edit.rs:10-19`
- **Shell output truncation**: `goose-workspace/crates/goose/src/agents/platform_extensions/developer/shell.rs:699-732`
- **Shell limits constants**: `shell.rs` (OUTPUT_LIMIT_LINES=5000, OUTPUT_LIMIT_BYTES=50000, OUTPUT_PREVIEW_LINES=100)
- **ACP fs read via network**: `goose-workspace/crates/goose/src/acp/fs.rs:26-46`
- **ResourceLink full-file read**: `goose-workspace/crates/goose/src/acp/server.rs:500-514`
- **Summarize tool**: `goose-workspace/crates/goose/src/agents/platform_extensions/summarize.rs:166-219`
- **Analyze tool (no line refs)**: `goose-workspace/crates/goose/src/agents/platform_extensions/analyze/mod.rs:100-122` (uses ACP request if client FS enabled, otherwise direct fs::read_to_string)