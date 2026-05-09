# Feature Request: File Outline with Line References for Large File Handling

## Problem

When a large file is attached via ACP `ContentBlock::ResourceLink` (e.g., a 600+ line markdown document), Goose currently reads and sends the **full file content** to the LLM as raw text:

```markdown
# /path/to/file.md
[full 600+ lines of content]
```

This has two problems:
1. **Token waste**: The entire file is sent every time, even when the agent only needs a specific section.
2. **No structure discovery**: The agent has no way to know the file's structure (headings, sections, line ranges) without reading the whole file first.

## Proposed Solution

When Goose processes a `ContentBlock::ResourceLink` for a file above a configurable threshold (e.g., >100 lines), instead of sending full content, send a **file outline** with line references:

```markdown
# File: docs/GOOSE-ACP-TOKEN-TRUTH.md [L1-646]

# Overview [L3-9]
## Provider-Level Token Handling [L9-176]
  ### 1. Anthropic Provider [L11-51]
   usage [L18-23]
    input_tokens [L19]
    cache_creation_input_tokens [L20]
## Session Update [L470-514]
## ACP Response [L790-794]
```

The agent can then use the `read` tool with `line`/`limit` params to access specific sections as needed.

## Implementation Approach

### Option A: Parse headings from file content (lightweight, no external deps)
- Read first N lines of file to detect structure (markdown headings, code section comments)
- Generate outline with approximate line ranges
- Send outline + first ~50 lines as preview
- Full content available via `read` tool

### Option B: Use tree-sitter for code files
- Leverage existing `AnalyzeClient` (tree-sitter) to extract symbol names + line numbers
- Format as structured outline for code files
- Fall back to Option A for non-code files

### Threshold
- Configurable via goose config (e.g., `file_outline_threshold: 100` lines)
- Can be disabled entirely

## Expected Behavior

| Scenario | Current | Expected |
|----------|---------|----------|
| 600-line file attached | Full content sent to LLM | Outline sent, full content via read tool |
| Agent needs line 200-300 | Must read full file first | Use read tool directly with line/limit |
| Binary/non-text file | UTF-8 garbled | Skip outline, fallback to existing behavior |

## Files Likely Affected

- `goose-workspace/crates/goose/src/acp/server.rs:500-514` — `read_resource_link()` function
- New utility function for outline generation
- Config schema for threshold setting

## Priority

Medium — reduces token usage for large file scenarios but is not blocking for core functionality.