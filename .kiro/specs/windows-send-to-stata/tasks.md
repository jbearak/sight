# Implementation Tasks

## Task 1: Add focusStataWindow Setting and macOS Support
Add the new focusStataWindow configuration setting and implement focus management for macOS.

**Requirements:** 1.3, 11.4, 14.1-14.6, 15.1-15.2

- [x] 1.1 Add `sight.sendToStata.focusStataWindow` boolean setting to `client/package.json` with default `false`
- [x] 1.2 Update `sight.sendToStata.stataApp` description in `client/package.json` to include StataBE as a valid option
- [x] 1.3 Add StataBE to `VALID_STATA_APPS` array in `client/src/send-to-stata/applescript.ts`
- [x] 1.4 Update `StataVariant` type in `client/src/send-to-stata/index.ts` to include `'StataBE'`
- [x] 1.5 Modify `send_to_stata_app()` in `applescript.ts` to accept `focus_stata` parameter and activate VS Code after sending when `focus_stata` is false
- [x] 1.6 Update `handle_send_command()` in `commands.ts` to read `focusStataWindow` setting and pass to `send_to_stata_app()`

## Task 2: Create Executable Downloader Module
Implement the on-demand download infrastructure for the Windows executable.

**Requirements:** 12.1-12.9, 13.1-13.4

- [x] 2.1 Create `client/src/send-to-stata/exe-downloader.ts` with `ExecutableInfo` and `DownloadResult` interfaces
- [x] 2.2 Implement `get_windows_architecture()` function to detect x64 vs arm64 using `process.arch` and `PROCESSOR_ARCHITECTURE` env var
- [x] 2.3 Implement `get_executable_info()` to check if executable exists in global storage and return version info
- [x] 2.4 Implement `prompt_download()` to show VS Code information message with Download/Cancel options
- [x] 2.5 Implement `download_executable()` with progress indication using `vscode.window.withProgress()`
- [x] 2.6 Implement SHA-256 checksum verification for downloaded executable
- [x] 2.7 Implement `check_for_updates()` to compare installed version against required version
- [x] 2.8 Add hardcoded checksums and download URLs for v0.1.11 executables (x64 and arm64)

## Task 3: Create Windows Sender Module
Implement the Windows-specific code sending functionality.

**Requirements:** 1.1, 2.1-2.3, 3.1-3.7, 4.1-4.5, 5.1-5.4, 8.1-8.4

- [x] 3.1 Create `client/src/send-to-stata/windows-sender.ts` with `WindowsSendResult` interface
- [x] 3.2 Implement `ensure_executable()` function that calls downloader and returns executable path or null
- [x] 3.3 Implement `send_to_stata_windows()` function that spawns the executable with correct arguments
- [x] 3.4 Implement `map_exit_code_to_message()` function to translate exit codes (1-5) to user-friendly messages
- [x] 3.5 Implement Automation registration error detection and user guidance (check stderr for 'automation', '80040154', 'REGDB_E_CLASSNOTREG')
- [x] 3.6 Add `-ActivateStata` flag handling based on `focusStataWindow` setting
- [x] 3.7 Add `-Include` flag handling for include command mode

## Task 4: Integrate Windows Support into Commands Module
Wire up the Windows sender to the main command handler.

**Requirements:** 1.1-1.2, 4.1-4.5, 6.1-6.3, 7.1-7.5, 10.1-10.5, 11.1-11.3

- [x] 4.1 Update `handle_send_command()` in `commands.ts` to call `send_to_stata_windows()` when `process.platform === 'win32'` and target is 'app'
- [x] 4.2 Pass `context: vscode.ExtensionContext` to `handle_send_command()` for global storage access
- [x] 4.3 Update `register_send_to_stata_commands()` to pass extension context to command handlers
- [x] 4.4 Export `send_to_stata_windows` and `ensure_executable` from `client/src/send-to-stata/index.ts`

## Task 5: Update Menu Visibility for Windows
Enable app-mode menu items on Windows platform.

**Requirements:** 1.1, 4.1-4.5

- [x] 5.1 Update `client/package.json` menu visibility conditions to show app-mode commands on Windows (remove `isMac` restriction or add `isWindows` alternative)

## Task 6: Write Unit Tests
Create unit tests for the new Windows functionality.

**Requirements:** All

- [x] 6.1 Write unit tests for `get_windows_architecture()` function with mocked environment
- [x] 6.2 Write unit tests for `map_exit_code_to_message()` function covering all exit codes
- [x] 6.3 Write unit tests for checksum verification logic
- [x] 6.4 Write unit tests for version comparison logic in `check_for_updates()`
- [x] 6.5 Write unit tests for Automation error detection patterns

## Task 7: Write Property Tests
Create property-based tests for the Windows functionality.

**Requirements:** 12.4-12.6, 13.2

- [x] 7.1 Write property test for architecture detection consistency (Property 2 from design)
- [x] 7.2 Write property test for version monotonicity (Property 3 from design)
- [x] 7.3 Write property test for checksum integrity - mismatched checksums must never save (Property 4 from design)
