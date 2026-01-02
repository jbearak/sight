/**
 * Unit tests for resolve_parent_forward_calls() in ScopeResolver.
 *
 * Tests the behavior of parent forward call resolution when a child file
 * uses @lsp-done-by or @lsp-included-by directives. The method resolves
 * forward calls (do/run/include) in the parent file that occur BEFORE
 * the call site where the child is invoked.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { create_test_scope_resolver_logger } from '../test-logger';

describe('resolve_parent_forward_calls() via ScopeResolver.resolve()', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver(create_test_scope_resolver_logger());
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parent-forward-call-test-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    /**
     * Helper to create test files in the temp directory.
     */
    const create_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    /**
     * Helper to get file URI from path.
     */
    const to_uri = (file_path: string): string => {
        return `file://${file_path}`;
    };

    describe('no forward calls in parent', () => {
        it('should return empty symbols when parent has no forward calls', async () => {
            // Parent file with no do/run/include commands
            const parent_path = create_file('parent.do', `
global parent_var = 1
local parent_local = 2
`);

            // Child file that references parent
            const child_content = `// @lsp-done-by: "${parent_path}"
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            const result = await scope_resolver.resolve(child_uri, child_content);

            // Should have parent's global (done-by excludes locals)
            expect(result.symbols.globalMacros.has('parent_var')).toBe(true);
            // Should NOT have parent's local (done-by excludes locals)
            expect(result.symbols.localMacros.has('parent_local')).toBe(false);
            // Should have child's local
            expect(result.symbols.localMacros.has('child_var')).toBe(true);
            // No diagnostics about forward calls
            expect(result.diagnostics.filter(d => d.message.includes('forward'))).toHaveLength(0);
        });
    });

    describe('forward calls before call site', () => {
        it('should include symbols from forward calls that occur before the call site', async () => {
            // Helper file that defines a global
            const helper_path = create_file('helper.do', `
global helper_global = "from helper"
`);

            // Parent file that calls helper BEFORE calling child
            const parent_content = `
global parent_global = 1
do "${helper_path}"
do "child.do"
`;
            const parent_path = create_file('parent.do', parent_content);

            // Child file that references parent with explicit call site
            const child_content = `// @lsp-done-by: "${parent_path}" match="child.do"
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            const result = await scope_resolver.resolve(child_uri, child_content);

            // Should have parent's global
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
            // Should have helper's global (from forward call before call site)
            expect(result.symbols.globalMacros.has('helper_global')).toBe(true);
            // Should have child's local
            expect(result.symbols.localMacros.has('child_var')).toBe(true);
        });

        it('should include symbols from multiple forward calls before call site', async () => {
            // First helper file
            const helper1_path = create_file('helper1.do', `
global helper1_global = "from helper1"
`);

            // Second helper file
            const helper2_path = create_file('helper2.do', `
global helper2_global = "from helper2"
`);

            // Parent file that calls both helpers BEFORE calling child
            const parent_content = `
global parent_global = 1
do "${helper1_path}"
do "${helper2_path}"
do "child.do"
`;
            const parent_path = create_file('parent.do', parent_content);

            // Child file that references parent
            const child_content = `// @lsp-done-by: "${parent_path}" match="child.do"
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            const result = await scope_resolver.resolve(child_uri, child_content);

            // Should have all globals
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
            expect(result.symbols.globalMacros.has('helper1_global')).toBe(true);
            expect(result.symbols.globalMacros.has('helper2_global')).toBe(true);
        });
    });

    describe('forward calls after call site', () => {
        it('should NOT include symbols from forward calls that occur after the call site', async () => {
            // Helper file that defines a global
            const helper_path = create_file('helper.do', `
global helper_global = "from helper"
`);

            // Parent file that calls helper AFTER calling child
            const parent_content = `
global parent_global = 1
do "child.do"
do "${helper_path}"
`;
            const parent_path = create_file('parent.do', parent_content);

            // Child file that references parent with explicit call site
            const child_content = `// @lsp-done-by: "${parent_path}" match="child.do"
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            const result = await scope_resolver.resolve(child_uri, child_content);

            // Should have parent's global
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
            // Should NOT have helper's global (forward call is after call site)
            expect(result.symbols.globalMacros.has('helper_global')).toBe(false);
            // Should have child's local
            expect(result.symbols.localMacros.has('child_var')).toBe(true);
        });

        it('should NOT include symbols from forward calls at the same line as call site', async () => {
            // Helper file that defines a global
            const helper_path = create_file('helper.do', `
global helper_global = "from helper"
`);

            // Parent file where helper call is on same line as child call (edge case)
            // In practice this is rare, but we test the boundary condition
            const parent_content = `global parent_global = 1
do "child.do"
do "${helper_path}"
`;
            const parent_path = create_file('parent.do', parent_content);

            // Child file that references parent with line=2 (1-indexed in directive)
            const child_content = `// @lsp-done-by: "${parent_path}" line=2
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            const result = await scope_resolver.resolve(child_uri, child_content);

            // Should have parent's global (defined on line 0, before call site line 1)
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
            // Should NOT have helper's global (forward call is on line 2, after call site line 1)
            expect(result.symbols.globalMacros.has('helper_global')).toBe(false);
        });
    });

    describe('mixed forward calls (some before, some after)', () => {
        it('should only include symbols from calls before the call site', async () => {
            // Helper files
            const before_helper_path = create_file('before_helper.do', `
global before_global = "from before"
`);

            const after_helper_path = create_file('after_helper.do', `
global after_global = "from after"
`);

            // Parent file with forward calls both before and after child call
            const parent_content = `
global parent_global = 1
do "${before_helper_path}"
do "child.do"
do "${after_helper_path}"
`;
            const parent_path = create_file('parent.do', parent_content);

            // Child file that references parent
            const child_content = `// @lsp-done-by: "${parent_path}" match="child.do"
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            const result = await scope_resolver.resolve(child_uri, child_content);

            // Should have parent's global
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
            // Should have before_helper's global (forward call before call site)
            expect(result.symbols.globalMacros.has('before_global')).toBe(true);
            // Should NOT have after_helper's global (forward call after call site)
            expect(result.symbols.globalMacros.has('after_global')).toBe(false);
        });

        it('should handle multiple forward calls with correct ordering', async () => {
            // Helper files
            const helper1_path = create_file('helper1.do', `
global helper1_global = "from helper1"
`);

            const helper2_path = create_file('helper2.do', `
global helper2_global = "from helper2"
`);

            const helper3_path = create_file('helper3.do', `
global helper3_global = "from helper3"
`);

            // Parent file: helper1 and helper2 before child, helper3 after
            const parent_content = `
global parent_global = 1
do "${helper1_path}"
do "${helper2_path}"
do "child.do"
do "${helper3_path}"
`;
            const parent_path = create_file('parent.do', parent_content);

            // Child file that references parent
            const child_content = `// @lsp-done-by: "${parent_path}" match="child.do"
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            const result = await scope_resolver.resolve(child_uri, child_content);

            // Should have parent's global
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
            // Should have helper1 and helper2 globals (before call site)
            expect(result.symbols.globalMacros.has('helper1_global')).toBe(true);
            expect(result.symbols.globalMacros.has('helper2_global')).toBe(true);
            // Should NOT have helper3's global (after call site)
            expect(result.symbols.globalMacros.has('helper3_global')).toBe(false);
        });
    });

    describe('inheritance rules with forward calls', () => {
        it('should apply done-by inheritance rules to forward call symbols', async () => {
            // Helper file with both local and global
            const helper_path = create_file('helper.do', `
global helper_global = "from helper"
local helper_local = "local from helper"
`);

            // Parent file that calls helper before child
            const parent_content = `
global parent_global = 1
do "${helper_path}"
do "child.do"
`;
            const parent_path = create_file('parent.do', parent_content);

            // Child file with done-by directive (excludes locals)
            const child_content = `// @lsp-done-by: "${parent_path}" match="child.do"
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            const result = await scope_resolver.resolve(child_uri, child_content);

            // Should have helper's global
            expect(result.symbols.globalMacros.has('helper_global')).toBe(true);
            // Should NOT have helper's local (done-by excludes locals, and do command also excludes locals)
            expect(result.symbols.localMacros.has('helper_local')).toBe(false);
        });

        it('should apply included-by inheritance rules to forward call symbols', async () => {
            // Helper file with both local and global
            const helper_path = create_file('helper.do', `
global helper_global = "from helper"
local helper_local = "local from helper"
`);

            // Parent file that includes helper before child
            const parent_content = `
global parent_global = 1
local parent_local = 2
include "${helper_path}"
include "child.do"
`;
            const parent_path = create_file('parent.do', parent_content);

            // Child file with included-by directive (includes locals)
            const child_content = `// @lsp-included-by: "${parent_path}" match="child.do"
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            const result = await scope_resolver.resolve(child_uri, child_content);

            // Should have parent's global and local (included-by includes all)
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
            expect(result.symbols.localMacros.has('parent_local')).toBe(true);
            // Should have helper's global
            expect(result.symbols.globalMacros.has('helper_global')).toBe(true);
            // Should have helper's local (include command preserves locals, included-by preserves locals)
            expect(result.symbols.localMacros.has('helper_local')).toBe(true);
        });
    });

    describe('edge cases', () => {
        it('should handle parent with only forward calls after call site', async () => {
            // Helper file
            const helper_path = create_file('helper.do', `
global helper_global = "from helper"
`);

            // Parent file where all forward calls are after child call
            const parent_content = `
global parent_global = 1
do "child.do"
do "${helper_path}"
`;
            const parent_path = create_file('parent.do', parent_content);

            // Child file
            const child_content = `// @lsp-done-by: "${parent_path}" match="child.do"
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            const result = await scope_resolver.resolve(child_uri, child_content);

            // Should have parent's global
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
            // Should NOT have helper's global
            expect(result.symbols.globalMacros.has('helper_global')).toBe(false);
        });

        it('should handle missing forward call target file gracefully', async () => {
            // Parent file that calls a non-existent helper before child
            const parent_content = `
global parent_global = 1
do "nonexistent_helper.do"
do "child.do"
`;
            const parent_path = create_file('parent.do', parent_content);

            // Child file
            const child_content = `// @lsp-done-by: "${parent_path}" match="child.do"
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            const result = await scope_resolver.resolve(child_uri, child_content);

            // Should have parent's global
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
            // Should have a diagnostic about the missing file
            const missing_file_diagnostics = result.diagnostics.filter(
                d => d.message.includes('Cannot read file') && d.message.includes('nonexistent_helper')
            );
            expect(missing_file_diagnostics.length).toBeGreaterThan(0);
        });

        it('should handle call site at end of file (assume_call_site: end)', async () => {
            // Helper file
            const helper_path = create_file('helper.do', `
global helper_global = "from helper"
`);

            // Parent file with forward call but no explicit child call
            const parent_content = `
global parent_global = 1
do "${helper_path}"
`;
            const parent_path = create_file('parent.do', parent_content);

            // Child file with no explicit call site (defaults to end)
            const child_content = `// @lsp-done-by: "${parent_path}"
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            const result = await scope_resolver.resolve(child_uri, child_content, {
                assume_call_site: 'end',
            });

            // Should have parent's global
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
            // Should have helper's global (call site assumed at end, so all forward calls are before)
            expect(result.symbols.globalMacros.has('helper_global')).toBe(true);
        });

        it('should handle call site at start of file (assume_call_site: start)', async () => {
            // Helper file
            const helper_path = create_file('helper.do', `
global helper_global = "from helper"
`);

            // Parent file with forward call but no explicit child call
            const parent_content = `
global parent_global = 1
do "${helper_path}"
`;
            const parent_path = create_file('parent.do', parent_content);

            // Child file with no explicit call site
            const child_content = `// @lsp-done-by: "${parent_path}"
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            const result = await scope_resolver.resolve(child_uri, child_content, {
                assume_call_site: 'start',
            });

            // Should NOT have parent's global (defined after call site line 0)
            // Note: parent_global is on line 1 (0-indexed), call site is 0
            expect(result.symbols.globalMacros.has('parent_global')).toBe(false);
            // Should NOT have helper's global (forward call is after call site)
            expect(result.symbols.globalMacros.has('helper_global')).toBe(false);
        });
    });

    describe('no forward scope resolver set', () => {
        it('should return empty symbols when forward scope resolver is not set', async () => {
            // Create a resolver without forward scope resolver
            const resolver_without_forward = new ScopeResolver(create_test_scope_resolver_logger());
            // Note: NOT calling set_forward_scope_resolver()

            // Helper file
            const helper_path = create_file('helper.do', `
global helper_global = "from helper"
`);

            // Parent file that calls helper before child
            const parent_content = `
global parent_global = 1
do "${helper_path}"
do "child.do"
`;
            const parent_path = create_file('parent.do', parent_content);

            // Child file
            const child_content = `// @lsp-done-by: "${parent_path}" match="child.do"
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            const result = await resolver_without_forward.resolve(child_uri, child_content);

            // Should have parent's global
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
            // Should NOT have helper's global (forward resolver not set)
            expect(result.symbols.globalMacros.has('helper_global')).toBe(false);
        });
    });
});


