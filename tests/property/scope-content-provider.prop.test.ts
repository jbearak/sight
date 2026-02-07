import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import type { ContentProvider } from '../../src/types';

/**
 * Property tests for scope resolver content source selection.
 *
 * Property 12: Scope resolver uses in-memory content when open
 *
 * For any URI that is open in TextDocuments, the Scope_Resolver
 * content provider shall return the TextDocuments buffer contents
 * (not the Document_Store snapshot or disk), regardless of
 * whether parsing is debounced.
 *
 * **Validates: Requirements 11.1, 11.3**
 */
describe('Scope Content Provider Property Tests', () => {
    /**
     * Creates a content provider that mirrors the logic in
     * server-factory.ts: prefer TextDocuments buffer for open
     * files, fall back to disk content for closed files.
     *
     * @param open_documents - Map of URI → in-memory content
     *   (simulates TextDocuments.get(uri)?.getText())
     * @param disk_contents - Map of URI → on-disk content
     *   (simulates fs.promises.readFile)
     */
    function create_content_provider(
        open_documents: Map<string, string>,
        disk_contents: Map<string, string>
    ): ContentProvider {
        return {
            read_file: async (uri: string): Promise<string> => {
                // Prefer TextDocuments buffer for open files
                // (Req 11.1)
                const open_content = open_documents.get(uri);
                if (open_content !== undefined) {
                    return open_content;
                }
                // Fall back to disk for closed files (Req 11.2)
                const disk_content = disk_contents.get(uri);
                if (disk_content !== undefined) {
                    return disk_content;
                }
                throw new Error(
                    `File not found: ${uri}`
                );
            },
            exists: async (uri: string): Promise<boolean> => {
                // Prefer TextDocuments for open files
                if (open_documents.has(uri)) return true;
                return disk_contents.has(uri);
            },
        };
    }

    /**
     * Generator for a valid file URI string.
     */
    function arbitrary_file_uri(): fc.Arbitrary<string> {
        return fc
            .stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,15}$/)
            .map(
                (my_name) => `file:///workspace/${my_name}.do`
            );
    }

    /**
     * Generator for file content (non-empty Stata-like strings).
     */
    function arbitrary_content(): fc.Arbitrary<string> {
        return fc.oneof(
            fc.stringMatching(
                /^[a-zA-Z0-9_ \n]{1,50}$/
            ),
            fc.constantFrom(
                'display "hello"',
                'gen x = 1',
                'local myvar = 42',
                'global G_VAR "value"',
                'program define myprog\nend',
                '// comment line',
                'regress y x1 x2, robust'
            )
        );
    }

    /**
     * Generator for a set of open and closed file entries.
     * Each entry has a URI, in-memory content, and disk content.
     * Open files have both; closed files have only disk content.
     */
    function arbitrary_file_scenario(): fc.Arbitrary<{
        uri: string;
        is_open: boolean;
        memory_content: string;
        disk_content: string;
    }> {
        return fc.record({
            uri: arbitrary_file_uri(),
            is_open: fc.boolean(),
            memory_content: arbitrary_content(),
            disk_content: arbitrary_content(),
        });
    }

    /**
     * Property 12: Open files return TextDocuments content
     *
     * For any URI that is open in TextDocuments, the content
     * provider shall return the TextDocuments buffer contents,
     * not the disk content.
     *
     * **Validates: Requirements 11.1**
     */
    it('open files return TextDocuments content, not disk', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(arbitrary_file_scenario(), {
                    minLength: 1,
                    maxLength: 20,
                }),
                async (the_scenarios) => {
                    // Deduplicate by URI — last entry wins
                    const seen_uris = new Map<
                        string,
                        (typeof the_scenarios)[0]
                    >();
                    for (const my_scenario of the_scenarios) {
                        seen_uris.set(
                            my_scenario.uri,
                            my_scenario
                        );
                    }
                    const the_unique_scenarios = [
                        ...seen_uris.values(),
                    ];

                    // Build open_documents and disk_contents maps
                    const open_documents = new Map<
                        string,
                        string
                    >();
                    const disk_contents = new Map<
                        string,
                        string
                    >();

                    for (const my_scenario of the_unique_scenarios) {
                        // All files exist on disk
                        disk_contents.set(
                            my_scenario.uri,
                            my_scenario.disk_content
                        );
                        // Open files also have in-memory content
                        if (my_scenario.is_open) {
                            open_documents.set(
                                my_scenario.uri,
                                my_scenario.memory_content
                            );
                        }
                    }

                    const provider = create_content_provider(
                        open_documents,
                        disk_contents
                    );

                    // Verify each file returns the correct
                    // content source
                    for (const my_scenario of the_unique_scenarios) {
                        const my_result =
                            await provider.read_file(
                                my_scenario.uri
                            );

                        if (my_scenario.is_open) {
                            // Open files: must return in-memory
                            // content (Req 11.1)
                            expect(my_result).toBe(
                                my_scenario.memory_content
                            );
                        } else {
                            // Closed files: must return disk
                            // content (Req 11.2)
                            expect(my_result).toBe(
                                my_scenario.disk_content
                            );
                        }
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 12: In-memory content preferred even when
     * different from disk
     *
     * For any URI that is open, the content provider shall
     * return the TextDocuments buffer even when the disk content
     * differs (simulating unsaved edits or debounced parsing).
     *
     * **Validates: Requirements 11.1, 11.3**
     */
    it('in-memory content preferred even when different from disk', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_file_uri(),
                arbitrary_content(),
                arbitrary_content(),
                async (
                    my_uri,
                    my_memory_content,
                    my_disk_content
                ) => {
                    const open_documents = new Map<
                        string,
                        string
                    >([[my_uri, my_memory_content]]);
                    const disk_contents = new Map<
                        string,
                        string
                    >([[my_uri, my_disk_content]]);

                    const provider = create_content_provider(
                        open_documents,
                        disk_contents
                    );

                    const my_result =
                        await provider.read_file(my_uri);

                    // Must always return in-memory content for
                    // open files, regardless of disk content
                    expect(my_result).toBe(my_memory_content);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 12: Closed files fall back to disk content
     *
     * For any URI that is NOT open in TextDocuments, the content
     * provider shall return the disk content.
     *
     * **Validates: Requirements 11.1 (inverse)**
     */
    it('closed files return disk content', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_file_uri(),
                arbitrary_content(),
                async (my_uri, my_disk_content) => {
                    // No open documents — empty map
                    const open_documents = new Map<
                        string,
                        string
                    >();
                    const disk_contents = new Map<
                        string,
                        string
                    >([[my_uri, my_disk_content]]);

                    const provider = create_content_provider(
                        open_documents,
                        disk_contents
                    );

                    const my_result =
                        await provider.read_file(my_uri);

                    // Must return disk content for closed files
                    expect(my_result).toBe(my_disk_content);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 12: exists() reflects open documents
     *
     * For any URI that is open in TextDocuments, exists() shall
     * return true even if the file does not exist on disk.
     *
     * **Validates: Requirements 11.1**
     */
    it('exists returns true for open files even without disk', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_file_uri(),
                arbitrary_content(),
                async (my_uri, my_memory_content) => {
                    // File is open but NOT on disk
                    const open_documents = new Map<
                        string,
                        string
                    >([[my_uri, my_memory_content]]);
                    const disk_contents = new Map<
                        string,
                        string
                    >();

                    const provider = create_content_provider(
                        open_documents,
                        disk_contents
                    );

                    const my_exists =
                        await provider.exists(my_uri);
                    expect(my_exists).toBe(true);

                    // And read_file returns the in-memory content
                    const my_result =
                        await provider.read_file(my_uri);
                    expect(my_result).toBe(my_memory_content);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 12: Debounced state does not affect content
     * source selection
     *
     * For any URI that is open, even when the in-memory content
     * has been updated (simulating a new edit before debounce
     * fires), the content provider shall return the latest
     * TextDocuments content.
     *
     * This validates Req 11.3: when parsing is debounced, the
     * content provider still returns the most recent
     * TextDocuments content.
     *
     * **Validates: Requirements 11.3**
     */
    it('returns latest TextDocuments content even during debounce', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_file_uri(),
                arbitrary_content(),
                arbitrary_content(),
                arbitrary_content(),
                async (
                    my_uri,
                    my_initial_content,
                    my_updated_content,
                    my_disk_content
                ) => {
                    // Simulate: file is open with initial content
                    const open_documents = new Map<
                        string,
                        string
                    >([[my_uri, my_initial_content]]);
                    const disk_contents = new Map<
                        string,
                        string
                    >([[my_uri, my_disk_content]]);

                    const provider = create_content_provider(
                        open_documents,
                        disk_contents
                    );

                    // First read: returns initial in-memory
                    // content
                    const my_first_result =
                        await provider.read_file(my_uri);
                    expect(my_first_result).toBe(
                        my_initial_content
                    );

                    // Simulate: user types more (TextDocuments
                    // updates synchronously, but debounce hasn't
                    // fired yet)
                    open_documents.set(
                        my_uri,
                        my_updated_content
                    );

                    // Second read: returns updated in-memory
                    // content (Req 11.3 — debounce doesn't
                    // affect content source)
                    const my_second_result =
                        await provider.read_file(my_uri);
                    expect(my_second_result).toBe(
                        my_updated_content
                    );
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 12: Mixed open and closed files in same request
     *
     * For any mix of open and closed URIs, the content provider
     * shall return in-memory content for open files and disk
     * content for closed files, with no cross-contamination.
     *
     * **Validates: Requirements 11.1, 11.3**
     */
    it('mixed open and closed files return correct sources', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(arbitrary_file_scenario(), {
                    minLength: 2,
                    maxLength: 15,
                }),
                fc.boolean(),
                async (the_scenarios, _force_mix) => {
                    // Deduplicate by URI
                    const seen_uris = new Map<
                        string,
                        (typeof the_scenarios)[0]
                    >();
                    for (const my_scenario of the_scenarios) {
                        seen_uris.set(
                            my_scenario.uri,
                            my_scenario
                        );
                    }
                    const the_unique = [
                        ...seen_uris.values(),
                    ];

                    // Ensure we have at least one open and one
                    // closed for a meaningful test
                    const has_open = the_unique.some(
                        (s) => s.is_open
                    );
                    const has_closed = the_unique.some(
                        (s) => !s.is_open
                    );
                    if (!has_open || !has_closed) {
                        // Force the first to be open and last
                        // to be closed
                        if (the_unique.length >= 2) {
                            the_unique[0].is_open = true;
                            the_unique[
                                the_unique.length - 1
                            ].is_open = false;
                        } else {
                            return; // Skip if only 1 unique URI
                        }
                    }

                    const open_documents = new Map<
                        string,
                        string
                    >();
                    const disk_contents = new Map<
                        string,
                        string
                    >();

                    for (const my_scenario of the_unique) {
                        disk_contents.set(
                            my_scenario.uri,
                            my_scenario.disk_content
                        );
                        if (my_scenario.is_open) {
                            open_documents.set(
                                my_scenario.uri,
                                my_scenario.memory_content
                            );
                        }
                    }

                    const provider = create_content_provider(
                        open_documents,
                        disk_contents
                    );

                    // Verify each file independently
                    for (const my_scenario of the_unique) {
                        const my_result =
                            await provider.read_file(
                                my_scenario.uri
                            );
                        const my_exists =
                            await provider.exists(
                                my_scenario.uri
                            );

                        expect(my_exists).toBe(true);

                        if (my_scenario.is_open) {
                            expect(my_result).toBe(
                                my_scenario.memory_content
                            );
                        } else {
                            expect(my_result).toBe(
                                my_scenario.disk_content
                            );
                        }
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});
