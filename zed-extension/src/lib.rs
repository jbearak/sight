use zed_extension_api::{self as zed, Result};

struct SightExtension;

impl zed::Extension for SightExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        // The binary should be bundled at ./server/sight-server. When running as a
        // dev extension, Zed executes from extensions/work/<id>, and the server
        // lives under extensions/installed/<id>. Fall back to that path.
        let work_dir = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {}", e))?;

        let mut candidate_paths = Vec::new();
        candidate_paths.push(
            work_dir
                .join("server")
                .join("sight-server"),
        );

        if let Some(extensions_dir) = work_dir.parent().and_then(|p| p.parent()) {
            candidate_paths.push(
                extensions_dir
                    .join("installed")
                    .join("sight")
                    .join("server")
                    .join("sight-server"),
            );
        }

        let server_path = candidate_paths
            .into_iter()
            .find(|path| path.exists())
            .ok_or_else(|| {
                format!(
                    "Sight server binary not found. Tried work dir and installed dir relative to {:?}.",
                    work_dir
                )
            })?;

        Ok(zed::Command {
            command: server_path.to_string_lossy().into_owned(),
            args: vec!["--stdio".to_string()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(SightExtension);
