export * from './types';
export * from './lexer';
export * from './parser';
export * from './analyzer';
export * from './document-store';
export * from './providers/completion';
export * from './providers/diagnostics';
export * from './providers/hover';
export * from './providers/definition';
export * from './providers/references';
export * from './providers/symbols';
export * from './providers/formatter';
export { CommandDatabase, command_database } from './command-database';
export { ForwardScopeResolver } from './forward-scope-resolver';
export type { ForwardScopeConfig } from './forward-scope-resolver';
export {
    ScopeResolver,
    build_scope_resolver_config,
    scope_resolver_config_for,
} from './scope-resolver';
export { DependencyGraph } from './dependency-graph';
export type { AutoBackwardEdge, GraphUpdateResult } from './dependency-graph';

// CLI and server factory exports
export * from './cli';
export { create_server } from './server-factory';
export type { ServerOptions } from './server-factory';
