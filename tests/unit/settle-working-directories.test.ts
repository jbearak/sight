/**
 * The rules `settle_inherited_working_directories` adds to the backward
 * walk it is given: when the rounds end, and which files it walks.
 * The walk here is a stand-in, so each rule is tested on its own.
 */

import { describe, expect, it } from 'bun:test';
import {
    settle_inherited_working_directories,
    type WorkingDirectoryFacts,
} from '../../src/indexer/settle-working-directories';
import type { WorkingDirectoryProbeResult } from '../../src/scope-resolver';
import type { ForwardCall } from '../../src/types';

const DIRECTORY = '/workspace/work';
const OWNER_URI = 'file:///workspace/owner.do';
const CHILD_URI = 'file:///workspace/child.do';

function call_from(caller_uri: string, working_directory: string): ForwardCall {
    const range = {
        start: { line: 1, character: 0 }, end: { line: 1, character: 10 },
    };
    return {
        type: 'do', raw_path: 'child.do', call_site_line: 1, range,
        source: 'command', is_static: true, caller_uri, working_directory,
    };
}

function facts(
    uri: string, own_working_directory: string | undefined,
): WorkingDirectoryFacts {
    return {
        uri,
        own_working_directory,
        directive_working_directory: own_working_directory,
        is_standalone: false,
        has_backward_directives: false,
        explicit_parents: [],
        working_directory: own_working_directory,
        first_calls: new Map(),
        cd_commands: [],
    };
}

/** An owner of `DIRECTORY` that calls a child with no directory. */
function owner_and_child(): WorkingDirectoryFacts[] {
    const owner = facts(OWNER_URI, DIRECTORY);
    owner.first_calls.set(CHILD_URI, call_from(OWNER_URI, DIRECTORY));
    return [facts(CHILD_URI, undefined), owner];
}

const FOUND: WorkingDirectoryProbeResult = {
    kind: 'found', directory: DIRECTORY, chain: [OWNER_URI],
};

describe('settle_inherited_working_directories', () => {
    it('gives a file the directory the walk finds and registers it again', async () => {
        const the_facts = owner_and_child();
        const the_registered: string[] = [];
        const settled = await settle_inherited_working_directories({
            the_facts,
            auto_parents: true,
            workspace_roots: ['/workspace'],
            probe: async () => FOUND,
            register: (my_facts) => the_registered.push(my_facts.uri),
        });
        expect(the_facts[0]?.working_directory).toBe(DIRECTORY);
        expect(the_registered).toEqual([CHILD_URI]);
        expect(settled.walk_directories.get(CHILD_URI)).toBe(DIRECTORY);
        expect(settled.unknown.size).toBe(0);
    });

    it('leaves a file whose registrations alternate without settling', async () => {
        // The walk finds a directory only while the file has none, as
        // in a cycle of callers whose calls resolve only when settled.
        const the_facts = owner_and_child();
        const child = the_facts[0];
        let probes = 0;
        const settled = await settle_inherited_working_directories({
            the_facts,
            auto_parents: true,
            workspace_roots: ['/workspace'],
            probe: async () => {
                probes++;
                return child?.working_directory === undefined
                    ? FOUND : { kind: 'none' };
            },
            register: () => undefined,
        });
        expect(probes).toBeLessThan(10);
        expect(child?.working_directory).toBeUndefined();
        expect(settled.unknown).toEqual(new Set([CHILD_URI]));
    });

    it('does not walk again a file whose walk was given up', async () => {
        const the_facts = owner_and_child();
        // A second file below the first, so there is a second round.
        const grandchild = facts('file:///workspace/grandchild.do', undefined);
        the_facts[0]?.first_calls.set(
            grandchild.uri, call_from(CHILD_URI, DIRECTORY));
        the_facts.push(grandchild);
        // A sibling that settles, so there is a second round.
        const sibling = facts('file:///workspace/sibling.do', undefined);
        the_facts[1]?.first_calls.set(
            sibling.uri, call_from(OWNER_URI, DIRECTORY));
        the_facts.push(sibling);
        const the_probed: string[] = [];
        const settled = await settle_inherited_working_directories({
            the_facts,
            auto_parents: true,
            workspace_roots: ['/workspace'],
            probe: async (my_facts) => {
                the_probed.push(my_facts.uri);
                if (my_facts.uri === CHILD_URI) {
                    return { kind: 'exhausted' };
                }
                return my_facts.uri === sibling.uri ? FOUND : {
                    kind: 'found', directory: DIRECTORY,
                    chain: [CHILD_URI, OWNER_URI],
                };
            },
            register: () => undefined,
        });
        expect(the_probed.filter(my_uri => my_uri === sibling.uri))
            .toHaveLength(2);
        expect(the_probed.filter(my_uri => my_uri === CHILD_URI))
            .toHaveLength(1);
        expect(settled.unknown).toEqual(new Set([CHILD_URI]));
        // The file below it inherits nothing through an unsettled file.
        expect(grandchild.working_directory).toBeUndefined();
        expect(settled.walk_directories.get(grandchild.uri)).toBe(DIRECTORY);
    });

    it('does not walk a file no `sight: cd` reaches', async () => {
        const the_facts = [
            ...owner_and_child(),
            facts('file:///workspace/unrelated.do', undefined),
        ];
        const the_probed: string[] = [];
        await settle_inherited_working_directories({
            the_facts,
            auto_parents: true,
            workspace_roots: ['/workspace'],
            probe: async (my_facts) => {
                the_probed.push(my_facts.uri);
                return FOUND;
            },
            register: () => undefined,
        });
        expect(the_probed).not.toContain('file:///workspace/unrelated.do');
    });

    it('passes no directory on through a call made after a literal `cd`', async () => {
        const the_facts = owner_and_child();
        the_facts[1]?.first_calls.set(
            CHILD_URI, call_from(OWNER_URI, '/workspace/elsewhere'));
        const settled = await settle_inherited_working_directories({
            the_facts,
            auto_parents: true,
            workspace_roots: ['/workspace'],
            probe: async () => FOUND,
            register: () => undefined,
        });
        expect(the_facts[0]?.working_directory).toBeUndefined();
        // The walk's directory is still reported, for showing the file.
        expect(settled.walk_directories.get(CHILD_URI)).toBe(DIRECTORY);
    });
});
