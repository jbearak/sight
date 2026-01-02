/**
 * Property-based tests for source link formatting in hover provider
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { HoverProvider } from '../../../src/providers/hover';
import { CommandDatabase } from '../../../src/command-database';

describe('Hover Source Link Formatting Property Tests', () => {
  let hover_provider: HoverProvider;

  beforeEach(() => {
    const command_db = new CommandDatabase();
    hover_provider = new HoverProvider(command_db);
  });

  // Generators
  const arbitrary_uri = () =>
      fc.string({
          minLength: 1,
          maxLength: 20,
          unit: fc.char().filter(c => /[a-zA-Z0-9_-]/.test(c))
      }).map(s => `file:///path/to/${s}.do`);

  const arbitrary_workspace_root = () =>
      fc.string({
          minLength: 1,
          maxLength: 20,
          unit: fc.char().filter(c => /[a-zA-Z0-9_-]/.test(c))
      }).map(s => `file:///workspace/${s}`);

  /**
   * Property 1: Cross-file symbols have clickable markdown links
   * Feature: symbol-source-file-links, Property 1: Cross-file symbols have clickable markdown links
   * Validates: Requirements 1.1, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.4
   */
  it('should create clickable markdown links for cross-file symbols', () => {
    fc.assert(
      fc.property(
        arbitrary_uri(),
        arbitrary_uri(),
        fc.option(arbitrary_workspace_root()),
        (source_uri, current_uri, workspace_root) => {
          fc.pre(source_uri !== current_uri);

          const link = (hover_provider as any).format_source_link(
            source_uri,
            current_uri,
            workspace_root
          );

          // Should contain markdown link format [display_path](file://...)
          const link_pattern = /\[([^\]]+)\]\(file:\/\/[^)]+\)/;
          const has_link = link_pattern.test(link);

          if (!has_link) {
            throw new Error(`Expected markdown link, got: ${link}`);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Same-file symbols have no source link
   * Feature: symbol-source-file-links, Property 2: Same-file symbols have no source link
   * Validates: Requirements 1.3
   */
  it('should not include source links for same-file symbols', () => {
    fc.assert(
      fc.property(
        arbitrary_uri(),
        fc.option(arbitrary_workspace_root()),
        (current_uri, workspace_root) => {
          const link = (hover_provider as any).format_source_link(
            current_uri,
            current_uri,
            workspace_root
          );

          // Should return empty string for same-file
          if (link !== '') {
            throw new Error(`Expected empty string for same-file, got: ${link}`);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Path display is workspace-relative when applicable
   * Feature: symbol-source-file-links, Property 3: Path display is workspace-relative when applicable
   * Validates: Requirements 1.4, 3.2, 3.3
   */
  it('should display workspace-relative paths when applicable', () => {
    fc.assert(
      fc.property(
        arbitrary_workspace_root(),
        arbitrary_uri(),
        fc.boolean(),
        (workspace_root, current_uri, inside_workspace) => {
          const source_uri = inside_workspace
            ? `${workspace_root}/subdir/file.do`
            : `file:///other/path/file.do`;

          fc.pre(source_uri !== current_uri);

          const link = (hover_provider as any).format_source_link(
            source_uri,
            current_uri,
            workspace_root
          );

          const link_match = link.match(/\[([^\]]+)\]\(file:\/\/[^)]+\)/);
          if (!link_match) {
            throw new Error(`Expected markdown link, got: ${link}`);
          }

          const display_path = link_match[1];

          if (inside_workspace) {
            // Should be relative path (no leading /, no file://)
            if (display_path.startsWith('/') || display_path.includes('file://')) {
              throw new Error(`Expected relative path for workspace file, got: ${display_path}`);
            }
          } else {
            // Should be full path (starts with /)
            if (!display_path.startsWith('/')) {
              throw new Error(`Expected full path for non-workspace file, got: ${display_path}`);
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

