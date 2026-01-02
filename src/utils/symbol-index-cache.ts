/**
 * Symbol Index Cache for LSP Performance Optimization
 * 
 * Maintains pre-filtered symbol views per document URI to avoid
 * rebuilding Maps on every completion request.
 */

import { SymbolTable } from '../types';

interface FilteredSymbolView {
    symbols: SymbolTable;
    workspace_version: number;
    document_version: number;
}

/**
 * Cache for filtered workspace symbols per document URI.
 * Avoids O(N) filtering operations on every completion request.
 */
export class SymbolIndexCache {
    private filtered_views = new Map<string, FilteredSymbolView>();
    private workspace_version = 0;

    /**
     * Get filtered workspace symbols for a document URI.
     * Returns cached view if versions match, otherwise rebuilds and caches.
     */
    get_filtered_symbols(
        workspace_symbols: SymbolTable,
        document_uri: string,
        document_version: number
    ): SymbolTable {
        const cached = this.filtered_views.get(document_uri);
        
        if (cached && 
            cached.workspace_version === this.workspace_version &&
            cached.document_version === document_version) {
            return cached.symbols;
        }

        // Rebuild filtered view
        const filtered = this.filter_symbols_by_uri(workspace_symbols, document_uri);
        
        this.filtered_views.set(document_uri, {
            symbols: filtered,
            workspace_version: this.workspace_version,
            document_version
        });

        return filtered;
    }

    /**
     * Invalidate cache when workspace symbols change.
     */
    invalidate_workspace(new_version: number): void {
        if (new_version !== this.workspace_version) {
            this.workspace_version = new_version;
            this.filtered_views.clear();
        }
    }

    /**
     * Invalidate cache for specific document.
     */
    invalidate_document(document_uri: string): void {
        this.filtered_views.delete(document_uri);
    }

    /**
     * Filter workspace symbols to exclude those from a specific URI.
     */
    private filter_symbols_by_uri(symbols: SymbolTable, uri_to_exclude: string): SymbolTable {
        return {
            programs: this.filter_map_by_uri(symbols.programs, uri_to_exclude),
            localMacros: this.filter_map_by_uri(symbols.localMacros, uri_to_exclude),
            globalMacros: this.filter_map_by_uri(symbols.globalMacros, uri_to_exclude),
            variables: this.filter_map_by_uri(symbols.variables, uri_to_exclude),
            scalars: this.filter_map_by_uri(symbols.scalars, uri_to_exclude),
            matrices: this.filter_map_by_uri(symbols.matrices, uri_to_exclude),
        };
    }

    private filter_map_by_uri<T extends { sourceUri: string }>(
        map: Map<string, T>, 
        uri_to_exclude: string
    ): Map<string, T> {
        const filtered = new Map<string, T>();
        
        if (!map || typeof map.entries !== 'function') {
            return filtered;
        }
        
        const entries = map instanceof Map ? map.entries() : Object.entries(map);
        
        for (const [key, value] of entries) {
            if (value && (value as T).sourceUri !== uri_to_exclude) {
                filtered.set(key, value as T);
            }
        }
        return filtered;
    }
}
