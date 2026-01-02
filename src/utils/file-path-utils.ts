/**
 * File path utilities for Sight
 */

// Commands that accept file paths as their first argument
export const FILE_COMMANDS = new Set([
  'do', 'run', 'include',
  'use', 'save', 'append', 'merge',
  'import', 'export',
  'cd', 'adopath'
]);

// LSP directives that accept file paths
export const PATH_DIRECTIVES = new Set([
  '@lsp-done-by',
  '@lsp-included-by', 
  '@lsp-do',
  '@lsp-run',
  '@lsp-include',
  '@lsp-working-directory',
  '@lsp-working-dir',
  '@lsp-current-directory',
  '@lsp-current-dir',
  '@lsp-cd',
  '@lsp-wd'
]);

// Stata file extensions for completion filtering
export const STATA_FILE_EXTENSIONS = ['.do', '.ado', '.doh', '.mata'];

/**
 * Check if a command accepts file paths as its first argument
 */
export function isFileCommand(command: string): boolean {
  return FILE_COMMANDS.has(command);
}

/**
 * Check if a directive accepts file paths
 */
export function isPathDirective(directive: string): boolean {
  return PATH_DIRECTIVES.has(directive.toLowerCase());
}

/**
 * Check if a file has a Stata extension
 */
export function hasStataExtension(filename: string): boolean {
  return STATA_FILE_EXTENSIONS.some(ext => filename.toLowerCase().endsWith(ext));
}

/**
 * Resolve file path with .do fallback
 * Returns the path that exists, trying original path first, then with .do extension
 */
export function resolvePathWithDoFallback(fs_path: string, fs: { existsSync: (path: string) => boolean }): string | null {
  // Try original path first
  if (fs.existsSync(fs_path)) {
    return fs_path;
  }
  
  // Try .do fallback if original path doesn't end in .do
  if (!fs_path.endsWith('.do')) {
    const fallback_path = fs_path + '.do';
    if (fs.existsSync(fallback_path)) {
      return fallback_path;
    }
  }
  
  return null;
}
