/**
 * LRU (Least Recently Used) Cache implementation
 *
 * Generic cache with bounded size and LRU eviction policy.
 * Tracks hits, misses, and evictions for monitoring.
 */

/**
 * Generic LRU Cache interface
 */
export interface ILRUCache<K, V> {
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    has(key: K): boolean;
    clear(): void;
    size(): number;
    get_stats(): { hits: number; misses: number; evictions: number };
}

/**
 * Cache entry with generation tracking for generational eviction.
 */
interface CacheEntry<V> {
    value: V;
    generation: number;
    access_count: number;
}

/**
 * Generic LRU Cache implementation with generational eviction.
 *
 * Maintains insertion order for LRU eviction. When capacity is reached,
 * evicts entries from older generations first, then by access count.
 */
export class LRUCache<K, V> implements ILRUCache<K, V> {
    private cache: Map<K, CacheEntry<V>> = new Map();
    private max_size: number;
    private hits: number = 0;
    private misses: number = 0;
    private evictions: number = 0;
    private current_generation: number = 0;

    constructor(max_size: number = 100) {
        this.max_size = max_size;
    }

    /**
     * Get a value from the cache.
     * Marks the item as recently used by moving it to the end.
     */
    get(key: K): V | undefined {
        const entry = this.cache.get(key);
        if (entry !== undefined) {
            this.hits++;
            entry.access_count++;
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, entry);
            return entry.value;
        } else {
            this.misses++;
        }
        return undefined;
    }

    /**
     * Set a value in the cache.
     * If key exists, updates it and marks as recently used.
     * If cache is at capacity, evicts using generational policy.
     */
    set(key: K, value: V): void {
        // Remove if exists to update position
        this.cache.delete(key);

        // Evict if at capacity
        if (this.cache.size >= this.max_size) {
            this.evict_one();
        }

        this.cache.set(key, {
            value,
            generation: this.current_generation,
            access_count: 1
        });
    }

    /**
     * Evict one entry using generational policy.
     * Prefers older generations, then lower access counts.
     */
    private evict_one(): void {
        let victim_key: K | undefined;
        let victim_score = Infinity;
        
        for (const [key, entry] of this.cache) {
            // Score: lower is more evictable
            // Older generations (lower number) are more evictable
            // Lower access counts are more evictable
            const score = entry.generation * 1000 + entry.access_count;
            if (score < victim_score) {
                victim_score = score;
                victim_key = key;
            }
        }
        
        if (victim_key !== undefined) {
            this.cache.delete(victim_key);
            this.evictions++;
        }
    }

    /**
     * Advance to next generation.
     * Call periodically (e.g., on workspace changes) to age out old entries.
     */
    advance_generation(): void {
        this.current_generation++;
    }

    /**
     * Trim cache to top-N entries by access count.
     * Useful for aggressive memory reduction.
     */
    trim_to_top_n(n: number): void {
        if (this.cache.size <= n) return;
        
        // Sort entries by access count (descending)
        const entries = Array.from(this.cache.entries())
            .sort((a, b) => b[1].access_count - a[1].access_count);
        
        // Keep top N
        this.cache.clear();
        for (let i = 0; i < Math.min(n, entries.length); i++) {
            this.cache.set(entries[i][0], entries[i][1]);
        }
        
        this.evictions += entries.length - n;
    }

    /**
     * Check if a key exists in the cache.
     */
    has(key: K): boolean {
        return this.cache.has(key);
    }

    /**
     * Clear all items from the cache.
     * Preserves stats for monitoring.
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Get the current number of items in the cache.
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * Get cache statistics (hits, misses, evictions).
     */
    get_stats(): { hits: number; misses: number; evictions: number } {
        return { hits: this.hits, misses: this.misses, evictions: this.evictions };
    }
}

/**
 * Completion Prefix Cache
 *
 * Specialized LRU cache for completion prefix lookups.
 * Keys are context-aware (prefix + context + versions) to avoid collisions
 * across Mata/Stata/Python scopes and ensure cache invalidation.
 *
 * Features:
 * - Generational eviction: older entries evicted first
 * - Top-N trimming: aggressive memory reduction when needed
 * - Version-based invalidation for db/workspace changes
 *
 * Cache invalidation triggers:
 * - Command database changes (built-in commands updated)
 * - Ado path changes (user config update)
 * - Workspace symbol version change (new .ado files indexed)
 * - Document version change (document symbols updated)
 */
export class CompletionPrefixCache<TItem = unknown> {
    private cache: LRUCache<string, TItem[]>;
    private command_db_version: number = 0;
    private workspace_version: number = 0;
    private readonly top_n_threshold: number;

    constructor(max_size: number = 100, top_n_threshold: number = 200) {
        this.cache = new LRUCache(max_size);
        this.top_n_threshold = top_n_threshold;
    }

    /**
     * Generate a cache key from prefix, context, and versions.
     * Format: "context:prefix:cmd_v:ws_v:doc_v"
     */
    private make_key(
        prefix: string,
        context: string,
        document_version: number = 0
    ): string {
        return `${context}:${prefix}:${this.command_db_version}:${this.workspace_version}:${document_version}`;
    }

    /**
     * Get cached completions for a prefix in a specific context.
     */
    get_with_context(
        prefix: string,
        context: string,
        document_version: number = 0
    ): TItem[] | undefined {
        return this.cache.get(this.make_key(prefix, context, document_version));
    }

    /**
     * Set cached completions for a prefix in a specific context.
     */
    set_with_context(
        prefix: string,
        context: string,
        value: TItem[],
        document_version: number = 0
    ): TItem[] {
        const trimmed_value = this.apply_limit(value);
        this.cache.set(this.make_key(prefix, context, document_version), trimmed_value);
        return trimmed_value;
    }

    /**
     * Apply the top-N limit to a completion list.
     */
    apply_limit<T>(value: T[]): T[] {
        if (this.top_n_threshold > 0 && value.length > this.top_n_threshold) {
            return value.slice(0, this.top_n_threshold);
        }
        return value;
    }

    /**
     * Check if a prefix is cached in a specific context.
     */
    has_with_context(
        prefix: string, 
        context: string, 
        document_version: number = 0
    ): boolean {
        return this.cache.has(this.make_key(prefix, context, document_version));
    }

    /**
     * Call when command database or ado paths change.
     * Clears the cache since old entries have stale version keys.
     */
    invalidate_on_db_change(new_version: number): void {
        if (new_version !== this.command_db_version) {
            this.command_db_version = new_version;
            // Clear cache - old entries have stale version in their keys
            this.cache.clear();
            this.cache.advance_generation();
        }
    }

    /**
     * Call when workspace symbols change.
     * Clears the cache since old entries have stale version keys.
     */
    invalidate_on_workspace_change(new_version: number): void {
        if (new_version !== this.workspace_version) {
            this.workspace_version = new_version;
            // Clear cache - old entries have stale version in their keys
            this.cache.clear();
            this.cache.advance_generation();
        }
    }

    /**
     * Clear all cached completions.
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Get the current number of cached entries.
     */
    size(): number {
        return this.cache.size();
    }

    /**
     * Get cache statistics (hits, misses, evictions).
     */
    get_stats(): { hits: number; misses: number; evictions: number } {
        return this.cache.get_stats();
    }
}
