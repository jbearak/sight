#!/bin/bash
#
# Sight LSP Setup Script
# Builds the VSIX package and installs it to supported editors,
# then installs the standalone binary.
#
# USAGE:
#   ./setup.sh                    # Interactive mode (prompts for conflicts)
#   ./setup.sh --yes              # Automated mode (auto-disables conflicts)
#   ./setup.sh -y                 # Automated mode (short form)
#
# INTERACTIVE MODE (default):
#   When the script detects incompatible Stata extensions (e.g.,
#   kylebarron.stata-enhanced), it will prompt you with three options:
#     1. Disable the extension
#     2. Uninstall the extension
#     3. Keep the extension (Sight's syntax highlighting won't be used)
#
#   You can make different choices for different editors. The script will
#   prompt separately for each editor/extension combination.
#
# AUTOMATED MODE (--yes or -y flag):
#   When the --yes or -y flag is provided, the script will automatically
#   disable any incompatible extensions without prompting.
#
#   Example: ./setup.sh --yes
#   Example: ./setup.sh -y
#
# REQUIREMENTS:
#   - bun (JavaScript runtime and package manager)
#   - VS Code or compatible editor (code, code-insiders, codium, kiro, etc.)
#

set -e

# Parse command-line arguments
AUTO_YES=false
while [ $# -gt 0 ]; do
    case $1 in
        --yes|-y)
            AUTO_YES=true
            ;;
        *)
            # Unknown argument - ignore for forward compatibility
            ;;
    esac
    shift
done

# Check for bun
if ! command -v bun &> /dev/null; then
    echo "Error: bun is required but not installed."
    echo "Install via: brew install bun  or  https://bun.sh"
    exit 1
fi

echo "=== Sight LSP Setup ==="
if [ "$AUTO_YES" = true ]; then
    echo "(Running in automated mode)"
fi
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# List of known incompatible extensions
# Add new extensions here as needed
INCOMPATIBLE_EXTENSIONS="kylebarron.stata-enhanced mdob2k.stata-language kylebutts.vscode-stata"

# Handle extension conflict interactively
# Presents options to user and executes chosen action
# Returns 0 to continue with installation, 1 to skip installation
handle_extension_conflict() {
    local editor="$1"
    local extension="$2"
    local choice
    
    while true; do
        echo ""
        echo "You have a Stata syntax highlighting extension, $extension, installed in $editor."
        echo "To use Sight's syntax highlighting:"
        echo "1. Disable $extension"
        echo "2. Uninstall $extension"
        echo "3. Do nothing and continue to use $extension's syntax highlighting"
        echo ""
        read -r -p "Please choose (1/2/3): " choice
        
        case $choice in
            1)
                echo "Disabling $extension..."
                if "$editor" --disable-extension "$extension" &> /dev/null; then
                    echo -e "${GREEN}✓ Extension disabled${NC}"
                else
                    echo -e "${YELLOW}Warning: Failed to disable extension${NC}"
                fi
                return 0
                ;;
            2)
                echo "Uninstalling $extension..."
                if "$editor" --uninstall-extension "$extension" &> /dev/null; then
                    echo -e "${GREEN}✓ Extension uninstalled${NC}"
                else
                    echo -e "${YELLOW}Warning: Failed to uninstall extension${NC}"
                fi
                return 0
                ;;
            3)
                echo "Keeping $extension - Sight's syntax highlighting will not be used in $editor"
                return 1
                ;;
            *)
                echo -e "${RED}Invalid choice. Please enter 1, 2, or 3.${NC}"
                ;;
        esac
    done
}

# Step 1: Install dependencies
echo "Installing dependencies..."
bun install
bun install --cwd client
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Step 2: Build and package the VSIX
echo "Building VSIX package..."
bun run package
echo -e "${GREEN}✓ VSIX package built${NC}"
echo ""

# Find the newest VSIX file by modification time (bash 3.2 compatible)
VSIX_FILE=""
newest_mtime=0
# Create a temporary file list to avoid process substitution (bash 3.2 compatibility)
temp_file_list=$(mktemp)
find client -maxdepth 1 -name "*.vsix" -type f 2>/dev/null > "$temp_file_list"
while IFS= read -r file; do
    if [ -n "$file" ]; then
        # Get modification time - try macOS stat first, fallback to GNU stat
        if mtime=$(stat -f %m "$file" 2>/dev/null) || mtime=$(stat -c %Y "$file" 2>/dev/null); then
            if [ "$mtime" -gt "$newest_mtime" ]; then
                newest_mtime="$mtime"
                VSIX_FILE="$file"
            fi
        fi
    fi
