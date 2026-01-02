#!/bin/bash
#
# Validation tests for setup.sh bash3-compatible implementation
# Tests verify:
# 1. Bash syntax validity
# 2. Argument parsing (--yes/-y)
# 3. No bash 4+ constructs (mapfile, process substitution, C-style increment)
# 4. Required functions and variables exist
#

# Check bash version (requires bash 4+ for &> redirection)
if [ "${BASH_VERSION%%.*}" -lt 4 ]; then
    echo "Error: This test script requires bash 4 or later (current: $BASH_VERSION)"
    echo "Install with: brew install bash"
    echo "Then run with: /opt/homebrew/bin/bash $0"
    exit 1
fi

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function to run a test
run_test() {
    local test_name="$1"
    local test_command="$2"
    
    echo -n "Testing: $test_name... "
    if eval "$test_command" &> /dev/null; then
        echo -e "${GREEN}✓${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}✗${NC}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# Test 1: Verify bash syntax is valid
run_test "Bash syntax validation" "bash -n setup.sh"

# Test 2: Verify AUTO_YES variable is initialized
run_test "AUTO_YES initialization" "grep -q 'AUTO_YES=false' setup.sh"

# Test 3: Verify --yes flag is recognized
run_test "--yes flag recognized" "grep -q '\-\-yes' setup.sh"

# Test 4: Verify -y flag is recognized
run_test "-y flag recognized" "grep -q '\-y)' setup.sh"

# Test 5: Verify handle_extension_conflict function exists
run_test "handle_extension_conflict function" "grep -q 'handle_extension_conflict()' setup.sh"

# Test 6: Verify handle_extension_conflict has while loop
run_test "handle_extension_conflict while loop" "grep -A 30 'handle_extension_conflict()' setup.sh | grep -q 'while true'"

# Test 7: Verify invalid choice message
run_test "Invalid choice message" "grep -q 'Invalid choice' setup.sh"

# Test 8: Verify read -r usage
run_test "read -r usage" "grep -q 'read -r' setup.sh"

# Test 9: Verify INCOMPATIBLE_EXTENSIONS defined
run_test "INCOMPATIBLE_EXTENSIONS defined" "grep -q 'INCOMPATIBLE_EXTENSIONS=' setup.sh"

# Test 10: Verify stata-enhanced in incompatible list
run_test "stata-enhanced in list" "grep -q 'kylebarron.stata-enhanced' setup.sh"

# Test 11: Verify EDITORS array exists
run_test "EDITORS array exists" "grep -q 'EDITORS=' setup.sh"

# Test 12: Verify editor loop exists
run_test "Editor loop exists" "grep -q 'for editor in' setup.sh"

# Test 13: No mapfile/readarray (bash 4+)
run_test "No mapfile/readarray" "! grep -qE 'mapfile|readarray' setup.sh"

# Test 14: No process substitution '< <(' (bash 4+)
run_test "No process substitution" "! grep -q '< <(' setup.sh"

# Test 15: No C-style increment ++/-- (bash 4+)
run_test "No C-style increment" "! grep -qE '\(\([^)]*\+\+|\(\([^)]*\-\-' setup.sh"

# Test 16: Uses POSIX arithmetic increment
run_test "POSIX arithmetic increment" "grep -q 'INSTALLED=\$((INSTALLED + 1))' setup.sh"

# Test 17: VSIX discovery uses find
run_test "VSIX uses find" "grep -q 'find client' setup.sh"

# Test 18: Handles missing VSIX
run_test "Missing VSIX handling" "grep -q 'No VSIX file found' setup.sh"

echo ""
echo "=== Test Results ==="
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}All validation tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some validation tests failed!${NC}"
    exit 1
fi