describe('depth limiting and cycle detection', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver(create_test_scope_resolver_logger());
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'depth-cycle-test-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const create_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    const to_uri = (file_path: string): string => {
        return `file://${file_path}`;
    };

    describe('depth limiting', () => {
        it('should stop at max depth with deep nested forward calls', async () => {
            // Create a chain of files: helper1 -> helper2 -> helper3 -> helper4
            const helper4_path = create_file('helper4.do', `
global helper4_global = "from helper4"
`);

            const helper3_path = create_file('helper3.do', `
global helper3_global = "from helper3"
do "${helper4_path}"
`);

            const helper2_path = create_file('helper2.do', `
global helper2_global = "from helper2"
do "${helper3_path}"
`);

            const helper1_path = create_file('helper1.do', `
global helper1_global = "from helper1"
do "${helper2_path}"
`);

            // Parent file that calls helper1 before child
            const parent_content = `
global parent_global = 1
do "${helper1_path}"
do "child.do"
`;
            const parent_path = create_file('parent.do', parent_content);

            // Child file
            const child_content = `// @lsp-done-by: "${parent_path}" match="child.do"
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            // With max_chain_depth=3, we should get parent + helper1 + helper2
            // but not helper3 or helper4
            const result = await scope_resolver.resolve(child_uri, child_content, {
                max_chain_depth: 3,
            });

            // Should have parent's global
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
            // Should have helper1's global (depth 1)
            expect(result.symbols.globalMacros.has('helper1_global')).toBe(true);
            // Should have helper2's global (depth 2)
            expect(result.symbols.globalMacros.has('helper2_global')).toBe(true);
            // Should NOT have helper3's global (depth 3 exceeds limit)
            expect(result.symbols.globalMacros.has('helper3_global')).toBe(false);
            // Should NOT have helper4's global (depth 4 exceeds limit)
            expect(result.symbols.globalMacros.has('helper4_global')).toBe(false);
        });

        it('should emit warning when max depth is exceeded', async () => {
            // Create a chain of files
            const helper2_path = create_file('helper2.do', `
global helper2_global = "from helper2"
`);

            const helper1_path = create_file('helper1.do', `
global helper1_global = "from helper1"
do "${helper2_path}"
`);

            // Parent file that calls helper1 before child
            const parent_content = `
global parent_global = 1
do "${helper1_path}"
do "child.do"
`;
            const parent_path = create_file('parent.do', parent_content);

            // Child file
            const child_content = `// @lsp-done-by: "${parent_path}" match="child.do"
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            // With max_backward_depth=1, backward resolution should hit the limit
            const result = await scope_resolver.resolve(child_uri, child_content, {
                max_backward_depth: 1,
                diagnostics: {
                    max_depth: 'info',
                },
            });

            // Should have a diagnostic about max depth
            const depth_diagnostics = result.diagnostics.filter(
                d => d.message.toLowerCase().includes('depth') || d.message.toLowerCase().includes('maximum')
            );
            expect(depth_diagnostics.length).toBeGreaterThan(0);
        });
    });

    describe('cycle detection', () => {
        it('should detect cycle between backward and forward resolution', async () => {
            // Create a cycle: parent -> helper -> child (via forward call)
            // But child already has @lsp-done-by parent
            
            // Helper file that calls child
            const child_path_for_helper = path.join(temp_dir, 'child.do');
            const helper_content = `
global helper_global = "from helper"
do "${child_path_for_helper}"
`;
            const helper_path = create_file('helper.do', helper_content);

            // Parent file that calls helper before child
            const parent_content = `
global parent_global = 1
do "${helper_path}"
do "child.do"
`;
            const parent_path = create_file('parent.do', parent_content);

            // Child file with backward directive to parent
            const child_content = `// @lsp-done-by: "${parent_path}" match="child.do"
local child_var = 1
`;
            create_file('child.do', child_content);
            const child_uri = to_uri(child_path_for_helper);

            const result = await scope_resolver.resolve(child_uri, child_content);

            // Should have parent's global
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
            // Should have helper's global (before the cycle is detected)
            // Should handle cycle gracefully without infinite recursion
            expect(result.symbols.globalMacros.has('helper_global')).toBe(true);
            // Cycles are handled silently - no diagnostic expected
        });

        it('should handle self-referencing forward call in parent', async () => {
            // Parent file that calls itself (edge case)
            const parent_path_for_self = path.join(temp_dir, 'parent.do');
            const parent_content = `
global parent_global = 1
do "${parent_path_for_self}"
do "child.do"
`;
            create_file('parent.do', parent_content);

            // Child file
            const child_content = `// @lsp-done-by: "${parent_path_for_self}" match="child.do"
local child_var = 1
`;
            const child_path = create_file('child.do', child_content);
            const child_uri = to_uri(child_path);

            const result = await scope_resolver.resolve(child_uri, child_content);

            // Should have parent's global
            // Should handle self-referencing cycle gracefully
            expect(result.symbols.globalMacros.has('parent_global')).toBe(true);
            // Cycles are handled silently - no diagnostic expected
        });
    });
});
