# Design Document: Comment Style Normalization

## Overview

This design document outlines the implementation of comment style normalization for the Stata LSP. The feature provides optional, configurable comment style conversion and line length normalization during document formatting operations. The implementation extends the existing `CodeFormatter` class and integrates with the lexer's comment detection capabilities.

## Architecture

The comment normalization feature follows the existing LSP architecture pattern:

```
Configuration → Formatter → Comment Processor → Pretty Printer → LSP Response
```

### Key Components

1. **Configuration Extension**: Extends `StataLSPConfig` with comment formatting options
2. **Comment Processor**: New component for analyzing and transforming comments
3. **Formatter Enhancement**: Extends `CodeFormatter` to support comment normalization
4. **Lexer Integration**: Leverages existing comment detection in `StataLexer`

## Components and Interfaces

### Configuration Interface

```typescript
interface CommentFormattingConfig {
  preferredCommentStyle: '//' | '*' | '/* */';
  normalizeCommentStyle: boolean;
  normalizeOnSave: boolean;
  commentLineWidth: number;
}

// Extension to existing StataLSPConfig
interface StataLSPConfig {
  // ... existing properties
  formatting: {
    // ... existing properties
    indentSize: number;
    indentStyle: 'spaces' | 'tabs';
    
    // New comment formatting properties
    preferredCommentStyle: '//' | '*' | '/* */';
    normalizeCommentStyle: boolean;
    normalizeOnSave: boolean;
    commentLineWidth: number;
  };
}
```

### Comment Processor Interface

```typescript
interface CommentTransformation {
  original_range: Range;
  new_text: string;
  comment_type: 'line' | 'block';
  original_style: 'star' | 'slash' | 'block';
  target_style: 'star' | 'slash' | 'block';
}

interface CommentProcessor {
  process_comments(
    tokens: Token[],
    config: CommentFormattingConfig,
    context_ranges: ContextRange[]
  ): CommentTransformation[];
  
  normalize_comment_style(
    comment_token: Token,
    target_style: 'star' | 'slash' | 'block'
  ): string;
  
  wrap_comment_lines(
    comment_text: string,
    line_width: number,
    comment_style: 'star' | 'slash' | 'block',
    indent_level: number
  ): string[];
  
  is_markdown_sensitive_line(line: string): boolean;
}
```

### Enhanced Formatter Interface

```typescript
interface EnhancedCodeFormatter extends CodeFormatter {
  format_with_comment_normalization(
    document: DocumentState,
    options: FormattingOptions,
    comment_config: CommentFormattingConfig
  ): TextEdit[];
  
  apply_comment_transformations(
    content: string,
    transformations: CommentTransformation[]
  ): string;
}
```

## Data Models

### Comment Analysis Model

```typescript
interface CommentAnalysis {
  token: Token;
  style: 'star' | 'slash' | 'block' | 'continuation';
  content: string;
  indent_level: number;
  is_in_embedded_context: boolean;
  language_context: LanguageContext;
  line_number: number;
  is_multiline: boolean;
  contains_markdown: boolean;
}

interface CommentGroup {
  comments: CommentAnalysis[];
  start_line: number;
  end_line: number;
  should_combine: boolean; // For converting to block comments
  common_indent: number;
}
```

### Markdown Detection Model

