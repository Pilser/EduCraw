# Image Tools Implementation Plan

## Overview

Add/modify tools in the `computercontroller` module:

1. **`read_image`** — Read an image file, check size, return info or optimized Pillow conversion command
2. **`extract_images` (enhanced)** — Extract embedded images from PDFs to filesystem, check size, return metadata + optional Pillow warning

---

## Tool 1: `read_image`

### Purpose
Read an image file, check dimensions + file size, and return metadata. If within limits, return base64 for LLM analysis. If oversized, return a warning with an optimized Pillow conversion command.

### Implementation Location
`goose-workspace/crates/goose-mcp/src/computercontroller/mod.rs`
`goose-workspace/crates/goose-mcp/src/computercontroller/image_utils.rs`

### Thresholds (Shared across all tools)

| Check | Limit |
|-------|-------|
| Max Resolution / Dimension | **1024 x 1024 pixels** (square) or **1500 pixels on longest edge** (non-square) |
| Max File Size | **Under 5 MB** (compressed JPEG or PNG) |

### Parameters
```rust
pub struct ReadImageParams {
    /// Path to the image file (absolute or relative path)
    pub path: String,

    /// Maximum dimension threshold in pixels (default: 1024 for square, 1500 for longest edge)
    pub max_dimension: Option<usize>,

    /// Maximum file size in MB (default: 5)
    pub max_file_size_mb: Option<u32>,
}
```

### Supported Formats
- PNG, JPEG/JPG, WebP, GIF, BMP, TIFF, ICO

### Logic Flow
```
1. Read file from path
2. Get file size via fs::metadata
3. Detect image format from file header (magic bytes)
4. Get image dimensions using `image` crate metadata (don't load full image)
5. Check:
   a. If file size > max_file_size_mb → oversized
   b. If width > 1024 && height > 1024 → oversized (both dims exceed square)
      OR longest edge > 1500 → oversized
6. If exceeds any limit:
   - Return text with metadata + Pillow conversion command
   - DO NOT return base64
7. If within limits:
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

## Tool 2: `extract_images` (Enhanced)

### Purpose
Extract embedded images from PDF files to filesystem (no base64). Return metadata + file path. If oversized, append optimized Pillow conversion command for LLM to decide.

### Implementation Location
- Modify existing `goose-workspace/crates/goose-mcp/src/computercontroller/pdf_tool.rs`
- No new standalone tool — stays under `pdf_tool` with `"extract_images"` operation

### Parameters (Unchanged)
```rust
pub struct PdfToolParams {
    pub path: String,
    pub operation: PdfOperation,  // ExtractText | ExtractImages
}
```

### Logic Flow
```
1. Open PDF with lopdf
2. Iterate through pages
3. For each page, find embedded images in Resources/XObject
4. Detect image format from stream dict:
   - DCTDecode → .jpg
   - JPXDecode → .jp2
   - CCITTFaxDecode → .tiff
   - FlateDecode with RGB/Gray → .png
   - Default → .raw
5. Save image to filesystem (as today)
6. Read saved file size via fs::metadata
7. Check thresholds (shared with read_image):
   a. If width > 1024 && height > 1024 → oversized
      OR longest edge > 1500 → oversized
   b. If file size > 5 MB → oversized
8. Build result text:
   - For each image: path, dimensions, bpc, file size
   - If oversized: append ⚠ warning + Pillow conversion command
9. Return text-only (no base64)
```

### Return Format
```
Found 3 images:
  ✔ Image 1: /cache/pdf_images/page1_img1_XObject1.jpg (800x600, 8 bpc, 1.2 MB)
  ✔ Image 2: /cache/pdf_images/page1_img2_XObject2.png (1024x768, 8 bpc, 0.8 MB)
  ⚠ Image 3: /cache/pdf_images/page1_img3_XObject3.jpg (4000x3000, 8 bpc, 3.2 MB)
     Exceeds max resolution (1024x1024 square / 1500px longest edge).
     To convert efficiently with minimal resource use:
     python3 << 'PYEOF'
     from PIL import Image
     image_path = "/cache/pdf_images/page1_img3_XObject3.jpg"
     output_path = "/cache/pdf_images/page1_img3_XObject3_conv.jpg"
     target_size = (800, 600)
     with Image.open(image_path) as img:
         img.draft("RGB", target_size)
         resized_img = img.resize(target_size, resample=Image.Resampling.BILINEAR)
         resized_img.save(output_path, "JPEG", quality=75)
     print("Resized to", output_path)
     PYEOF

If no images:
  No images found in PDF
```

### Optimized Pillow Command Details

The embedded command uses resource-conscious practices:
- `Image.open()` — lazy, doesn't decode whole file
- `img.draft("RGB", target_size)` — decodes only what's needed for target (JPEG only)
- `BILINEAR` resampling — faster than LANCZOS, sufficient for LLM preview
- `quality=75` — balance size/quality for LLM consumption

---

## New File: `image_utils.rs`

### Location
`goose-workspace/crates/goose-mcp/src/computercontroller/image_utils.rs`

### Functions

```rust
/// Get image dimensions from file header without loading full image
pub fn get_dimensions(path: &str) -> Result<(u32, u32), String>

/// Check if dimensions exceed limits (1024x1024 square / 1500 longest edge)
pub fn needs_resize(width: u32, height: u32) -> bool

/// Check if file size exceeds 5 MB limit
pub fn exceeds_file_size(path: &str) -> Result<bool, String>

/// Check both limits and return the combined result
pub fn check_image_limits(path: &str, width: u32, height: u32) -> Result<LimitsCheck, String>

/// Generate Pillow conversion command snippet
pub fn pillow_conversion_command(path: &str, output_path: &str, width: u32, height: u32) -> String

/// Generate full warning message with Pillow command
pub fn size_warning(path: &str, width: u32, height: u32, file_size_mb: f64) -> String
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `computercontroller/mod.rs` | Add ReadImageParams + read_image tool; pass cache_dir to pdf_tool |
| `computercontroller/pdf_tool.rs` | Add dimension/file size checks + Pillow warning to extract_images |
| `computercontroller/image_utils.rs` | **NEW** — shared image utilities for both tools |
| `Cargo.toml` | No new dependencies needed |

---

## Dependencies (Already Available)

- `base64` — for read_image base64 return (Cargo.toml:26)
- `image` — format detection and metadata (Cargo.toml:39, features: ["jpeg"])
- `lopdf` — PDF parsing (Cargo.toml:37)

---

## Testing Considerations

1. `read_image` with small image (< 1024px, < 5MB) — returns base64
2. `read_image` with large dimensions (> 1500px longest edge) — returns Pillow warning
3. `read_image` with large file size (> 5MB) — returns Pillow warning
4. `read_image` with unsupported format — INVALID_PARAMS error
5. `extract_images` PDF with mixed image sizes — some pass, some warn
6. `extract_images` PDF with no images — "No images found"
7. `extract_images` existing extract_text operation — unchanged
8. `extract_images` PDF with corrupt image streams — skip with note

---

## Backward Compatibility

- `pdf_tool extract_text` — completely unchanged
- `pdf_tool extract_images` — unchanged for images within limits; only adds warnings for oversized ones
- All existing callers work identically for images within thresholds
