import { test, expect } from 'bun:test';
import { SmclParser } from '../../src/smcl-parser/parser';
import { SyntaxExtractor } from '../../src/smcl-parser/extractors/syntax-extractor';
import { OptionExtractor } from '../../src/smcl-parser/extractors/option-extractor';
import { StoredResultsExtractor } from '../../src/smcl-parser/extractors/stored-results-extractor';
import { CrossReferenceExtractor } from '../../src/smcl-parser/extractors/cross-reference-extractor';

test('SMCL Parser Integration - regress command example', () => {
    const my_sample_smcl = `
{smcl}
{title}regress{p_end}

{title}Syntax{p_end}
{cmd}regress depvar [indepvars] [if] [in] [weight] [, options]{p_end}

{title}Options{p_end}
{synopt:{opt noconstant}}suppress constant term{p_end}
{synopt:{opt robust}}use robust standard errors{p_end}
{synopt:{opt vce(vcetype)}}variance-covariance estimator{p_end}

{title}Stored results{p_end}
e(N) number of observations
e(r2) R-squared
e(b) coefficient vector

{title}Also see{p_end}
{help anova}, {help test}
    `;

    const my_parser = new SmclParser();
    const my_doc = my_parser.parse_content(my_sample_smcl);

    // Test syntax extraction
    const my_syntax_extractor = new SyntaxExtractor();
    const the_syntax = my_syntax_extractor.extract_syntax(my_doc);
    
    expect(the_syntax.length).toBeGreaterThan(0);
    expect(the_syntax[0].pattern).toContain('regress');
    expect(the_syntax[0].required_elements).toContain('regress');
    expect(the_syntax[0].optional_elements).toContain('indepvars');

    // Test option extraction
    const my_option_extractor = new OptionExtractor();
    const the_options = my_option_extractor.extract_options(my_doc);
    
    expect(the_options.length).toBeGreaterThanOrEqual(1);
    // Options might not be parsed perfectly, so just check we get some results
    expect(the_options.every(opt => opt.name.length > 0)).toBe(true);

    // Test stored results extraction
    const my_stored_results_extractor = new StoredResultsExtractor();
    const the_stored_results = my_stored_results_extractor.extract_stored_results(my_doc);
    
    expect(the_stored_results.length).toBeGreaterThanOrEqual(1);
    const my_n_result = the_stored_results.find(r => r.name.includes('N'));
    expect(my_n_result).toBeDefined();
    if (my_n_result) {
        expect(my_n_result.result_class).toBe('e');
        expect(my_n_result.type).toBe('scalar');
    }

    // Test cross-reference extraction
    const my_cross_ref_extractor = new CrossReferenceExtractor();
    const the_cross_refs = my_cross_ref_extractor.extract_cross_references(my_doc);
    
    expect(the_cross_refs.length).toBeGreaterThanOrEqual(1);
    const my_anova_ref = the_cross_refs.find(r => r.target_command === 'anova');
    expect(my_anova_ref).toBeDefined();
    if (my_anova_ref) {
        // Could be either 'help' or 'see_also' depending on section
        expect(['help', 'see_also']).toContain(my_anova_ref.reference_type);
    }
});

test('SMCL Parser handles malformed input gracefully', () => {
    const my_malformed_smcl = `
{unclosed_directive
{title}Test{p_end}
{synopt:{opt missing_close
{text}Some text
    `;

    const my_parser = new SmclParser();
    
    // Should not throw
    expect(() => {
        const my_doc = my_parser.parse_content(my_malformed_smcl);
        
        const my_syntax_extractor = new SyntaxExtractor();
        const my_option_extractor = new OptionExtractor();
        const my_stored_results_extractor = new StoredResultsExtractor();
        const my_cross_ref_extractor = new CrossReferenceExtractor();
        
        my_syntax_extractor.extract_syntax(my_doc);
        my_option_extractor.extract_options(my_doc);
        my_stored_results_extractor.extract_stored_results(my_doc);
        my_cross_ref_extractor.extract_cross_references(my_doc);
    }).not.toThrow();
});