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
# Run both bun install and npm install here because vsce expects npm-style
# dependency metadata; bun install alone does not produce a node_modules tree
# that vsce reliably packages for the client VSIX.
bun install
bun install --cwd client
echo "Normalizing client package metadata for VSIX packaging..."
npm install --prefix client
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

echo "=== Setup Complete ==="
