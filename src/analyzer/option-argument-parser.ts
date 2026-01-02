/**
 * Parser for option arguments that create macros (e.g., local(), global())
 */

export interface OptionArgumentResult {
    /** Whether the argument is a valid literal identifier */
    is_literal: boolean;
    /** The extracted identifier (if literal) */
    identifier?: string;
    /** Reason for rejection (if not literal) */
    rejection_reason?: 'empty' | 'macro_expansion' | 'quoted' | 'whitespace' | 'invalid_chars';
}

/**
 * Parse an option argument and extract a literal identifier if valid.
 * 
 * Rules:
 * - Trims leading/trailing whitespace
 * - Rejects if empty after trimming
 * - Rejects if contains macro expansion (` or $)
 * - Rejects if contains quotes (single or double)
 * - Rejects if contains internal whitespace
 * - Rejects if contains non-identifier characters
 * - Returns the identifier if valid
 */
export function parse_option_argument(argument: string | undefined): OptionArgumentResult {
    if (argument === undefined) {
        return { is_literal: false, rejection_reason: 'empty' };
    }

    const trimmed = argument.trim();

    if (!trimmed) {
        return { is_literal: false, rejection_reason: 'empty' };
    }

    // Check for macro expansion (` or $)
    if (/[`$]/.test(trimmed)) {
        return { is_literal: false, rejection_reason: 'macro_expansion' };
    }

    // Check for quotes (single or double)
    if (/["']/.test(trimmed)) {
        return { is_literal: false, rejection_reason: 'quoted' };
    }

    // Check for internal whitespace
    if (/\s/.test(trimmed)) {
        return { is_literal: false, rejection_reason: 'whitespace' };
    }

    // Validate identifier (Stata naming rules: letter/underscore + alphanumeric/underscore)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
        return { is_literal: false, rejection_reason: 'invalid_chars' };
    }

    return { is_literal: true, identifier: trimmed };
}

/**
 * Check if a string is a valid Stata identifier.
 */
export function is_valid_identifier(name: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
