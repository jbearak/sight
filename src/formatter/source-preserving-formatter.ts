import { Token, StataAST } from '../types';
import { logger } from '../utils/logger';
import { IndentationAnalyzer, IndentationInfo } from './indentation-analyzer';
import { TokenReconstructor, FormatterConfig } from './token-reconstructor';

export class SourcePreservingFormatter {
    private config: FormatterConfig;
    private indentation_analyzer: IndentationAnalyzer;
    private token_reconstructor: TokenReconstructor;

    constructor(config: FormatterConfig) {
        this.config = config;
        this.indentation_analyzer = new IndentationAnalyzer();
        this.token_reconstructor = new TokenReconstructor();
    }

    format(tokens: Token[], ast: StataAST, _line_offsets: number[], original_source: string): string {
        try {
            const indentation_info = this.indentation_analyzer.analyze(ast, tokens);
            const line_indents = this.convert_to_line_indents(indentation_info);
            return this.token_reconstructor.reconstruct(tokens, line_indents, this.config, original_source);
        } catch (error) {
            logger.warn(`Formatting failed, falling back to original source: ${error}`);
            return original_source;
        }
    }

    private convert_to_line_indents(indentation_info: Map<number, IndentationInfo>): Map<number, number> {
        const line_indents = new Map<number, number>();
        for (const [my_line, my_info] of indentation_info) {
            line_indents.set(my_line, my_info.indent_level);
        }
        return line_indents;
    }
}
