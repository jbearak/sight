import * as path from 'path';
import { get_workspace_root_for_path } from './workspace-roots';

/**
 * Whether a source file is beneath a hidden descendant of a scan root.
 * The deepest selected workspace/ado root wins; hidden ancestors of that
 * root and hidden source filenames are not exclusions. Paths outside all
 * roots are unaffected, as are explicitly opened/resolved documents.
 */
export function is_hidden_source_path(
    file_path: string,
    scan_roots: string[]
): boolean {
    const root = get_workspace_root_for_path(scan_roots, file_path);
    if (!root) return false;

    const relative_path = path.relative(root, path.resolve(file_path));
    // get_workspace_root_for_path falls back to the first root for files
    // outside every root. Do not apply that fallback as a scan boundary.
    if (
        relative_path === '..' ||
        relative_path.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative_path)
    ) {
        return false;
    }

    const the_directories = relative_path.split(path.sep).slice(0, -1);
    return the_directories.some(my_directory => my_directory.startsWith('.'));
}
