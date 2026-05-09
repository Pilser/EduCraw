# Image Tools Implementation Plan

## Overview

Add two new standalone MCP tools to the `computercontroller` module:

1. **`read_image`** - Read an image file and return it as base64 for LLM analysis
2. **`extract_images`** - Extract embedded images from PDF files and return them as base64

---

## Tool 1: `read_image`

### Purpose
Read an image file from disk, check if it's suitable for LLM analysis, and return it as base64 content.

### Implementation Location
`goose-workspace/crates/goose-mcp/src/computercontroller/mod.rs`

### Parameters
```rust
pub struct ReadImageParams {
    /// Path to the image file (absolute or relative path)
    pub path: String,

    /// Maximum dimension threshold in pixels (default: 2048)
    /// If image exceeds this, inform LLM that it needs resizing
    pub max_dimension: Option<usize>,

    /// Quality for JPEG compression (0-100, default: 85)
    /// Only applied if image needs to be compressed
    pub jpeg_quality: Option<u8>,
}
```

### Supported Formats
- PNG
- JPEG/JPG
- WebP
- GIF
- BMP
- TIFF
- ICO
- (PDF extracted images via their raw format)

### Logic Flow
```
1. Read file from path
2. Detect image format from file header (magic bytes)
3. Get image dimensions using `image` crate metadata (don't load full image)
4. Check if dimensions exceed max_dimension (default 2048px)
5. If exceeds:
   - Return text: "Image is too large ({width}x{height}). Please convert it to a smaller size (max {max_dimension}px) using python or image tools."
   - DO NOT return base64
6. If within limits:
   - Read full file
   - Encode to base64
   - Return Content::image(base64_data, mime_type)
```

### Mime Type Mapping
| Extension | MIME Type |
|-----------|-----------|
| .png | image/png |
| .jpg/.jpeg | image/jpeg |
| .gif | image/gif |
| .webp | image/webp |
| .bmp | image/bmp |
| .tiff/.tif | image/tiff |
| .ico | image/x-icon |

### Error Handling
- File not found: `INVALID_PARAMS`
- Unsupported format: `INVALID_PARAMS` with message listing supported formats
- Read error: `INTERNAL_ERROR`

---

## Tool 2: `extract_images`

### Purpose
Extract embedded images from PDF files and return them directly as base64 (not just file paths).

### Implementation Location
- New function in `goose-workspace/crates/goose-mcp/src/computercontroller/mod.rs`
- Refactor existing `pdf_tool.rs` extract_images logic

### Parameters
```rust
pub struct ExtractImagesParams {
    /// Path to the PDF file
    pub path: String,

    /// Maximum images to extract (default: 50)
    pub max_images: Option<usize>,

    /// Page range to extract from (default: all pages)
    /// Format: "1-5" or "1,3,5" or "all"
    pub pages: Option<String>,
}
```

### Logic Flow
```
1. Open PDF with lopdf
2. Iterate through pages
3. For each page, find embedded images in Resources/XObject
4. Extract image data and determine format from stream dict:
   - DCTDecode → JPEG
   - JPXDecode → JPEG2000
   - CCITTFaxDecode → TIFF
   - FlateDecode with RGB/Gray → PNG
   - Default → binary
5. For each extracted image:
   a. Get dimensions (width, height, bpc)
   b. Check if exceeds max_dimension
   c. If exceeds: include text warning in results
   d. If within limits: encode to base64
6. Return results
```

### Return Format
```rust
// Success: returns list of images and any warnings
vec![
    Content::image(base64_data, "image/jpeg"),
    Content::text("Image 3 (2048x2048) is too large to send. Convert it first."),
    Content::image(base64_data, "image/png"),
]

// No images found
Content::text("No images found in PDF")
```

### Image Format Detection from PDF Stream
```rust
fn detect_image_format(dict: &lopdf::Dictionary) -> (&'static str, &'static str) {
    // Returns (extension, mime_type)
    match dict.get(b"Filter") {
        Object::Name(b"DCTDecode") => ("jpg", "image/jpeg"),
        Object::Name(b"JPXDecode") => ("jp2", "image/jp2"),
        Object::Name(b"CCITTFaxDecode") => ("tiff", "image/tiff"),
        Object::Name(b"FlateDecode") => {
            // Check ColorSpace for PNG indicator
            if is_rgb_or_gray(dict) { ("png", "image/png") }
            else { ("raw", "application/octet-stream") }
        }
        _ => ("raw", "application/octet-stream")
    }
}
```

---

## New File: `image_utils.rs`

### Location
`goose-workspace/crates/goose-mcp/src/computercontroller/image_utils.rs`

### Functions to Implement

```rust
/// Detect image format from file extension or magic bytes
pub fn detect_format(path: &str, data: &[u8]) -> Option<&'static str>

/// Get image dimensions without loading full data
pub fn get_dimensions(path: &str) -> Result<(u32, u32), ImageError>

/// Check if image needs resizing
pub fn needs_resize(width: u32, height: u32, max: usize) -> bool

/// Encode image to base64 with appropriate mime type
pub fn encode_image(data: &[u8], format: &str) -> (String, &'static str)

/// Generate warning message for oversized image
pub fn size_warning(path: &str, width: u32, height: u32, max: usize) -> String
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `computercontroller/mod.rs` | Add params structs, tool implementations, call pdf_tool extract_images |
| `computercontroller/pdf_tool.rs` | Refactor extract_images to be callable from mod.rs |
| `computercontroller/image_utils.rs` | **NEW FILE** - shared image utilities |
| `computercontroller/mod.rs` | Add params for both tools |

---

## Dependencies (Already Available)

- `base64` - encoding (Cargo.toml:26)
- `image` - format detection and metadata (Cargo.toml:39, features: ["jpeg"])
- `lopdf` - PDF parsing (Cargo.toml:37)

---

## Testing Considerations

1. Test with small images (< 2048px) - should return base64
2. Test with large images (> 2048px) - should return warning
3. Test with various formats (png, jpg, webp, gif)
4. Test with corrupt/invalid image files
5. Test PDF with mixed image formats
6. Test PDF with very large embedded images
7. Test PDF with no images - should return appropriate message

---

## Backward Compatibility

- `pdf_tool` should still work as before for `extract_text` operation
- `extract_images` in pdf_tool should be updated to call the new standalone implementation
- Existing code calling `pdf_tool` with `extract_images` should continue to work

---

## Example LLM Interaction

### read_image with small image:
```
Tool: read_image
Args: {"path": "/cache/pdf_images/page1_img1.jpg"}

Response:
- Content::image(base64_data, "image/jpeg")
```

### read_image with oversized image:
```
Tool: read_image
Args: {"path": "/cache/huge_diagram.png"}

Response:
- Content::text("Image (4000x3000) is too large to send to LLM. Max dimension is 2048px. Convert it to a smaller size first using python or image tools.")
```

### extract_images from PDF:
```
Tool: extract_images
Args: {"path": "/documents/report.pdf", "pages": "1-3"}

Response:
- Content::text("Found 5 images:")
- Content::image(base64_jpg, "image/jpeg")
- Content::image(base64_png, "image/png")
- Content::text("Image 4 (3500x2500) exceeds size limit. Skip.")
```