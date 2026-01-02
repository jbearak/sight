import { CommandInfo } from './types';

/**
 * Add-on commands for popular Stata packages.
 * These are third-party commands commonly used in econometric analysis.
 */
export const ADDON_COMMANDS: CommandInfo[] = [
    // reghdfe package
    {
        name: 'reghdfe',
        min_abbreviation: 6,
        options: [
            { name: 'absorb', min_abbreviation: 6, has_argument: true },
            { name: 'cluster', min_abbreviation: 7, has_argument: true },
            { name: 'vce', min_abbreviation: 3, has_argument: true },
            { name: 'noabsorb', min_abbreviation: 8, has_argument: false },
            { name: 'nosample', min_abbreviation: 8, has_argument: false },
            { name: 'keepsingleton', min_abbreviation: 12, has_argument: false },
            { name: 'verbose', min_abbreviation: 7, has_argument: false },
        ],
        priority: 2,
    },
    {
        name: 'ivreghdfe',
        min_abbreviation: 8,
        options: [
            { name: 'absorb', min_abbreviation: 6, has_argument: true },
            { name: 'cluster', min_abbreviation: 7, has_argument: true },
            { name: 'vce', min_abbreviation: 3, has_argument: true },
            { name: 'first', min_abbreviation: 5, has_argument: false },
            { name: 'savefirst', min_abbreviation: 9, has_argument: false },
        ],
        priority: 2,
    },
    {
        name: 'ivreg2',
        min_abbreviation: 6,
        options: [
            { name: 'cluster', min_abbreviation: 7, has_argument: true },
            { name: 'robust', min_abbreviation: 6, has_argument: false },
            { name: 'first', min_abbreviation: 5, has_argument: false },
            { name: 'ffirst', min_abbreviation: 6, has_argument: false },
            { name: 'gmm2s', min_abbreviation: 5, has_argument: false },
            { name: 'liml', min_abbreviation: 4, has_argument: false },
        ],
        priority: 2,
    },

    // Output tables
    {
        name: 'outreg',
        min_abbreviation: 6,
        options: [
            { name: 'merge', min_abbreviation: 5, has_argument: false },
            { name: 'replace', min_abbreviation: 7, has_argument: false },
            { name: 'append', min_abbreviation: 6, has_argument: false },
            { name: 'se', min_abbreviation: 2, has_argument: false },
            { name: 'bdec', min_abbreviation: 4, has_argument: true },
            { name: 'tdec', min_abbreviation: 4, has_argument: true },
        ],
        priority: 3,
    },
    {
        name: 'outreg2',
        min_abbreviation: 7,
        options: [
            { name: 'replace', min_abbreviation: 7, has_argument: false },
            { name: 'append', min_abbreviation: 6, has_argument: false },
            { name: 'excel', min_abbreviation: 5, has_argument: false },
            { name: 'word', min_abbreviation: 4, has_argument: false },
            { name: 'tex', min_abbreviation: 3, has_argument: false },
            { name: 'dec', min_abbreviation: 3, has_argument: true },
            { name: 'bdec', min_abbreviation: 4, has_argument: true },
            { name: 'tdec', min_abbreviation: 4, has_argument: true },
            { name: 'label', min_abbreviation: 5, has_argument: false },
            { name: 'nocons', min_abbreviation: 6, has_argument: false },
        ],
        priority: 3,
    },

    // estout package
    {
        name: 'estout',
        min_abbreviation: 6,
        options: [
            { name: 'replace', min_abbreviation: 7, has_argument: false },
            { name: 'append', min_abbreviation: 6, has_argument: false },
            { name: 'cells', min_abbreviation: 5, has_argument: true },
            { name: 'stats', min_abbreviation: 5, has_argument: true },
            { name: 'keep', min_abbreviation: 4, has_argument: true },
            { name: 'drop', min_abbreviation: 4, has_argument: true },
            { name: 'order', min_abbreviation: 5, has_argument: true },
            { name: 'label', min_abbreviation: 5, has_argument: false },
            { name: 'modelwidth', min_abbreviation: 10, has_argument: true },
        ],
        priority: 2,
    },
    {
        name: 'esttab',
        min_abbreviation: 6,
        options: [
            { name: 'replace', min_abbreviation: 7, has_argument: false },
            { name: 'append', min_abbreviation: 6, has_argument: false },
            { name: 'csv', min_abbreviation: 3, has_argument: false },
            { name: 'rtf', min_abbreviation: 3, has_argument: false },
            { name: 'tex', min_abbreviation: 3, has_argument: false },
            { name: 'html', min_abbreviation: 4, has_argument: false },
            { name: 'label', min_abbreviation: 5, has_argument: false },
            { name: 'b', min_abbreviation: 1, has_argument: true },
            { name: 'se', min_abbreviation: 2, has_argument: true },
            { name: 't', min_abbreviation: 1, has_argument: true },
            { name: 'p', min_abbreviation: 1, has_argument: true },
            { name: 'star', min_abbreviation: 4, has_argument: true },
            { name: 'compress', min_abbreviation: 8, has_argument: false },
            { name: 'wide', min_abbreviation: 4, has_argument: false },
            { name: 'nogaps', min_abbreviation: 6, has_argument: false },
            { name: 'noobs', min_abbreviation: 5, has_argument: false },
        ],
        priority: 2,
    },
    {
        name: 'eststo',
        min_abbreviation: 6,
        options: [
            { name: 'clear', min_abbreviation: 5, has_argument: false },
            { name: 'drop', min_abbreviation: 4, has_argument: true },
            { name: 'title', min_abbreviation: 5, has_argument: true },
            { name: 'addnote', min_abbreviation: 7, has_argument: true },
        ],
        priority: 2,
    },
    {
        name: 'estadd',
        min_abbreviation: 6,
        options: [
            { name: 'replace', min_abbreviation: 7, has_argument: false },
        ],
        priority: 3,
    },
    {
        name: 'estpost',
        min_abbreviation: 7,
        options: [
            { name: 'listwise', min_abbreviation: 8, has_argument: false },
        ],
        priority: 3,
    },

    // gtools package
    {
        name: 'gcollapse',
        min_abbreviation: 9,
        options: [
            { name: 'by', min_abbreviation: 2, has_argument: true },
            { name: 'fast', min_abbreviation: 4, has_argument: false },
            { name: 'verbose', min_abbreviation: 7, has_argument: false },
        ],
        priority: 2,
    },
    {
        name: 'gcontract',
        min_abbreviation: 9,
        options: [
            { name: 'freq', min_abbreviation: 4, has_argument: true },
            { name: 'percent', min_abbreviation: 7, has_argument: true },
            { name: 'cfreq', min_abbreviation: 5, has_argument: true },
            { name: 'cpercent', min_abbreviation: 8, has_argument: true },
            { name: 'nomiss', min_abbreviation: 6, has_argument: false },
        ],
        priority: 3,
    },
    {
        name: 'gegen',
        min_abbreviation: 5,
        options: [
            { name: 'by', min_abbreviation: 2, has_argument: true },
            { name: 'replace', min_abbreviation: 7, has_argument: false },
        ],
        priority: 2,
    },
    {
        name: 'gisid',
        min_abbreviation: 5,
        options: [
            { name: 'sort', min_abbreviation: 4, has_argument: false },
            { name: 'missok', min_abbreviation: 6, has_argument: false },
            { name: 'verbose', min_abbreviation: 7, has_argument: false },
        ],
        priority: 3,
    },
    {
        name: 'glevelsof',
        min_abbreviation: 9,
        options: [
            { name: 'local', min_abbreviation: 5, has_argument: true },
            { name: 'missing', min_abbreviation: 7, has_argument: false },
            { name: 'separate', min_abbreviation: 8, has_argument: true },
            { name: 'clean', min_abbreviation: 5, has_argument: false },
        ],
        priority: 3,
    },
    {
        name: 'gquantiles',
        min_abbreviation: 10,
        options: [
            { name: 'by', min_abbreviation: 2, has_argument: true },
            { name: 'nquantiles', min_abbreviation: 10, has_argument: true },
            { name: 'quantiles', min_abbreviation: 9, has_argument: true },
            { name: 'cutpoints', min_abbreviation: 9, has_argument: true },
            { name: 'xtile', min_abbreviation: 5, has_argument: false },
            { name: 'pctile', min_abbreviation: 6, has_argument: false },
        ],
        priority: 3,
    },
    {
        name: 'ftools',
        min_abbreviation: 6,
        options: [
            { name: 'compile', min_abbreviation: 7, has_argument: false },
            { name: 'version', min_abbreviation: 7, has_argument: false },
        ],
        priority: 3,
    },
    {
        name: 'gtools',
        min_abbreviation: 6,
        options: [
            { name: 'upgrade', min_abbreviation: 7, has_argument: false },
            { name: 'install', min_abbreviation: 7, has_argument: false },
            { name: 'version', min_abbreviation: 7, has_argument: false },
        ],
        priority: 3,
    },

    // Visualization
    {
        name: 'binscatter',
        min_abbreviation: 10,
        options: [
            { name: 'by', min_abbreviation: 2, has_argument: true },
            { name: 'nquantiles', min_abbreviation: 10, has_argument: true },
            { name: 'line', min_abbreviation: 4, has_argument: true },
            { name: 'controls', min_abbreviation: 8, has_argument: true },
            { name: 'absorb', min_abbreviation: 6, has_argument: true },
            { name: 'reportreg', min_abbreviation: 9, has_argument: false },
            { name: 'savedata', min_abbreviation: 8, has_argument: true },
            { name: 'replace', min_abbreviation: 7, has_argument: false },
        ],
        priority: 2,
    },
    {
        name: 'coefplot',
        min_abbreviation: 8,
        options: [
            { name: 'keep', min_abbreviation: 4, has_argument: true },
            { name: 'drop', min_abbreviation: 4, has_argument: true },
            { name: 'order', min_abbreviation: 5, has_argument: true },
            { name: 'levels', min_abbreviation: 6, has_argument: true },
            { name: 'horizontal', min_abbreviation: 10, has_argument: false },
            { name: 'vertical', min_abbreviation: 8, has_argument: false },
            { name: 'xline', min_abbreviation: 5, has_argument: true },
            { name: 'yline', min_abbreviation: 5, has_argument: true },
            { name: 'xlabel', min_abbreviation: 6, has_argument: true },
            { name: 'ylabel', min_abbreviation: 6, has_argument: true },
            { name: 'title', min_abbreviation: 5, has_argument: true },
            { name: 'subtitle', min_abbreviation: 8, has_argument: true },
            { name: 'xtitle', min_abbreviation: 6, has_argument: true },
            { name: 'ytitle', min_abbreviation: 6, has_argument: true },
        ],
        priority: 2,
    },
];