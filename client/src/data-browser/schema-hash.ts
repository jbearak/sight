/**
 * FNV-1a-32 fingerprint of a dataset's shape.
 *
 * Hashes "name type" of each column in declaration order. Used to key
 * persisted sort/filter state so that a different shape opened at the
 * same path (e.g. a re-View with a different varlist) gets its own
 * slot rather than restoring a sort/filter that references columns
 * that no longer line up.
 */
export function schema_hash(
    columns: readonly { name: string; type: string }[]
): string {
    let my_hash = 0x811c9dc5;
    const my_text = columns
        .map(my_col => `${my_col.name} ${my_col.type}`)
        .join('');
    for (let i = 0; i < my_text.length; i++) {
        my_hash ^= my_text.charCodeAt(i);
        my_hash = Math.imul(my_hash, 0x01000193);
    }
    return (my_hash >>> 0).toString(16).padStart(8, '0');
}