done < "$temp_file_list"
rm -f "$temp_file_list"
if [ -z "$VSIX_FILE" ]; then
    echo -e "${RED}Error: No VSIX file found in client/${NC}"
    exit 1
fi
echo "Found VSIX: $VSIX_FILE"
echo ""

# Step 3: Install to editors
echo "Installing extension to editors..."
EDITORS=("code" "code-insiders" "codium" "kiro" "antigravity" "cursor" "windsurf")
INSTALLED=0

for editor in "${EDITORS[@]}"; do
    if command -v "$editor" &> /dev/null; then
        echo -n "  $editor: "
        
        # Check for incompatible extensions directly (POSIX-compliant, no process substitution)
        skip_installation=false
        installed_extensions=$("$editor" --list-extensions 2>/dev/null || echo "")
        
        for extension in $INCOMPATIBLE_EXTENSIONS; do
            if echo "$installed_extensions" | grep -q "$extension"; then
                if [ "$AUTO_YES" = true ]; then
                    echo -n "(auto-disabling $extension) "
                    "$editor" --disable-extension "$extension" &> /dev/null || true
                else
                    if ! handle_extension_conflict "$editor" "$extension"; then
                        skip_installation=true
                        break
                    fi
                fi
            fi
        done
        
        # Install Sight if not skipped
        if [ "$skip_installation" = false ]; then
            if "$editor" --install-extension "$VSIX_FILE" --force &> /dev/null; then
                echo -e "${GREEN}✓${NC}"
                INSTALLED=$((INSTALLED + 1))
            else
                echo -e "${YELLOW}failed${NC}"
            fi
        else
            echo -e "${YELLOW}skipped (user choice)${NC}"
        fi
    else
        echo -e "  $editor: ${YELLOW}not found${NC}"
    fi
done

if [ $INSTALLED -eq 0 ]; then
    echo -e "${YELLOW}Warning: No editors found to install extension${NC}"
else
    echo -e "${GREEN}✓ Extension installed to $INSTALLED editor(s)${NC}"
fi
echo ""

# Step 4: Build and install the standalone binary
echo "Building standalone binary..."
bun run build:current
echo -e "${GREEN}✓ Binary built${NC}"
echo ""

echo "Installing binary to ~/bin..."
bun run install:binary
echo ""

# Step 5: Build and install Zed extension
echo "Building Zed extension..."

# Check for required tools
HAS_TREE_SITTER=false
HAS_CARGO=false

if command -v tree-sitter &> /dev/null; then
    HAS_TREE_SITTER=true
fi

if command -v cargo &> /dev/null; then
    HAS_CARGO=true
fi

