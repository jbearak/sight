/**
 * Priority Tier Constants for Stata Commands
 *
 * Commands are categorized into three priority tiers for completion ordering:
 * - Tier 1: Core data manipulation and programming commands
 * - Tier 2: Common estimation, graphics, and extended I/O
 * - Tier 3: All other commands (default)
 */

/**
 * Tier 1 commands - Core data manipulation and programming.
 * These are the most frequently used commands in typical Stata workflows.
 */
export const TIER_1_COMMANDS: Set<string> = new Set([
    // Data manipulation
    'generate', 'replace', 'drop', 'keep', 'rename', 'sort', 'order',
    'merge', 'append', 'reshape', 'collapse', 'expand', 'contract',
    'encode', 'decode', 'destring', 'tostring', 'egen', 'recode',
    'label', 'notes',
    // Programming
    'local', 'global', 'scalar', 'matrix', 'display', 'capture',
    'quietly', 'noisily', 'return', 'program', 'end', 'if', 'else',
    'foreach', 'forvalues', 'while', 'continue', 'break', 'exit',
    'error', 'assert', 'confirm', 'do', 'run', 'include', 'unab',
    // Analysis
    'summarize', 'describe', 'list', 'tabulate', 'table', 'count',
    'codebook', 'inspect', 'compare',
    // I/O
    'use', 'save', 'clear', 'set', 'sysuse', 'webuse', 'input',
    'edit', 'browse',
]);

/**
 * Tier 2 commands - Common estimation, graphics, and extended I/O.
 * These are frequently used but less fundamental than Tier 1.
 */
export const TIER_2_COMMANDS: Set<string> = new Set([
    // Estimation
    'regress', 'logit', 'probit', 'logistic', 'ologit', 'oprobit',
    'mlogit', 'poisson', 'nbreg', 'tobit', 'ivregress', 'xtreg',
    'xtlogit', 'areg', 'rreg', 'qreg', 'xtset', 'tsset', 'predict',
    'margins', 'marginsplot', 'test', 'lincom', 'nlcom', 'contrast',
    'pwcompare', 'estimates', 'hausman', 'estat',
    // Graphics
    'graph', 'twoway', 'scatter', 'line', 'histogram', 'kdensity',
    'boxplot', 'bar', 'pie', 'dot',
    // I/O
    'import', 'export', 'insheet', 'outsheet', 'infile', 'outfile',
    'xmlsave', 'odbc', 'copy', 'type', 'log', 'cmdlog',
    // Data management
    'duplicates', 'isid', 'levelsof', 'distinct', 'fillin', 'cross',
    'stack', 'xpose', 'separate',
    // Popular addon commands - Tier 2
    'reghdfe', 'ivreghdfe', 'ivreg2', 'estout', 'esttab', 'eststo',
    'gcollapse', 'gegen', 'binscatter', 'coefplot',
]);

/**
 * Returns the priority tier for a command.
 *
 * @param name - The command name (case-insensitive)
 * @returns 1 for Tier 1 (highest priority), 2 for Tier 2, 3 for Tier 3 (lowest)
 * 
 * Note: Tier 3 addon commands include: outreg, outreg2, estadd, estpost,
 * gcontract, gisid, glevelsof, gquantiles, ftools, gtools
 */
export function get_command_priority(name: string): 1 | 2 | 3 {
    const lower_name = name.toLowerCase();
    if (TIER_1_COMMANDS.has(lower_name)) return 1;
    if (TIER_2_COMMANDS.has(lower_name)) return 2;
    return 3;
}
