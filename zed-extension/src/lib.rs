use zed_extension_api::{self as zed, DownloadedFileType, Result};

const SERVER_VERSION: &str = "v0.1.9";

struct SightExtension {
    cached_binary_path: Option<String>,
}

impl zed::Extension for SightExtension {
    fn new() -> Self {
        Self { cached_binary_path: None }
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let binary_path = self.get_server_binary_path()?;
        Ok(zed::Command {
            command: binary_path,
            args: vec!["--stdio".to_string()],
            env: Default::default(),
        })
    }
}

impl SightExtension {
    fn get_server_binary_path(&mut self) -> Result<String> {
        if let Some(path) = &self.cached_binary_path {
            if std::fs::metadata(path).is_ok() {
                return Ok(path.clone());
            }
        }

        let (platform, arch) = zed::current_platform();
        let asset_name = match (platform, arch) {
            (zed::Os::Mac, zed::Architecture::Aarch64) => "sight-darwin-arm64",
            (zed::Os::Mac, zed::Architecture::X8664) => "sight-darwin-arm64", // Use ARM binary via Rosetta
            (zed::Os::Linux, zed::Architecture::Aarch64) => "sight-linux-arm64",
            (zed::Os::Linux, zed::Architecture::X8664) => "sight-linux-x64",
            (zed::Os::Windows, _) => "sight-windows-x64.exe",
            _ => return Err(format!("Unsupported platform: {:?} {:?}", platform, arch)),
        };

        let binary_path = format!("sight-server-{}/{}", SERVER_VERSION, asset_name);

        if std::fs::metadata(&binary_path).is_err() {
            zed::set_language_server_installation_status(
                &zed::LanguageServerId::new("sight"),
                &zed::LanguageServerInstallationStatus::Downloading,
            );

            let release = zed::github_release_by_tag_name("jbearak/sight", SERVER_VERSION)
                .map_err(|e| format!("Failed to fetch release: {}", e))?;

            let asset = release.assets.iter().find(|a| a.name == asset_name)
                .ok_or_else(|| format!("No asset '{}' in release", asset_name))?;

            zed::download_file(&asset.download_url, &binary_path, DownloadedFileType::Uncompressed)
                .map_err(|e| format!("Failed to download: {}", e))?;

            zed::make_file_executable(&binary_path)?;
        }

        self.cached_binary_path = Some(binary_path.clone());
        Ok(binary_path)
    }
}

zed::register_extension!(SightExtension);
