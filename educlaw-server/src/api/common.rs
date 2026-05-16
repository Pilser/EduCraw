// Shared utility functions for API handlers

use std::path::PathBuf;

/// Recursively copy directory and all contents
pub fn copy_dir_all(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    // Verify source directory exists and is readable
    if !src.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Source directory not found: {}", src.display()),
        ));
    }

    let metadata = std::fs::metadata(src)?;
    if !metadata.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("Source is not a directory: {}", src.display()),
        ));
    }

    // Create destination directory
    std::fs::create_dir_all(dst).map_err(|e| {
        std::io::Error::new(
            e.kind(),
            format!(
                "Failed to create destination directory {}: {}",
                dst.display(),
                e
            ),
        )
    })?;

    let entries = std::fs::read_dir(src).map_err(|e| {
        std::io::Error::new(
            e.kind(),
            format!("Failed to read source directory {}: {}", src.display(), e),
        )
    })?;

    for entry in entries {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_path = entry.path();
        let file_name = entry.file_name();
        let dst_path = dst.join(&file_name);

        if ty.is_dir() {
            copy_dir_all(&src_path, &dst_path).map_err(|e| {
                std::io::Error::new(
                    e.kind(),
                    format!(
                        "Failed to copy directory {} to {}: {}",
                        src_path.display(),
                        dst_path.display(),
                        e
                    ),
                )
            })?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| {
                std::io::Error::new(
                    e.kind(),
                    format!(
                        "Failed to copy file {} to {}: {}",
                        src_path.display(),
                        dst_path.display(),
                        e
                    ),
                )
            })?;
        }
    }
    Ok(())
}

/// Copy goose config template files for a new student
pub fn setup_goose_config(student_id: &str, students_root: &str) {
    let student_dir = PathBuf::from(students_root).join(student_id);
    let goose_template = PathBuf::from("/srv/educraw/templates/goose-config/config");
    let goose_dst = student_dir.join("config");

    // Debug: Log paths being used
    tracing::debug!(
        student_id = %student_id,
        student_dir = %student_dir.display(),
        goose_template = %goose_template.display(),
        goose_dst = %goose_dst.display(),
        "attempting to copy goose config template"
    );

    // Step 1: Verify source template exists and is readable
    if !goose_template.exists() {
        tracing::warn!(
            student_id = %student_id,
            source_path = %goose_template.display(),
            "source template directory not found"
        );
        return;
    }

    if !goose_template.is_dir() {
        tracing::warn!(
            student_id = %student_id,
            source_path = %goose_template.display(),
            "source template path is not a directory"
        );
        return;
    }

    // Step 2: Create student directory if it doesn't exist
    if let Err(e) = std::fs::create_dir_all(&student_dir) {
        tracing::error!(
            student_id = %student_id,
            student_dir = %student_dir.display(),
            error = %e,
            "failed to create student directory"
        );
        return;
    }

    tracing::debug!(
        student_id = %student_id,
        student_dir = %student_dir.display(),
        "student directory created or already exists"
    );

    // Step 3: Attempt to copy template files
    if let Err(e) = copy_dir_all(&goose_template, &goose_dst) {
        tracing::error!(
            student_id = %student_id,
            source = %goose_template.display(),
            destination = %goose_dst.display(),
            error = %e,
            "failed to copy goose config template files"
        );
        return;
    }

    tracing::info!(
        student_id = %student_id,
        destination = %goose_dst.display(),
        "goose config template copied successfully"
    );

    // Step 4: Set file permissions: config.yaml 644, secrets.yaml 600
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let config_yaml_path = goose_dst.join("config.yaml");
        let secrets_yaml_path = goose_dst.join("secrets.yaml");

        match std::fs::set_permissions(&config_yaml_path, std::fs::Permissions::from_mode(0o644)) {
            Ok(_) => tracing::debug!(
                student_id = %student_id,
                path = %config_yaml_path.display(),
                permissions = "0644",
                "config.yaml permissions set"
            ),
            Err(e) => tracing::warn!(
                student_id = %student_id,
                path = %config_yaml_path.display(),
                error = %e,
                "failed to set config.yaml permissions"
            ),
        }

        match std::fs::set_permissions(&secrets_yaml_path, std::fs::Permissions::from_mode(0o600)) {
            Ok(_) => tracing::debug!(
                student_id = %student_id,
                path = %secrets_yaml_path.display(),
                permissions = "0600",
                "secrets.yaml permissions set"
            ),
            Err(e) => tracing::warn!(
                student_id = %student_id,
                path = %secrets_yaml_path.display(),
                error = %e,
                "failed to set secrets.yaml permissions"
            ),
        }
    }
}
