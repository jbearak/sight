/**
 * Shared SMCL marker extraction utility.
 *
 * Extracts `{marker <name>}` directives from raw SMCL content.
 * Used by the anchor fallback resolver and the link checker script
 * to ensure parity between runtime and validation.
 *
 * Grammar: `{marker <name>}` where `<name>` is all characters between
 * the space after `marker` and the closing `}`. Names can contain
 * letters, digits, `_`, `()`, `.`, `*`, `#`, `-`.
 * Names are trimmed before insertion (defensive against trailing
 * whitespace in user-authored files).
 */

const MARKER_RE = /\{marker\s+([^}]+)\}/g;

/**
 * Extract all marker names from SMCL content.
 *
 * @param content - Raw SMCL source (may include expanded includes)
 * @returns Set of trimmed marker names found in the content
 */
export function extract_marker_names(content: string): Set<string> {
    const the_names = new Set<string>();
    MARKER_RE.lastIndex = 0;
    let my_match: RegExpExecArray | null;
    while ((my_match = MARKER_RE.exec(content)) !== null) {
        const my_name = my_match[1].trim();
        if (my_name.length > 0) {
            the_names.add(my_name);
        }
    }
    return the_names;
}
