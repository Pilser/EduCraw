# ACP File Attachments — ResourceLink (file://) Flow

## Overview

ACP's `ContentBlock::ResourceLink` is the primary mechanism for sending file contents to Goose via ACP. This document covers how `ResourceLink` with `file://` URLs flows from ACP → Goose → LLM API.

---

## 1. ACP ContentBlock Types

ACP defines these content block types (from `agent-client-protocol-schema-0.11.3/src/content.rs:35-59`):

| ContentBlock | Description |
|-------------|-------------|
| `Text` | Plain text / Markdown |
| `Image` | Base64-encoded data (any MIME type) |
| `Audio` | Base64-encoded audio |
| `ResourceLink` | URI reference the agent resolves |
| `Resource` | Embedded resource (text or blob) |

**EduCraw uses**: `Image` for binary uploads, `ResourceLink` for file references.

---

## 2. ResourceLink Flow: ACP → Goose → LLM

### Step 2.1: ACP Receives ResourceLink

When the frontend sends a `ContentBlock::ResourceLink` via ACP `session/prompt`, Goose processes it at `goose-workspace/crates/goose/src/acp/server.rs:1327-1330`:

```rust
ContentBlock::ResourceLink(link) => {
    if let Some(text) = read_resource_link(link.clone()) {
        message = message.with_text(&text);
    }
}
```

The `read_resource_link` function (`acp/server.rs:500-514`) only handles `file://` scheme:

```rust
fn read_resource_link(link: ResourceLink) -> Option<String> {
    let url = Url::parse(&link.uri).ok()?;
    if url.scheme() == "file" {
        let path = url.to_file_path().ok()?;
        let contents = fs::read_to_string(&path).ok()?;

        Some(format!(
            "\n\n# {}\n```\n{}\n```",
            path.to_string_lossy(),
            contents
        ))
    } else {
        None  // Non-file URIs are silently dropped
    }
}
```

**What this produces**: Formatted text with the file path as a header and the raw file contents in a code block.

**Example output**:
```
\n\n# /home/user/docs/report.txt\n```\nThis is the file content.\n```
```

**Key limitation**: Only `file://` scheme is supported. HTTP/HTTPS URIs are ignored.

### Step 2.2: Goose Stores ResourceLink as Text Content

The file contents (from the ResourceLink) are stored in Goose's internal `MessageContent::Text`. The original ResourceLink information is lost at this point — it becomes plain text.

### Step 2.3: Goose Converts Message to LLM Provider Format

When sending to the LLM API, Goose converts its internal `MessageContent` to ACP `ContentBlock` via `messages_to_prompt` (`acp/provider.rs:1134-1159`):

```rust
fn messages_to_prompt(messages: &[Message]) -> Vec<ContentBlock> {
    // ... finds the last user message with is_agent_visible ...
    if let Some(message) = last_user {
        for content in &message.content {
            match content {
                MessageContent::Text(text) => {
                    content_blocks.push(ContentBlock::Text(TextContent::new(text.text.clone())));
                }
                MessageContent::Image(image) => {
                    content_blocks.push(ContentBlock::Image(ImageContent::new(
                        &image.data,
                        &image.mime_type,
                    )));
                }
                // Note: MessageContent::Resource / ResourceLink is not handled here
                // The file content was already converted to Text in step 2.1
                _ => {}
            }
        }
    }
    content_blocks
}
```

**Result**: The file contents (which were read from the ResourceLink in step 2.1 and stored as text) are now sent to the LLM as `ContentBlock::Text` — the original ResourceLink URI is gone, only the file contents remain.

### Step 2.4: LLM Provider Formats the Text Content

Each LLM provider converts `ContentBlock::Text` to its own format:

| Provider | Format |
|----------|--------|
| OpenAI (via OpenAI Responses API) | `{"type": "input_text", "text": "..."}` |
| Anthropic | `{"type": "text", "text": "..."}` |
| Bedrock | Tool result text |
| Others | Provider-specific text format |

---

## 3. Full ResourceLink Path Summary

```
Frontend sends ACP session/prompt with ContentBlock::ResourceLink(uri: "file:///path/to/file.txt")
    ↓
Goose ACP server receives it (server.rs:1327)
    ↓
read_resource_link() reads file from disk, formats as:
    "\n\n# /path/to/file.txt\n```\n[file contents]\n```\n"
    ↓
Stored in Goose Message as MessageContent::Text
    ↓
messages_to_prompt() converts MessageContent::Text → ContentBlock::Text
    ↓
LLM provider converts ContentBlock::Text → provider-specific text format
    ↓
Sent to LLM API as plain text
```

**What the LLM sees**: The file path and raw contents as formatted Markdown text.

---

## 4. ResourceLink Behavior Summary

| Aspect | Behavior |
|--------|----------|
| Supported URI schemes | `file://` only (HTTP/HTTPS/others are silently ignored) |
| File type | Any readable text file (binary files are read as raw bytes, may be garbled) |
| Binary files | Not recommended — `read_to_string` assumes UTF-8; binary content may corrupt |
| What LLM receives | Formatted text: `# /path\n```\n[contents]\n```\n` |
| ResourceLink URI preserved | No — only raw file contents are sent as text |
| MCP ResourceLink support | Not covered here — this document covers ACP only |

---

## 5. Comparison: Image vs ResourceLink

| Aspect | Image (`ContentBlock::Image`) | ResourceLink (`file://`) |
|--------|-------------------------------|--------------------------|
| Data format | Base64-encoded binary | Raw text file |
| MIME type | Required (e.g. `image/png`) | None (treated as text) |
| Binary file support | ✅ Yes | ❌ No (UTF-8 assumed) |
| LLM receives | Multipart image data with MIME | Formatted text block |
| EduCraw implementation | `images.rs` → `ImageContent` | ACP prompt with ResourceLink |
| File size limits | Provider-dependent (usually 20MB max) | System file read limits |

---

## 6. Tool Response Handling

When tools return `RawContent::ResourceLink` (e.g., from a tool result), Goose does **NOT** forward it to the LLM. This is explicitly dropped at `acp/server.rs:1708`:

```rust
// In tool call result conversion:
RawContent::Audio(_) | RawContent::ResourceLink(_) => None,  // Dropped
```

Only `Text` and `Image` tool results are forwarded.

---

## 7. References

- **ACP ContentBlock spec**: `agent-client-protocol-schema-0.11.3/src/content.rs:35-59`
- **Goose ResourceLink handling**: `goose-workspace/crates/goose/src/acp/server.rs:500-514` (read_resource_link)
- **Goose message to ACP conversion**: `goose-workspace/crates/goose/src/acp/server.rs:1315-1332` (content block processing)
- **Goose to provider conversion**: `goose-workspace/crates/goose/src/acp/provider.rs:1134-1159` (messages_to_prompt)
- **Tool result ResourceLink drop**: `goose-workspace/crates/goose/src/acp/server.rs:1708`
- **OpenAI Responses format**: `goose-workspace/crates/goose/src/providers/formats/openai_responses.rs:394`
- **Bedrock format**: `goose-workspace/crates/goose/src/providers/formats/bedrock.rs:144`