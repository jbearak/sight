import { Token, StataAST } from '../types';
import { logger } from '../utils/logger';
import { IndentationAnalyzer } from './indentation-analyzer';
import { TokenReconstructor, FormatterConfig } from './token-reconstructor';
import { AlignmentDetector } from './alignment-detector';

export class SourcePreservingFormatter {
    private config: FormatterConfig;
    private indentation_analyzer: IndentationAnalyzer;
    private token_reconstructor: TokenReconstructor;
    private alignment_detector: AlignmentDetector;

    constructor(config: FormatterConfig) {
        this.config = config;
        this.indentation_analyzer = new IndentationAnalyzer(config.indent_size);
        this.token_reconstructor = new TokenReconstructor();
        this.alignment_detector = new AlignmentDetector();
    }

    format(tokens: Token[], ast: StataAST, _line_offsets: number[], original_source: string, config?: { preserve_alignment?: boolean }): string {
        try {
            const alignment_info = (config?.preserve_alignment !== false) 
                ? this.alignment_detector.analyze(tokens, original_source)
                : undefined;
            const indentation_info = this.indentation_analyzer.analyze(ast, tokens, alignment_info, original_source);
            return this.token_reconstructor.reconstruct(tokens, indentation_info, this.config, original_source);
        } catch (error) {
            logger.warn(`Formatting failed, falling back to original source: ${error}`);
            return original_source;
        }
    }

}
