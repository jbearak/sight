/**
 * Issue #209 — forward-closure memo plumbing (gate + toggle).
 *
 * The cache STORE/SERVE write-path is deferred to a follow-up; this PR ships the
 * toggle and the caller-independent key contract that the follow-up implements.
 * The key must capture every input that varies a file's forward closure and
 * NOTHING about the calling file's identity (the #208 caller-independence
 * assumption). See docs/cross-file.md "Forward-closure caching semantics".
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { build_forward_closure_key } from '../../src/forward-scope-resolver';
import type { ForwardClosureKeyInputs } from '../../src/forward-scope-resolver';
import { create_test_scope_resolver_logger } from '../test-logger';

describe('forward-closure memo toggle', () => {
    let forward_resolver: ForwardScopeResolver;
    beforeEach(() => {
        const scope_resolver = new ScopeResolver(
            create_test_scope_resolver_logger());
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
    });

    it('is disabled by default (write-path deferred)', () => {
        expect(forward_resolver.is_forward_closure_memo_enabled()).toBe(false);
    });

    it('reflects the toggle', () => {
        forward_resolver.set_forward_closure_memo_enabled(true);
        expect(forward_resolver.is_forward_closure_memo_enabled()).toBe(true);
        forward_resolver.set_forward_closure_memo_enabled(false);
        expect(forward_resolver.is_forward_closure_memo_enabled()).toBe(false);
    });
});

describe('forward-closure cache key (caller-independent)', () => {
    const base: ForwardClosureKeyInputs = {
        callee_uri: 'file:///ws/hub.do',
        content_hash: 'abc123',
        effective_call_type: 'do',
        working_directory: '/ws',
        depth: 0,
        max_forward_depth: 10,
        dep_graph_version: 7,
    };

    it('is stable for identical inputs', () => {
        expect(build_forward_closure_key(base))
            .toBe(build_forward_closure_key({ ...base }));
    });

    it('does not depend on caller identity (no caller field exists)', () => {
        // The key is built solely from the callee + its resolution context.
        // There is no caller parameter to pass — caller-independence by
        // construction. The string must NOT contain any caller marker.
        const key = build_forward_closure_key(base);
        expect(key).toContain('file:///ws/hub.do');
        expect(key).not.toContain('caller');
    });

    // Each keyed input must change the key (codex rounds 2-5: all of these vary
    // the closure and must force a cache miss).
    const variations: Array<[string, Partial<ForwardClosureKeyInputs>]> = [
        ['content_hash', { content_hash: 'def456' }],
        ['effective_call_type', { effective_call_type: 'include' }],
        ['working_directory', { working_directory: '/other' }],
        ['depth', { depth: 1 }],
        ['max_forward_depth', { max_forward_depth: 5 }],
        ['dep_graph_version', { dep_graph_version: 8 }],
    ];
    for (const [name, override] of variations) {
        it(`changes when ${name} changes`, () => {
            expect(build_forward_closure_key({ ...base, ...override }))
                .not.toBe(build_forward_closure_key(base));
        });
    }

    it('keeps undefined working directory distinct from empty string', () => {
        // An absent WD and an empty-string WD are different resolution contexts
        // and must not collide in the key (codex review: delimiter/undefined
        // ambiguity).
        const none = build_forward_closure_key(
            { ...base, working_directory: undefined });
        const empty = build_forward_closure_key(
            { ...base, working_directory: '' });
        expect(none).not.toBe(empty);
        // ...but undefined is stable against itself.
        expect(none).toBe(build_forward_closure_key(
            { ...base, working_directory: undefined }));
    });

    it('cannot be forged by a value containing the delimiter syntax', () => {
        // A callee_uri that literally contains another field's serialization
        // must not collide with a genuinely different input set.
        const sneaky = build_forward_closure_key({
            ...base,
            callee_uri: 'file:///ws/hub.do","abc123","do',
        });
        expect(sneaky).not.toBe(build_forward_closure_key(base));
    });
});
