/**
 * Normalize an unknown thrown value to a human-readable message string.
 *
 * Prefer the Error's own message; fall back to String() for non-Error
 * rejections (objects, strings) so logs never read '[object Object]'.
 */
export function error_message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
