/**
 * Mock TextDocument utilities for property-based testing.
 * Provides a lightweight mock of vscode.TextDocument for testing
 * statement detection and other document-related functionality.
 */

/**
 * Mock interface for vscode.TextDocument.
 * Provides the minimal interface needed for statement detection tests.
 */
export interface MockTextDocument {
    lineCount: number;
    lineAt(line: number): { text: string };
}

/**
 * Create a mock TextDocument from a content string.
 * Splits content by newlines and provides line-based access.
 * 
 * @param content - The document content as a string
 * @returns A MockTextDocument instance
 */
export function create_mock_document(content: string): MockTextDocument {
    const the_lines = content.split('\n');
    return {
        lineCount: the_lines.length,
        lineAt(line: number) {
            return { text: the_lines[line] ?? '' };
        }
    };
}