```typescript
interface MarkdownElement {
  type: 'header' | 'list_item' | 'code_block' | 'emphasis' | 'link';
  line_start: number;
  line_end: number;
  preserve_structure: boolean;
}

interface MarkdownAnalysis {
  elements: MarkdownElement[];
  has_markdown: boolean;
  line_break_sensitive: boolean[];
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Based on the prework analysis and property reflection to eliminate redundancy, the following properties validate the comment normalization functionality:

### Property 1: Configuration validation and fallback
*For any* configuration input, invalid `preferredCommentStyle` values should fall back to the default "//" style, and valid values ("//", "*", "/* */") should be accepted
**Validates: Requirements 1.2, 1.4, 11.2**

### Property 2: Comment preservation when normalization disabled
*For any* document with mixed comment styles, when `normalizeCommentStyle` is false, all comment styles should be preserved exactly
**Validates: Requirements 2.3**

### Property 3: Comment normalization when enabled
*For any* document and target comment style, when `normalizeCommentStyle` is true, all comments in Stata context should be converted to the preferred style while preserving content
**Validates: Requirements 2.4, 3.6, 4.7**

### Property 4: Comprehensive comment detection
*For any* valid Stata comment (star, slash, block, or continuation), the formatter should correctly identify it as a comment and not confuse comment-like text inside strings
**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

### Property 5: Style conversion correctness
*For any* comment in one style, converting it to another style should preserve the comment content and proper indentation while changing only the comment delimiters
**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**

### Property 6: Continuation comment preservation
*For any* continuation comment (///), it should never be normalized regardless of the target style
**Validates: Requirements 4.8**

### Property 7: Multi-line comment handling
*For any* multi-line block comment, converting to line comment style should create multiple properly indented line comments, and converting multiple consecutive line comments to block style should combine them appropriately
**Validates: Requirements 5.1, 5.2, 5.3, 5.5**

### Property 8: Blank line preservation in comments
*For any* multi-line comment containing blank lines, those blank lines should be preserved during style conversion
**Validates: Requirements 5.4**

### Property 9: Comment toggle style consistency
*For any* line being commented or uncommented, the toggle operation should use the configured preferred style for commenting and correctly remove comments regardless of original style
**Validates: Requirements 6.1, 6.5**

### Property 10: Code generation style consistency
*For any* auto-generated comment (templates, documentation, TODO), it should use the configured preferred comment style
**Validates: Requirements 7.1, 7.2, 7.3, 7.4**

### Property 11: Embedded context preservation
*For any* document containing embedded language blocks (Mata or Python), comments within those blocks should never be normalized and should preserve their original syntax
**Validates: Requirements 9.1, 9.2, 9.3, 9.4**

### Property 12: Non-comment code preservation
*For any* document being formatted, all non-comment tokens should remain exactly unchanged during comment normalization
**Validates: Requirements 10.2**

### Property 13: Edge case error handling
*For any* edge case input (empty comments, special characters, malformed comments), the formatter should handle them without throwing errors
**Validates: Requirements 10.4**

### Property 14: Comment line wrapping
*For any* comment longer than the configured line width, it should be wrapped at word boundaries while preserving indentation and not wrapping comments shorter than the width
**Validates: Requirements 12.3, 12.4, 12.5, 12.6, 12.7**

### Property 15: Markdown-aware wrapping
*For any* comment containing Markdown syntax, the formatter should preserve Markdown structure (headers, lists, code blocks) and not break list items or other elements across lines during wrapping
**Validates: Requirements 12.8, 12.9, 12.10, 12.11**

<function_calls>
<invoke name="prework">
<parameter name="featureName">comment-style-normalization

## Error Handling

### Configuration Errors
- Invalid `preferredCommentStyle` values fall back to "//" with warning log
- Invalid `commentLineWidth` values fall back to 72 with warning log
- Missing configuration properties use documented defaults

### Processing Errors
- Malformed comments are left unchanged rather than causing failures
- Embedded language context detection errors preserve original comments
- Markdown parsing errors fall back to plain text wrapping

### Recovery Strategies
- Graceful degradation: if comment normalization fails, preserve original formatting
- Atomic operations: either all comments in a group are normalized or none are
- Position tracking: maintain accurate line/column positions even after transformations

## Testing Strategy

### Dual Testing Approach
The comment normalization feature requires both unit tests and property-based tests for comprehensive coverage:

**Unit Tests** focus on:
- Specific configuration examples (default values, valid/invalid inputs)
- Integration points with existing formatter
- Edge cases (empty comments, special characters)
- Markdown detection examples

**Property-Based Tests** focus on:
- Universal properties across all comment types and styles
- Comprehensive input coverage through randomization
- Round-trip properties (style conversion preserves content)
- Invariant preservation (indentation, non-comment code)

### Property-Based Testing Configuration
- **Library**: fast-check (existing in project)
- **Iterations**: Minimum 100 per property test
- **Test Tags**: Each property test references its design document property
- **Tag Format**: `**Feature: comment-style-normalization, Property {number}: {property_text}**`

### Test Data Generation
- **Comment Generators**: Random comments in all styles with various content
- **Document Generators**: Random Stata documents with mixed comment styles
- **Markdown Generators**: Comments with various Markdown elements
- **Context Generators**: Documents with embedded language blocks
- **Configuration Generators**: Valid and invalid configuration combinations

### Integration Testing
- VS Code extension integration for comment toggle commands
- LSP protocol compliance for formatting requests
- Performance testing with large documents (up to 10,000 lines)
- Cross-platform compatibility (Windows, macOS, Linux)

## Implementation Notes

### Lexer Integration
The implementation leverages the existing `StataLexer` comment detection:
- Reuses `is_star_comment()` logic for context-aware * detection
- Utilizes existing token types: `COMMENT_LINE`, `COMMENT_BLOCK`, `CONTINUATION`
- Respects embedded language context from `LanguageContext` enum

### Formatter Extension
The `CodeFormatter` class is extended rather than replaced:
- New `format_with_comment_normalization()` method
- Preserves existing embedded language block handling
- Maintains compatibility with current pretty-printer integration

### Performance Considerations
- Comment processing occurs only when normalization is enabled
- Transformations are batched and applied in single pass
- Line offset calculations reuse existing lexer infrastructure
- Markdown detection uses lightweight regex patterns

### Backward Compatibility
- All new configuration options have safe defaults (normalization disabled)
- Existing formatting behavior unchanged when new features disabled
- No breaking changes to existing LSP protocol methods
- Graceful handling of older configuration files
