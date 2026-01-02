import { init_tracker_from_source } from '../test-context-helper';
import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { DocumentStore } from '../../src/document-store';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { CompletionProvider } from '../../src/providers/completion';
import { ContextTracker } from '../../src/context-tracker';
import { LanguageContext } from '../../src/types';
import { command_database } from '../../src/commands';
import { initialize_builtin_commands } from '../../src/commands/builtin-commands';

// Default test configuration
const DEFAULT_CONFIG = {
    diagnostics: {
        enabled: true,
        severity: {
            undefinedMacro: 'warning',
            undefinedVariable: 'information',
            styleWarnings: 'hint',
        },
        undefinedVariableEnabled: false,
    },
    completion: {},
    formatting: {
        indentSize: 4,
        indentStyle: 'spaces',
    },
    adoPaths: [],
    indexWorkspace: true,
};

describe('Real-world Stata Files with Embedded Languages', () => {
    let lexer: StataLexer;
    let parser: StataParser;
    let analyzer: SemanticAnalyzer;
    let document_store: DocumentStore;
    let diagnostics_provider: DiagnosticsProvider;
    let completion_provider: CompletionProvider;

    beforeEach(() => {
        initialize_builtin_commands();
        lexer = new StataLexer();
        parser = new StataParser();
        analyzer = new SemanticAnalyzer();
        document_store = new DocumentStore();
        diagnostics_provider = new DiagnosticsProvider({
            sendDiagnostics: () => {},
        } as any);
        completion_provider = new CompletionProvider(command_database, {
            snippet_support: true,
        });
    });

    describe('Complex mata blocks', () => {
        it('should parse complex mata code without crashing', () => {
            const my_content = `mata
function my_function(x, y) {
    return(x + y)
}

matrix A = (1, 2 \\ 3, 4)
matrix B = (5, 6 \\ 7, 8)
matrix C = A * B

for (i = 1; i <= rows(C); i++) {
    for (j = 1; j <= cols(C); j++) {
        printf("%g ", C[i, j])
    }
    printf("\\n")
}
end`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            expect(my_tokens.length).toBeGreaterThan(0);

            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);
            expect(my_parse_result.ast).toBeDefined();

            const my_analysis = analyzer.analyze(my_parse_result.ast, 'file:///complex_mata.do');
            expect(my_analysis).toBeDefined();
        });

        it('should handle mata with nested structures', () => {
            const my_content = `mata
class MyClass {
    real scalar value
    
    real scalar get_value() {
        return(this.value)
    }
}

obj = MyClass()
obj.value = 42
end`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);
        });

        it('should handle mata with string operations', () => {
            const my_content = `mata
string scalar my_string = "hello world"
string vector my_vector = ("a", "b", "c")
string matrix my_matrix = ("x", "y" \\ "z", "w")

for (i = 1; i <= length(my_vector); i++) {
    printf("%s\\n", my_vector[i])
}
end`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);
        });

        it('should handle mata with comments', () => {
            const my_content = `mata
// This is a line comment
matrix A = (1, 2)  // inline comment

/* This is a block comment
   spanning multiple lines */
matrix B = (3, 4)

/* Another block comment */ matrix C = (5, 6)
end`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);
        });
    });

    describe('Complex python blocks', () => {
        it('should parse complex python code without crashing', () => {
            const my_content = `python
import numpy as np
import pandas as pd

def calculate_statistics(data):
    mean = np.mean(data)
    std = np.std(data)
    return {'mean': mean, 'std': std}

data = [1, 2, 3, 4, 5]
stats = calculate_statistics(data)

for key, value in stats.items():
    print(f"{key}: {value}")
end python`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            expect(my_tokens.length).toBeGreaterThan(0);

            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);
            expect(my_parse_result.ast).toBeDefined();

            const my_analysis = analyzer.analyze(my_parse_result.ast, 'file:///complex_python.do');
            expect(my_analysis).toBeDefined();
        });

        it('should handle python with nested structures', () => {
            const my_content = `python
class DataProcessor:
    def __init__(self, data):
        self.data = data
    
    def process(self):
        result = []
        for item in self.data:
            if item > 0:
                result.append(item * 2)
        return result

processor = DataProcessor([1, 2, 3])
processed = processor.process()
print(processed)
end python`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);
        });

        it('should handle python with string operations', () => {
            const my_content = `python
text = "hello world"
words = text.split()

for word in words:
    print(f"Word: {word}")

multiline_string = """
This is a multiline
string in Python
"""
print(multiline_string)
end python`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);
        });

        it('should handle python with comments', () => {
            const my_content = `python
# This is a line comment
x = 5  # inline comment

"""
This is a docstring
spanning multiple lines
"""

# Another comment
y = 10
end python`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);
        });
    });

    describe('Mixed embedded languages', () => {
        it('should handle file with both mata and python blocks', () => {
            const my_content = `// Data analysis script
generate x = rnormal()
generate y = rnormal()

mata
matrix data = (1, 2 \\ 3, 4)
matrix result = data * 2
end

python
import numpy as np
arr = np.array([1, 2, 3])
print(arr)
end python

summarize x y`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            expect(my_tokens.length).toBeGreaterThan(0);

            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);

            const my_analysis = analyzer.analyze(my_parse_result.ast, 'file:///mixed.do');
            expect(my_analysis).toBeDefined();
        });

        it('should handle multiple mata and python blocks', () => {
            const my_content = `mata
matrix A = (1, 2)
end

python
x = 5
end

mata
matrix B = (3, 4)
end

python
y = 10
end

generate z = 1`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);

            // Verify context tracking
            const my_context_tracker = new ContextTracker();
            init_tracker_from_source(my_context_tracker, my_content);
            const my_ranges = my_context_tracker.get_all_context_ranges();

            // Should detect 4 embedded blocks
            expect(my_ranges.length).toBe(4);
            expect(my_ranges[0].context).toBe(LanguageContext.MATA);
            expect(my_ranges[1].context).toBe(LanguageContext.PYTHON);
            expect(my_ranges[2].context).toBe(LanguageContext.MATA);
            expect(my_ranges[3].context).toBe(LanguageContext.PYTHON);
        });
    });

    describe('Edge cases with embedded languages', () => {
        it('should handle single-line mata and python', () => {
            const my_content = `mata: matrix A = (1, 2)
python: x = 5
generate y = 1`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);

            const my_context_tracker = new ContextTracker();
            init_tracker_from_source(my_context_tracker, my_content);
            const my_ranges = my_context_tracker.get_all_context_ranges();

            expect(my_ranges.length).toBe(2);
            expect(my_ranges[0].is_single_line).toBe(true);
            expect(my_ranges[1].is_single_line).toBe(true);
        });

        it('should handle embedded blocks with macros', () => {
            const my_content = `local myvar = 5
mata
matrix A = (1, 2)
// Can reference macros: \`myvar'
end

python
# Can reference macros: \`myvar'
x = 5
end python`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);
        });

        it('should handle embedded blocks with special characters', () => {
            const my_content = `mata
string scalar special = "!@#$%^&*()"
matrix A = (1, 2)
end

python
special = "!@#$%^&*()"
print(special)
end python`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);
        });

        it('should handle embedded blocks with unicode characters', () => {
            const my_content = `mata
string scalar unicode = "café"
end

python
unicode = "café"
print(unicode)
end python`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);
        });

        it('should handle very large embedded blocks', () => {
            let my_mata_content = 'mata\n';
            for (let i = 0; i < 100; i++) {
                my_mata_content += `matrix M${i} = (${i}, ${i + 1})\n`;
            }
            my_mata_content += 'end\n';

            const my_tokens = lexer.tokenize(my_mata_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);
        });

        it('should handle embedded blocks with deeply nested structures', () => {
            const my_content = `mata
function nested(a, b, c) {
    if (a > 0) {
        if (b > 0) {
            if (c > 0) {
                return(a + b + c)
            }
        }
    }
    return(0)
}
end`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);
        });
    });

    describe('Diagnostics with real-world patterns', () => {
        it('should not crash on complex real-world file', async () => {
            const my_content = `// Complex analysis script
version 17.0

program define my_analysis
    syntax varlist, [options]
    
    local count = 0
    foreach var of local varlist {
        local ++count
        display "Processing variable \`var'"
    }
    
    mata
    matrix results = J(\`count', 3, .)
    for (i = 1; i <= \`count'; i++) {
        results[i, 1] = i
        results[i, 2] = i^2
        results[i, 3] = i^3
    }
    end
    
    python
    import numpy as np
    data = np.array([1, 2, 3])
    print(data)
    end python
    
    display "Analysis complete"
end

my_analysis x y z`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            expect(my_tokens.length).toBeGreaterThan(0);

            const my_parse_result = parser.parse(my_tokens);
            // Should parse without crashing (may have some errors due to complex syntax)
            expect(my_parse_result.ast).toBeDefined();

            const my_document_uri = 'file:///complex_analysis.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            // Should not crash when getting diagnostics
            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );
            expect(the_diagnostics).toBeDefined();

            // Should not crash when getting completions
            const the_completions = await completion_provider.get_completions(
                my_document,
                { line: 5, character: 0 }
            );
            expect(the_completions).toBeDefined();
        });

        it('should handle file with mixed content and embedded languages', async () => {
            const my_content = `// Data preparation
use mydata.dta, clear

// Generate variables
generate log_income = log(income)
generate age_squared = age^2

// Mata calculations
mata
matrix X = (1, 2, 3 \\ 4, 5, 6)
matrix Y = X'
end

// Python analysis
python
import pandas as pd
df = pd.DataFrame({'x': [1, 2, 3]})
print(df.describe())
end

// Regression
regress log_income age education

// Save results
save results.dta, replace`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.errors.length).toBe(0);

            const my_document_uri = 'file:///data_prep.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            // Verify context tracking
            const my_context_tracker = my_document.context_tracker;
            expect(my_context_tracker.get_context_at_position({ line: 0, character: 0 }))
                .toBe(LanguageContext.STATA);
            expect(my_context_tracker.get_context_at_position({ line: 10, character: 0 }))
                .toBe(LanguageContext.MATA);
            expect(my_context_tracker.get_context_at_position({ line: 15, character: 0 }))
                .toBe(LanguageContext.PYTHON);
            expect(my_context_tracker.get_context_at_position({ line: 21, character: 0 }))
                .toBe(LanguageContext.STATA);
        });
    });

    describe('Error recovery with embedded languages', () => {
        it('should recover from malformed mata block', () => {
            const my_content = `mata
matrix A = (1, 2
// Missing closing paren and end
generate x = 1`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            // Should not crash even with malformed content
            expect(my_parse_result.ast).toBeDefined();
        });

        it('should recover from malformed python block', () => {
            const my_content = `python
def my_function(
    # Missing closing paren and end
generate x = 1`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            // Should not crash even with malformed content
            expect(my_parse_result.ast).toBeDefined();
        });

        it('should handle incomplete embedded blocks at EOF', async () => {
            const my_content = `mata
matrix A = (1, 2)`;

            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            expect(my_parse_result.ast).toBeDefined();

            const my_document_uri = 'file:///incomplete.do';
            await document_store.open(my_document_uri, my_content, 1);
            const my_document = document_store.get(my_document_uri)!;

            // Should detect unclosed block
            const the_diagnostics = await diagnostics_provider.get_diagnostics(
                my_document,
                DEFAULT_CONFIG
            );
            const unclosed_diag = the_diagnostics.find(
                d => d.message.includes('Unclosed mata block')
            );
            expect(unclosed_diag).toBeDefined();
        });
    });

    describe('Performance with embedded languages', () => {
        it('should handle file with many embedded blocks efficiently', () => {
            let my_content = '';
            for (let i = 0; i < 10; i++) {
                my_content += `mata\nmatrix M${i} = (${i}, ${i + 1})\nend\n`;
                my_content += `python\nx = ${i}\nend python\n`;
            }

            const my_start_time = Date.now();
            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            const my_end_time = Date.now();

            expect(my_parse_result.errors.length).toBe(0);
            // Should complete in reasonable time (< 1 second)
            expect(my_end_time - my_start_time).toBeLessThan(1000);
        });

        it('should handle large embedded blocks efficiently', () => {
            let my_content = 'mata\n';
            for (let i = 0; i < 1000; i++) {
                my_content += `matrix M${i} = (${i})\n`;
            }
            my_content += 'end\n';

            const my_start_time = Date.now();
            const my_tokens = lexer.tokenize(my_content).tokens;
            const my_parse_result = parser.parse(my_tokens);
            const my_end_time = Date.now();

            expect(my_parse_result.errors.length).toBe(0);
            // Should complete in reasonable time (< 2 seconds)
            expect(my_end_time - my_start_time).toBeLessThan(2000);
        });
    });
});
