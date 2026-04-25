#!/usr/bin/env bun
/**
 * Broken-link checker for Stata help pages.
 *
 * Enumerates every command in the v18 cache, resolves each to a
 * `.sthlp` file, renders it via `smcl_to_html()`, then validates:
 *   1. Every `data-smcl-topic` can be resolved to a `.sthlp` file
 *   2. Every `href="#anchor"` has a matching `<a id="anchor">` in
 *      the same page
 *   3. Every `data-smcl-anchor` has a matching `<a id="anchor">` in
 *      the resolved target page
 *
 * Requires a local Stata installation (uses `discover_stata_ado_paths`).
 *
 * Usage:
 *   bun scripts/check-help-links.ts [--ado-path /path/to/ado]
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { command_database } from '../src/command-database';
import type { CommandCache } from '../src/command-database/types';
import { WorkspaceIndexer } from '../src/indexer';
import { smcl_to_html } from '../client/src/smcl-preview/smcl-to-html';
import { expand_includes } from '../src/utils/include-expander';
import { extract_marker_names } from '../src/utils/marker-scanner';
import { discover_stata_ado_paths } from '../src/utils/stata-install-paths';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface BrokenLink {
    source_topic: string;
    link_type: 'topic' | 'same_page_anchor' | 'cross_page_anchor';
    target_topic: string;
    target_anchor: string;
    reason: string;
}

interface PageResult {
    topic: string;
    file_path: string;
    total_links: number;
    broken_links: BrokenLink[];
}

// -----------------------------------------------------------------------
// HTML link extraction (regex-based, sufficient for our controlled output)
// -----------------------------------------------------------------------

interface ExtractedLink {
    type: 'navigate' | 'same_page_anchor';
    topic: string;
    anchor: string;
}

function extract_links(html: string): ExtractedLink[] {
    const the_links: ExtractedLink[] = [];

    // Navigate links: data-smcl-topic="X" [data-smcl-anchor="Y"]
    const NAVIGATE_RE =
        /data-smcl-topic="([^"]*)"(?:\s+data-smcl-anchor="([^"]*)")?/g;
    let my_match: RegExpExecArray | null;
    while ((my_match = NAVIGATE_RE.exec(html)) !== null) {
        the_links.push({
            type: 'navigate',
            topic: my_match[1],
            anchor: my_match[2] || '',
        });
    }

    // Same-page anchor links: class="smcl-jumpto" ... href="#X"
    const JUMPTO_RE = /class="smcl-jumpto"[^>]*href="#([^"]*)"/g;
    while ((my_match = JUMPTO_RE.exec(html)) !== null) {
        the_links.push({
            type: 'same_page_anchor',
            topic: '',
            anchor: my_match[1],
        });
    }

    return the_links;
}

function extract_anchor_ids(html: string): Set<string> {
    const the_ids = new Set<string>();
    const ID_RE = /<a\s+id="([^"]*)"/g;
    let my_match: RegExpExecArray | null;
    while ((my_match = ID_RE.exec(html)) !== null) {
        the_ids.add(my_match[1]);
    }
    return the_ids;
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------

async function main(): Promise<void> {
    // Parse args
    const the_args = process.argv.slice(2);
    let explicit_ado_path: string | undefined;
    for (let i = 0; i < the_args.length; i++) {
        if (the_args[i] === '--ado-path' && the_args[i + 1]) {
            explicit_ado_path = the_args[i + 1];
            i++;
        }
    }

    // Discover ado paths
    const the_ado_paths = explicit_ado_path
        ? [explicit_ado_path]
        : discover_stata_ado_paths();

    if (the_ado_paths.length === 0) {
        console.error(
            'No Stata installation found. Use --ado-path to specify.'
        );
        process.exit(1);
    }
    console.log(`Using ado paths: ${the_ado_paths.join(', ')}`);

    // Load command cache
    const my_cache_path = path.join(
        __dirname,
        '../src/command-database/caches/v18.json'
    );
    const the_cache = JSON.parse(
        fs.readFileSync(my_cache_path, 'utf-8')
    ) as CommandCache;
    command_database.load_cache(the_cache);

    // Set up indexer
    const my_throwaway = fs.mkdtempSync(
        path.join(os.tmpdir(), 'sight-link-check-')
    );
    const my_indexer = new WorkspaceIndexer();
    await my_indexer.initialize([my_throwaway]);
    my_indexer.set_help_search_paths(the_ado_paths);

    // Enumerate topics
    const the_topics = command_database.get_all_command_names();
    console.log(`Checking ${the_topics.length} commands...\n`);

    // Cache of rendered pages: topic -> { html, anchor_ids }
    const the_page_cache = new Map<string, {
        html: string;
        anchor_ids: Set<string>;
    }>();

    // Resolver for INCLUDE expansion — uses the indexer
    const my_include_resolver = async (name: string) => {
        const my_path = await my_indexer.resolve_ihlp_file(name);
        if (!my_path) return null;
        try {
            const my_file_content = fs.readFileSync(my_path, 'utf-8');
            return { path: my_path, content: my_file_content };
        } catch {
            return null;
        }
    };

    // Resolve a topic with the same fallbacks as the LSP handler
    async function resolve_topic(topic: string): Promise<string | null> {
        const my_direct = await my_indexer.resolve_sthlp_file(topic);
        if (my_direct) return my_direct;

        // Function-name fallback: float() → f_float.sthlp
        if (topic.endsWith('()')) {
            const my_func_name = topic.slice(0, -2);
            if (my_func_name.length > 0) {
                const my_func_path = await my_indexer.resolve_sthlp_file(
                    `f_${my_func_name}`
                );
                if (my_func_path) return my_func_path;
            }
        }

        // System variable fallback: _N, _n, _pi, _rc → _variables
        if (topic.startsWith('_')) {
            const my_sysvar_path = await my_indexer.resolve_sthlp_file(
                '_variables'
            );
            if (my_sysvar_path) return my_sysvar_path;
        }

        // Hash-prefix fallback: #delimit → delimit.sthlp
        if (topic.startsWith('#')) {
            const my_stripped = topic.substring(1);
            if (my_stripped.length > 0) {
                const my_hash_path =
                    await my_indexer.resolve_sthlp_file(my_stripped);
                if (my_hash_path) return my_hash_path;
            }
        }

        // Hyphen-to-underscore fallback: stata-be → stata_be
        if (topic.includes('-')) {
            const my_underscore_topic = topic.replace(/-/g, '_');
            const my_hyphen_path =
                await my_indexer.resolve_sthlp_file(my_underscore_topic);
            if (my_hyphen_path) return my_hyphen_path;
        }

        // Case-insensitive fallback: Java → java, Dynamic → dynamic
        {
            const my_lower = topic.toLowerCase();
            if (my_lower !== topic) {
                const my_lower_path =
                    await my_indexer.resolve_sthlp_file(my_lower);
                if (my_lower_path) return my_lower_path;
            }
        }

        // Suffix-probing fallback: dynamic → dynamic_intro, etc.
        {
            const the_suffixes = [
                '_intro', '_commands', '_options', '_functions',
                '_estimation', '_styles', '_modes', '_postestimation',
            ];
            const the_bases = [topic];
            const my_lower = topic.toLowerCase();
            if (my_lower !== topic) the_bases.push(my_lower);
            for (const my_base of the_bases) {
                for (const my_suffix of the_suffixes) {
                    const my_candidate =
                        await my_indexer.resolve_sthlp_file(
                            my_base + my_suffix
                        );
                    if (my_candidate) return my_candidate;
                }
            }
        }

        return null;
    }

    // Render and cache a topic; returns null if unresolvable
    async function render_topic(
        topic: string
    ): Promise<{ html: string; anchor_ids: Set<string> } | null> {
        const my_cached = the_page_cache.get(topic);
        if (my_cached) return my_cached;

        const my_file_path = await resolve_topic(topic);
        if (!my_file_path) return null;

        const my_raw_content = fs.readFileSync(my_file_path, 'utf-8');
        const my_content = await expand_includes(
            my_raw_content, my_include_resolver
        );
        const my_result = smcl_to_html(my_content, {
            current_topic: topic,
        });
        const my_entry = {
            html: my_result.html,
            anchor_ids: extract_anchor_ids(my_result.html),
        };
        the_page_cache.set(topic, my_entry);
        return my_entry;
    }

    // Anchor fallback: check topic_* related files for a marker
    async function check_anchor_in_related_files(
        topic: string,
        anchor: string
    ): Promise<boolean> {
        const the_related =
            await my_indexer.find_related_sthlp_files(topic);
        for (const my_candidate_path of the_related) {
            try {
                const my_raw = fs.readFileSync(my_candidate_path, 'utf-8');
                const my_expanded = await expand_includes(
                    my_raw, my_include_resolver
                );
                const the_markers = extract_marker_names(my_expanded);
                if (the_markers.has(anchor)) return true;
            } catch {
                continue;
            }
        }
        return false;
    }

    // Phase 1: Render all pages
    const the_results: PageResult[] = [];
    let resolved_count = 0;
    let unresolved_count = 0;

    for (const my_topic of the_topics) {
        const my_file_path = await my_indexer.resolve_sthlp_file(my_topic);
        if (!my_file_path) {
            unresolved_count++;
            continue;
        }
        resolved_count++;

        const my_page = await render_topic(my_topic);
        if (!my_page) continue;

        const the_links = extract_links(my_page.html);
        const the_broken: BrokenLink[] = [];

        for (const my_link of the_links) {
            if (my_link.type === 'same_page_anchor') {
                // Validate same-page anchor
                if (!my_page.anchor_ids.has(my_link.anchor)) {
                    the_broken.push({
                        source_topic: my_topic,
                        link_type: 'same_page_anchor',
                        target_topic: my_topic,
                        target_anchor: my_link.anchor,
                        reason: `No <a id="${my_link.anchor}"> in page`,
                    });
                }
            } else if (my_link.type === 'navigate') {
                // Validate topic resolution
                const my_target = await render_topic(my_link.topic);
                if (!my_target) {
                    the_broken.push({
                        source_topic: my_topic,
                        link_type: 'topic',
                        target_topic: my_link.topic,
                        target_anchor: my_link.anchor,
                        reason: `Cannot resolve ${my_link.topic}.sthlp`,
                    });
                } else if (my_link.anchor) {
                    // Validate cross-page anchor — check primary file,
                    // then try topic_* related files (anchor fallback)
                    if (!my_target.anchor_ids.has(my_link.anchor)) {
                        const my_fallback_found =
                            await check_anchor_in_related_files(
                                my_link.topic, my_link.anchor
                            );
                        if (my_fallback_found) continue;
                        the_broken.push({
                            source_topic: my_topic,
                            link_type: 'cross_page_anchor',
                            target_topic: my_link.topic,
                            target_anchor: my_link.anchor,
                            reason: `No <a id="${my_link.anchor}"> in ${my_link.topic}`,
                        });
                    }
                }
            }
        }

        the_results.push({
            topic: my_topic,
            file_path: my_file_path,
            total_links: the_links.length,
            broken_links: the_broken,
        });
    }

    // Phase 2: Report
    const the_all_broken = the_results.flatMap(r => r.broken_links);
    const my_total_links = the_results.reduce(
        (sum, r) => sum + r.total_links, 0
    );

    console.log('=== Help Link Check Results ===\n');
    console.log(`Commands in cache:   ${the_topics.length}`);
    console.log(`Resolved to .sthlp:  ${resolved_count}`);
    console.log(`Unresolvable:        ${unresolved_count}`);
    console.log(`Total links checked: ${my_total_links}`);
    console.log(`Broken links:        ${the_all_broken.length}\n`);

    if (the_all_broken.length > 0) {
        // Group by source topic
        const the_by_source = new Map<string, BrokenLink[]>();
        for (const my_broken of the_all_broken) {
            const my_existing = the_by_source.get(my_broken.source_topic);
            if (my_existing) {
                my_existing.push(my_broken);
            } else {
                the_by_source.set(my_broken.source_topic, [my_broken]);
            }
        }

        for (const [my_source, my_links] of the_by_source) {
            console.log(`--- ${my_source} ---`);
            for (const my_link of my_links) {
                const my_target = my_link.target_anchor
                    ? `${my_link.target_topic}##${my_link.target_anchor}`
                    : my_link.target_topic;
                console.log(
                    `  [${my_link.link_type}] → ${my_target}: ${my_link.reason}`
                );
            }
            console.log('');
        }
    }

    // Cleanup
    fs.rmSync(my_throwaway, { recursive: true, force: true });

    if (the_all_broken.length > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(2);
});
