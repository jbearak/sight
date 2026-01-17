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
        // The binary is guaranteed to be bundled at ./server/sight-server.
        // NOTE: confirm Zed's extension working directory contract; if it differs,
        // switch to a Zed-provided API for locating bundled assets.
        let server_path = std::env::current_dir()?
            .join("server")
            .join("sight-server");

        if !server_path.exists() {
            return Err(format!(
                "Sight server binary not found at {:?}. This extension bundle may be corrupt or for the wrong platform.",
                server_path
            )
            .into());
        }

        Ok(zed::Command {
            command: server_path.to_string_lossy().into_owned(),
            args: vec!["--stdio".to_string()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(SightExtension);
