// Pure types for testability (no vscode dependency)
export interface Extension {
    id: string;
    packageJSON?: {
        displayName?: string;
        contributes?: {
            languages?: Array<{ id?: string; extensions?: string[] }>;
        };
    };
}

// Requirements-based extensions (Req 1.3: .do, .ado, .mata only)
export const STATA_FILE_EXTENSIONS = ['.do', '.ado', '.mata'];

export function isConflictingExtension(extension: Extension, ownExtensionId: string): boolean {
    if (extension.id === ownExtensionId) return false;
    
    const contributes = extension.packageJSON?.contributes;
    if (!contributes) return false;
    
    // Check if contributes 'stata' language (Req 1.2)
    if (contributes.languages?.some(lang => lang.id === 'stata')) return true;
    
    // Check if registers Stata file extensions (Req 1.3: .do, .ado, .mata only)
    if (contributes.languages?.some(lang => 
        lang.extensions?.some(ext => 
            STATA_FILE_EXTENSIONS.includes(ext.toLowerCase())
        )
    )) return true;
    
    return false;
}

export function findConflictingExtensions(extensions: readonly Extension[], ownExtensionId: string): Extension[] {
    return extensions.filter(ext => isConflictingExtension(ext, ownExtensionId));
}

export function getDisplayName(extension: Extension): string {
    return extension.packageJSON?.displayName || extension.id;
}

// Minimal interface for formatting functions (vscode-free)
export interface ConflictingExtension {
    id: string;
    displayName: string;
}

export function formatConflictMessage(conflicts: ConflictingExtension[]): string {
    if (conflicts.length === 0) return '';
    
    const names = conflicts.map(ext => ext.displayName).join(', ');
    const isPlural = conflicts.length > 1;
    const pronoun = isPlural ? 'them' : 'it';
    const extensionWord = isPlural ? 'extensions' : 'extension';
    
    return `Conflicting Stata ${extensionWord} detected: ${names}. Disable or uninstall ${pronoun} to use Sight's syntax highlighting for Stata files.`;
}

export function formatConflictTooltip(conflicts: ConflictingExtension[]): string {
    if (conflicts.length === 0) return '';
    
    const list = conflicts.map(ext => `• ${ext.displayName}`).join('\n');
    return `Conflicting extensions:\n${list}\n\nThese may interfere with Sight's language features.`;
}

export function isStataFile(fileName: string | undefined): boolean {
    if (!fileName) return false;
    return STATA_FILE_EXTENSIONS.some(ext => fileName.toLowerCase().endsWith(ext));
}

/**
 * Determines whether the dismissal flag should be persisted based on user selection.
 * Only "Dismiss" or closing the dialog (undefined) should persist dismissal.
 */
export function shouldPersistDismissal(selection: string | undefined): boolean {
    return selection === 'Dismiss' || selection === undefined;
}