if [ "$HAS_TREE_SITTER" = true ] && [ "$HAS_CARGO" = true ]; then
    # Build Tree-sitter grammar
    echo "  Generating Tree-sitter grammar..."
    cd zed-extension/tree-sitter-stata
    if tree-sitter generate &> /dev/null; then
        echo -e "  ${GREEN}✓ Tree-sitter grammar generated${NC}"
    else
        echo -e "  ${YELLOW}Warning: Tree-sitter grammar generation failed${NC}"
    fi
    cd ../..
    
    # Build Zed extension to WASM
    echo "  Compiling Zed extension to WASM..."
    
    # Use wasm32-wasip1 (required by Zed for WASM components)
    WASM_TARGET="wasm32-wasip1"
    
    # Check if target is installed
    if ! rustup target list --installed 2>/dev/null | grep -q "$WASM_TARGET"; then
        echo "  Installing $WASM_TARGET target..."
        if rustup target add "$WASM_TARGET" &> /dev/null; then
            echo -e "  ${GREEN}✓ $WASM_TARGET target installed${NC}"
        else
            echo -e "  ${YELLOW}Warning: Failed to install $WASM_TARGET target${NC}"
            echo "  Run manually: rustup target add $WASM_TARGET"
        fi
    fi
    
    # Build the extension
    cd zed-extension
    
    # Download WASI adapter if needed (required for component model)
    ADAPTER_URL="https://github.com/bytecodealliance/wasmtime/releases/download/v22.0.0/wasi_snapshot_preview1.reactor.wasm"
    ADAPTER_PATH="target/wasi_snapshot_preview1.reactor.wasm"
    
    mkdir -p target
    if [ ! -f "$ADAPTER_PATH" ]; then
        echo "  Downloading WASI adapter..."
        if curl -L -o "$ADAPTER_PATH" "$ADAPTER_URL" --fail --silent; then
            echo -e "  ${GREEN}✓ WASI adapter downloaded${NC}"
        else
            echo -e "  ${YELLOW}Warning: Failed to download WASI adapter${NC}"
            # Create an empty file to prevent build script from failing on missing variable? 
            # No, if download fails, the component new command will fail, which is handled.
        fi
    fi

    if cargo build --target "$WASM_TARGET" --release &> /dev/null; then
        echo -e "  ${GREEN}✓ Zed extension compiled${NC}"
        
        # Convert WASM module to component (required by Zed)
        if command -v wasm-tools &> /dev/null; then
            if wasm-tools component new "target/$WASM_TARGET/release/sight_extension.wasm" -o extension.wasm --adapt "wasi_snapshot_preview1=$ADAPTER_PATH" &> /dev/null; then
                echo -e "  ${GREEN}✓ WASM component created${NC}"
            else
                echo -e "  ${YELLOW}Warning: Failed to create WASM component (check adapter)${NC}"
            fi
        else
            echo -e "  ${YELLOW}Warning: wasm-tools not found - install with: cargo install wasm-tools${NC}"
            cp "target/$WASM_TARGET/release/sight_extension.wasm" extension.wasm
        fi
    else
        echo -e "  ${YELLOW}Warning: Zed extension compilation failed${NC}"
    fi
    cd ..
    
    # Copy server binary to Zed extension
    echo "  Bundling server binary..."
    mkdir -p zed-extension/server/command-database/caches
    
    # Try to copy the platform-specific binary first, then fall back to JS bundle
    BINARY_COPIED=false
    
    # Find the binary for the current platform
    if [ -d "bin" ]; then
        # Look for platform-specific binary in bin/
        for binary in bin/sight-server-*; do
            if [ -f "$binary" ]; then
                cp "$binary" zed-extension/server/sight-server
                BINARY_COPIED=true
                break
            fi
        done
    fi
    
    # Fall back to JS bundle if no binary found
    if [ "$BINARY_COPIED" = false ] && [ -f "dist/sight-server.js" ]; then
        cp dist/sight-server.js zed-extension/server/sight-server
        BINARY_COPIED=true
    fi
    
    if [ "$BINARY_COPIED" = true ]; then
        echo -e "  ${GREEN}✓ Server binary bundled${NC}"
    else
        echo -e "  ${YELLOW}Warning: No server binary found to bundle${NC}"
    fi
    
    # Copy command database caches
    echo "  Copying command database caches..."
    if [ -d "src/command-database/caches" ]; then
        cp -r src/command-database/caches/* zed-extension/server/command-database/caches/ 2>/dev/null || true
        echo -e "  ${GREEN}✓ Command database caches copied${NC}"
    else
        echo -e "  ${YELLOW}Warning: Command database caches not found${NC}"
    fi
    
    echo -e "${GREEN}✓ Zed extension built${NC}"
    echo ""
    
    # Install to Zed if available
    ZED_CMD=""
    if command -v zed &> /dev/null; then
        ZED_CMD="zed"
    elif [ -x "/Applications/Zed.app/Contents/MacOS/cli" ]; then
        ZED_CMD="/Applications/Zed.app/Contents/MacOS/cli"
    fi
    
    if [ -n "$ZED_CMD" ]; then
        echo "Installing Zed extension as dev extension..."
        
        # Determine Zed extensions directory (check both macOS locations)
        ZED_EXT_DIR=""
        if [ -d "$HOME/.config/zed/extensions" ]; then
            ZED_EXT_DIR="$HOME/.config/zed/extensions/installed/sight"
        elif [ -d "$HOME/Library/Application Support/Zed/extensions" ]; then
            ZED_EXT_DIR="$HOME/Library/Application Support/Zed/extensions/installed/sight"
        else
            # Default to ~/.config/zed (will be created)
            ZED_EXT_DIR="$HOME/.config/zed/extensions/installed/sight"
        fi
        
        # Create parent directory if needed
        mkdir -p "$(dirname "$ZED_EXT_DIR")"
        
        # Remove existing symlink/directory and create new symlink
        rm -rf "$ZED_EXT_DIR"
        ln -s "$(pwd)/zed-extension" "$ZED_EXT_DIR"
        
        echo -e "${GREEN}✓ Zed extension installed to: $ZED_EXT_DIR${NC}"
    else
        echo -e "${YELLOW}Zed not found - skipping Zed extension installation${NC}"
        echo "  To install manually, symlink zed-extension/ to your Zed extensions directory"
    fi
else
    echo -e "${YELLOW}tree-sitter or cargo not found - skipping Zed extension build${NC}"
    if [ "$HAS_TREE_SITTER" = false ]; then
        echo "  Missing: tree-sitter (install with: npm install -g tree-sitter-cli)"
    fi
    if [ "$HAS_CARGO" = false ]; then
        echo "  Missing: cargo (install with: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh)"
    fi
fi
echo ""

echo "=== Setup Complete ==="
