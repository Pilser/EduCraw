use std::fs;

pub const DEFAULT_MAX_SQUARE: u32 = 1024;
pub const DEFAULT_MAX_LONGEST_EDGE: u32 = 1500;
pub const DEFAULT_MAX_FILE_SIZE_MB: u64 = 5;

fn derive_max_longest(max_square: u32) -> u32 {
    (max_square as f64 * DEFAULT_MAX_LONGEST_EDGE as f64 / DEFAULT_MAX_SQUARE as f64).round() as u32
}

pub fn needs_resize(width: u32, height: u32) -> bool {
    needs_resize_with_limit(width, height, DEFAULT_MAX_SQUARE)
}

pub fn needs_resize_with_limit(width: u32, height: u32, max_square: u32) -> bool {
    let max_longest = derive_max_longest(max_square);
    (width > max_square && height > max_square) || width.max(height) > max_longest
}

pub fn get_file_size_mb(path: &str) -> Result<f64, String> {
    let metadata = fs::metadata(path).map_err(|e| format!("Failed to get file metadata: {}", e))?;
    Ok(metadata.len() as f64 / (1024.0 * 1024.0))
}

pub fn get_dimensions(path: &str) -> Result<(u32, u32), String> {
    image::image_dimensions(path).map_err(|e| format!("Failed to read image dimensions: {}", e))
}

pub fn pillow_conversion_command(path: &str, output_path: &str) -> String {
    format!(
        "python3 << 'PYEOF'\n\
         from PIL import Image\n\n\
         image_path = \"{}\"\n\
         output_path = \"{}\"\n\
         target_size = (800, 600)\n\n\
         with Image.open(image_path) as img:\n\
             img.draft(\"RGB\", target_size)\n\
             resized_img = img.resize(target_size, resample=Image.Resampling.BILINEAR)\n\
             resized_img.save(output_path, \"JPEG\", quality=75)\n\n\
         print(\"Resized to\", output_path)\n\
         PYEOF",
        path, output_path
    )
}

pub fn size_warning(path: &str, width: u32, height: u32, file_size_mb: f64) -> String {
    size_warning_with_limit(path, width, height, file_size_mb, DEFAULT_MAX_SQUARE, DEFAULT_MAX_FILE_SIZE_MB)
}

pub fn size_warning_with_limit(path: &str, width: u32, height: u32, file_size_mb: f64, max_square: u32, max_file_size_mb: u64) -> String {
    let max_longest = derive_max_longest(max_square);
    let output_path = if let Some(pos) = path.rfind('.') {
        format!("{}_conv{}", &path[..pos], &path[pos..])
    } else {
        format!("{}_conv", path)
    };
    format!(
        "\n⚠ Image \"{}\" ({}x{}, {:.1} MB) exceeds limits.\n\
         Max resolution: {}x{} (square) / {}px longest edge (non-square).\n\
         Max file size: {} MB.\n\n\
         To convert efficiently with minimal resource use:\n{}",
        path, width, height, file_size_mb,
        max_square, max_square, max_longest, max_file_size_mb,
        pillow_conversion_command(path, &output_path)
    )
}

pub fn mime_type_for_path(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".bmp") {
        "image/bmp"
    } else if lower.ends_with(".tiff") || lower.ends_with(".tif") {
        "image/tiff"
    } else if lower.ends_with(".ico") {
        "image/x-icon"
    } else {
        "application/octet-stream"
    }
}

pub fn format_file_size(bytes: u64) -> String {
    let mb = bytes as f64 / (1024.0 * 1024.0);
    if mb >= 1.0 {
        format!("{:.1} MB", mb)
    } else {
        format!("{:.0} KB", bytes as f64 / 1024.0)
    }
}
