import { describe, expect, it } from 'bun:test';
import {
    create_completion_handler,
    create_definition_handler,
    create_hover_handler,
    create_references_handler,
    DEFAULT_SETTINGS,
    type HandlerDependencies,
} from '../../src/server-handlers';
import { DocumentStore } from '../../src/document-store';
import type { ScopeResolverConfig, StataLSPConfig } from '../../src/types';

type CapturedScopeConfigs = {
    completion?: Partial<ScopeResolverConfig>;
    hover?: Partial<ScopeResolverConfig>;
    definition?: Partial<ScopeResolverConfig>;
    references?: Partial<ScopeResolverConfig>;
};

const TEST_SCOPE_CONFIG: Partial<ScopeResolverConfig> = {
    assume_call_site: 'start',
    backward_dependencies: 'explicit',
    max_backward_depth: 3,
    max_forward_depth: 4,
    max_chain_depth: 7,
};

function create_test_config(): StataLSPConfig {
    return {
        ...DEFAULT_SETTINGS,
        cross_file: {
            ...DEFAULT_SETTINGS.cross_file,
            ...TEST_SCOPE_CONFIG,
        },
    };
}

function create_capture_deps(
    captured_configs: CapturedScopeConfigs
): HandlerDependencies {
    const document_store = new DocumentStore();

    return {
        debounce_manager: null,
        document_store,
        diagnostics_provider: null,
        completion_provider: {
            get_completions: async (...the_args) => {
                captured_configs.completion = the_args[5];
                return [];
            },
        } as NonNullable<HandlerDependencies['completion_provider']>,
        hover_provider: {
            get_hover: async (...the_args) => {
                captured_configs.hover = the_args[4];
                return null;
            },
        } as NonNullable<HandlerDependencies['hover_provider']>,
        definition_provider: {
            get_definition: async (...the_args) => {
                captured_configs.definition = the_args[6];
                return null;
            },
        } as NonNullable<HandlerDependencies['definition_provider']>,
        references_provider: {
            get_references: async (...the_args) => {
                captured_configs.references = the_args[6];
                return [];
            },
        } as NonNullable<HandlerDependencies['references_provider']>,
        symbol_provider: null,
        formatter_provider: null,
        workspace_indexer: null,
        scope_resolver: null,
        forward_scope_resolver: null,
        dependency_graph: null,
        rename_handler: null,
        get_document_settings: async () => create_test_config(),
        connection: {
            sendDiagnostics: () => {},
            console: { log: () => {} },
        },
    };
}

async function open_test_document(
    document_store: DocumentStore,
    uri: string
): Promise<void> {
    await document_store.open(uri, 'display 1\n', 1);
}

function expect_scope_config_forwarded(
    config: Partial<ScopeResolverConfig> | undefined
): void {
    expect(config).toMatchObject(TEST_SCOPE_CONFIG);
}

describe('server handler scope resolver config routing', () => {
    it('forwards configured depth limits to cross-file-aware providers', async () => {
        const captured_configs: CapturedScopeConfigs = {};
        const deps = create_capture_deps(captured_configs);
        const my_uri = 'file:///scope-config-routing.do';
        const position = { line: 0, character: 0 };

        await open_test_document(deps.document_store, my_uri);

        await create_completion_handler(deps)(
            { textDocument: { uri: my_uri }, position },
            undefined
        );
        await create_hover_handler(deps)(
            { textDocument: { uri: my_uri }, position },
            undefined
        );
        await create_definition_handler(deps)(
            { textDocument: { uri: my_uri }, position },
            undefined
        );
        await create_references_handler(deps)(
            {
                textDocument: { uri: my_uri },
                position,
                context: { includeDeclaration: true },
            },
            undefined
        );

        expect_scope_config_forwarded(captured_configs.completion);
        expect_scope_config_forwarded(captured_configs.hover);
        expect_scope_config_forwarded(captured_configs.definition);
        expect_scope_config_forwarded(captured_configs.references);
    });
});
