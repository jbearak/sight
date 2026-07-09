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
 * Options for BoundedLruMap.
 */
export interface BoundedLruMapOptions<K, V> {
    /**
     * Called synchronously for CAPACITY evictions only (a set() of a new
     * key at capacity, or a set_max_size() shrink) — never for explicit
     * delete()/clear(). Must be synchronous and must not re-enter this
     * map: callers rely on eviction side effects completing before
     * set()/set_max_size() return (e.g. secondary-index pruning read back
     * immediately after a set()).
     */
    on_evict?: (key: K, value: V) => void;
}

/**
 * Strict recency-LRU map with bounded capacity (issue #294).
 *
 * Unlike LRUCache above (generational scoring, O(n) eviction scan), this
 * is a plain recency LRU over Map insertion order with O(1) eviction,
 * plus an eviction callback for secondary-index cleanup. Used to bound
 * the long-lived cross-file caches (ScopeResolver.file_cache /
 * scope_cache, ForwardScopeResolver.forward_closure_memo).
 *
 * Recency contract: get() and touch() promote; peek()/has() and all
 * iteration are recency-neutral, so validation/invalidation scans never
 * perturb eviction order.
 */
export class BoundedLruMap<K, V> {
    private map: Map<K, V> = new Map();
    private max_size: number;
    private readonly on_evict?: (key: K, value: V) => void;

    constructor(max_size: number, options?: BoundedLruMapOptions<K, V>) {
        this.max_size = Math.max(1, Math.floor(max_size));
        this.on_evict = options?.on_evict;
    }

    /** Cache read that promotes the key to most-recently-used. */
    get(key: K): V | undefined {
        if (!this.map.has(key)) {
            return undefined;
        }
        const value = this.map.get(key) as V;
        this.map.delete(key);
        this.map.set(key, value);
        return value;
    }

    /** Recency-neutral read (probes, validation scans, bookkeeping). */
    peek(key: K): V | undefined {
        return this.map.get(key);
    }

    /** Recency-neutral membership check. */
    has(key: K): boolean {
        return this.map.has(key);
    }

    /**
     * Promote an existing key to most-recently-used without reading it.
     * Use after a peek() once the peeked entry is actually served.
     * No-op for absent keys.
     */
    touch(key: K): void {
        if (!this.map.has(key)) {
            return;
        }
        const value = this.map.get(key) as V;
        this.map.delete(key);
        this.map.set(key, value);
    }

    /**
     * Insert or update; promotes to most-recently-used. Inserting a NEW
     * key at capacity first evicts the least-recently-used entry and
     * fires on_evict for it. Updating an existing key never evicts.
     */
    set(key: K, value: V): this {
        if (this.map.has(key)) {
            this.map.delete(key);
        } else if (this.map.size >= this.max_size) {
            this.evict_oldest();
        }
        this.map.set(key, value);
        return this;
    }

    /** Explicit removal — never fires on_evict. */
    delete(key: K): boolean {
        return this.map.delete(key);
    }

    /** Explicit bulk removal — never fires on_evict. */
    clear(): void {
        this.map.clear();
    }

    get size(): number {
        return this.map.size;
    }

    get capacity(): number {
        return this.max_size;
    }

    /**
     * Change the capacity at runtime. Shrinking below the current size
     * evicts LRU-first down to the new capacity, firing on_evict per
     * evicted entry; growing only updates the limit.
     */
    set_max_size(new_max_size: number): void {
        this.max_size = Math.max(1, Math.floor(new_max_size));
        while (this.map.size > this.max_size) {
            this.evict_oldest();
        }
    }

    /** Recency-neutral iteration in LRU-first order. */
    keys(): IterableIterator<K> {
        return this.map.keys();
    }

    values(): IterableIterator<V> {
        return this.map.values();
    }

    entries(): IterableIterator<[K, V]> {
        return this.map.entries();
    }

    [Symbol.iterator](): IterableIterator<[K, V]> {
        return this.map[Symbol.iterator]();
    }

    private evict_oldest(): void {
        const oldest = this.map.keys().next();
        if (oldest.done) {
            return;
        }
        const oldest_key = oldest.value;
        const oldest_value = this.map.get(oldest_key) as V;
        this.map.delete(oldest_key);
        this.on_evict?.(oldest_key, oldest_value);
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
