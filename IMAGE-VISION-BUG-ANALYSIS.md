# Image Vision Bug: CLI vs ACP

## The Bug (CLI Only)

**File**: `goose-workspace/crates/goose/src/providers/utils.rs:286-305`

```rust
pub fn detect_image_path(text: &str) -> Option<&str> {
    for word in text.split_whitespace() {
        if extensions.iter().any(|ext| word.to_lowercase().ends_with(ext)) {
            let path = Path::new(word);
            if path.is_absolute() && path.is_file() {  // ← BUG: is_absolute() required!
                if is_image_file(path) {
                    return Some(word);
                }
            }
        }
    }
    None
}
```

**Problem**: Only detects **ABSOLUTE paths**
- ❌ `./chart.png` → **REJECTED**
- ❌ `image.png` → **REJECTED**  
- ✅ `/home/user/image.png` → **ACCEPTED**

**Impact**: When user types relative path in CLI, goose tries to detect it but fails → image not converted to base64 → LLM never sees it

---

## ACP is NOT Affected ✅

**File**: `goose-workspace/crates/goose/src/acp/provider.rs:1134-1156`

```rust
fn messages_to_prompt(messages: &[Message]) -> Vec<ContentBlock> {
    for content in &message.content {
        match content {
            MessageContent::Image(image) => {
                content_blocks.push(ContentBlock::Image(ImageContent::new(
                    &image.data,           // ← Already base64!
                    &image.mime_type,
                )));
            }
```

**Why ACP works:**
- ACP clients send explicit `ImageContent` with base64-encoded data
- **No path detection logic needed**
- Images bypass `detect_image_path()` entirely
- When used via Educlaw: ✅ Images WILL work

---

## Summary

| Path | Status | Reason |
|------|--------|--------|
| **CLI (relative path)** | ❌ Broken | `detect_image_path()` requires absolute paths |
| **CLI (absolute path)** | ✅ Works | `detect_image_path()` accepts `/full/path` |
| **ACP via Educlaw** | ✅ Works | Sends base64 directly, no path detection |

**Workaround for CLI**: Use full absolute path when tagging images
