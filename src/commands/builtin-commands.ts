/**
 * Built-in Stata Commands Database
 *
 * Contains metadata for common Stata commands including:
 * - Full command name
 * - Minimum abbreviation (documented shortest form)
 * - Syntax template
 * - Available options
 * - Subcommands (for prefix commands like frame, mi)
 * - Category
 */

import { CommandInfo, OptionInfo, SubcommandInfo } from '../types';

/**
 * Helper to create an OptionInfo object.
 */
function option(
    name: string,
    min_abbreviation: string,
    has_argument: boolean = false
): OptionInfo {
    return {
        name,
        minAbbreviation: min_abbreviation,
        hasArgument: has_argument,
    };
}

/**
 * Helper to create a SubcommandInfo object.
 */
function subcommand(name: string, min_abbreviation: string): SubcommandInfo {
    return { name, minAbbreviation: min_abbreviation };
}

/**
 * Helper to create a CommandInfo object for built-in commands.
 * The syntax parameter is optional - completions now show options instead.
 */
function builtin_command(
    name: string,
    min_abbreviation: string,
    syntax: string | undefined,
    category: string,
    options: OptionInfo[] = [],
    subcommands?: SubcommandInfo[]
): CommandInfo {
    return {
        name,
        minAbbreviation: min_abbreviation,
        syntax: syntax || undefined,
        options,
        subcommands,
        category,
        isBuiltin: true,
    };
}

/**
 * Data manipulation commands
 */
const DATA_MANIPULATION_COMMANDS: CommandInfo[] = [
    builtin_command(
        'generate',
        'gen',
        'generate [type] newvar[:lblname] =exp [if] [in]',
        'data_manipulation',
        [
            option('after', 'after', true),
            option('before', 'before', true),
        ]
    ),
    builtin_command(
        'replace',
        'replace',
        'replace oldvar =exp [if] [in] [, nopromote]',
        'data_manipulation',
        [option('nopromote', 'nopromote')]
    ),
    builtin_command(
        'drop',
        'drop',
        'drop varlist | drop if exp | drop in range',
        'data_manipulation'
    ),
    builtin_command(
        'keep',
        'keep',
        'keep varlist | keep if exp | keep in range',
        'data_manipulation'
    ),
    builtin_command(
        'rename',
        'rename',
        'rename old_name new_name',
        'data_manipulation',
        [
            option('addnumber', 'addn', true),
            option('renumber', 'renum', true),
            option('sort', 'sort'),
            option('dryrun', 'dry'),
            option('upper', 'up'),
            option('lower', 'low'),
            option('proper', 'prop'),
        ]
    ),
    builtin_command(
        'sort',
        'sort',
        'sort varlist [, stable]',
        'data_manipulation',
        [option('stable', 'stable')]
    ),
    builtin_command(
        'gsort',
        'gsort',
        'gsort [+|-]varname [[+|-]varname ...] [, generate(newvar) mfirst]',
        'data_manipulation',
        [
            option('generate', 'gen', true),
            option('mfirst', 'mfirst'),
        ]
    ),
    builtin_command(
        'order',
        'order',
        'order varlist [, first last before(varname) after(varname) alphabetic sequential]',
        'data_manipulation',
        [
            option('first', 'first'),
            option('last', 'last'),
            option('before', 'before', true),
            option('after', 'after', true),
            option('alphabetic', 'alpha'),
            option('sequential', 'seq'),
        ]
    ),
    builtin_command(
        'encode',
        'encode',
        'encode varname [if] [in], generate(newvar) [label(name) noextend]',
        'data_manipulation',
        [
            option('generate', 'gen', true),
            option('label', 'label', true),
            option('noextend', 'noextend'),
        ]
    ),
    builtin_command(
        'decode',
        'decode',
        'decode varname [if] [in], generate(newvar) [maxlength(#)]',
        'data_manipulation',
        [
            option('generate', 'gen', true),
            option('maxlength', 'maxl', true),
        ]
    ),
    builtin_command(
        'destring',
        'destring',
        'destring varlist, {generate(newvarlist)|replace} [ignore("chars") force float percent dpcomma]',
        'data_manipulation',
        [
            option('generate', 'gen', true),
            option('replace', 'replace'),
            option('ignore', 'ignore', true),
            option('force', 'force'),
            option('float', 'float'),
            option('percent', 'percent'),
            option('dpcomma', 'dpcomma'),
        ]
    ),
    builtin_command(
        'tostring',
        'tostring',
        'tostring varlist, {generate(newvarlist)|replace} [format(fmt) force usedisplayformat]',
        'data_manipulation',
        [
            option('generate', 'gen', true),
            option('replace', 'replace'),
            option('format', 'format', true),
            option('force', 'force'),
            option('usedisplayformat', 'usedisplay'),
        ]
    ),
    builtin_command(
        'egen',
        'egen',
        'egen [type] newvar = fcn(arguments) [if] [in] [, options]',
        'data_manipulation',
        [option('by', 'by', true)]
    ),
    builtin_command(
        'collapse',
        'collapse',
        'collapse (stat) varlist [if] [in] [weight] [, by(varlist) cw fast]',
        'data_manipulation',
        [
            option('by', 'by', true),
            option('cw', 'cw'),
            option('fast', 'fast'),
        ]
    ),
    builtin_command(
        'reshape',
        'reshape',
        'reshape wide|long stubnames, i(varlist) j(varname)',
        'data_manipulation',
        [
            option('i', 'i', true),
            option('j', 'j', true),
            option('string', 'string'),
        ]
    ),
    builtin_command(
        'merge',
        'merge',
        'merge 1:1|1:m|m:1|m:m varlist using filename [, options]',
        'data_manipulation',
        [
            option('keep', 'keep', true),
            option('keepusing', 'keepusing', true),
            option('generate', 'gen', true),
            option('nogenerate', 'nogen'),
            option('nolabel', 'nolabel'),
            option('nonotes', 'nonotes'),
            option('update', 'update'),
            option('replace', 'replace'),
            option('noreport', 'norep'),
            option('force', 'force'),
            option('assert', 'assert', true),
        ]
    ),
    builtin_command(
        'append',
        'append',
        'append using filename [, options]',
        'data_manipulation',
        [
            option('generate', 'gen', true),
            option('keep', 'keep', true),
            option('nolabel', 'nolabel'),
            option('nonotes', 'nonotes'),
            option('force', 'force'),
        ]
    ),
];

/**
 * Statistical commands
 */
const STATISTICS_COMMANDS: CommandInfo[] = [
    builtin_command(
        'summarize',
        'sum',
        'summarize [varlist] [if] [in] [weight] [, options]',
        'statistics',
        [
            option('detail', 'd'),
            option('meanonly', 'mean'),
            option('format', 'f'),
            option('separator', 'sep', true),
        ]
    ),
    builtin_command(
        'tabulate',
        'tab',
        'tabulate varname [if] [in] [weight] [, options]',
        'statistics',
        [
            option('missing', 'miss'),
            option('nolabel', 'nol'),
            option('plot', 'plot'),
            option('sort', 'sort'),
            option('generate', 'gen', true),
            option('matcell', 'matcell', true),
            option('matrow', 'matrow', true),
            option('subpop', 'subpop', true),
        ]
    ),
    builtin_command(
        'correlate',
        'cor',
        'correlate [varlist] [if] [in] [weight] [, covariance means wrap]',
        'statistics',
        [
            option('covariance', 'cov'),
            option('means', 'means'),
            option('wrap', 'wrap'),
        ]
    ),
    builtin_command(
        'pwcorr',
        'pwcorr',
        'pwcorr [varlist] [if] [in] [weight] [, options]',
        'statistics',
        [
            option('obs', 'obs'),
            option('sig', 'sig'),
            option('star', 'star', true),
            option('bonferroni', 'bonf'),
            option('sidak', 'sidak'),
            option('print', 'print', true),
            option('listwise', 'list'),
        ]
    ),
    builtin_command(
        'ttest',
        'ttest',
        'ttest varname == # [if] [in] [, level(#)]',
        'statistics',
        [
            option('by', 'by', true),
            option('unpaired', 'unp'),
            option('unequal', 'une'),
            option('welch', 'welch'),
            option('level', 'level', true),
        ]
    ),
    builtin_command(
        'anova',
        'anova',
        'anova depvar [termlist] [if] [in] [weight] [, options]',
        'statistics',
        [
            option('repeated', 'rep', true),
            option('partial', 'partial'),
            option('sequential', 'seq'),
            option('regress', 'reg'),
        ]
    ),
    builtin_command(
        'mean',
        'mean',
        'mean varlist [if] [in] [weight] [, options]',
        'statistics',
        [
            option('over', 'over', true),
            option('level', 'level', true),
            option('cluster', 'cluster', true),
        ]
    ),
    builtin_command(
        'proportion',
        'proportion',
        'proportion varlist [if] [in] [weight] [, options]',
        'statistics',
        [
            option('over', 'over', true),
            option('level', 'level', true),
            option('missing', 'miss'),
        ]
    ),
    builtin_command(
        'total',
        'total',
        'total varlist [if] [in] [weight] [, options]',
        'statistics',
        [
            option('over', 'over', true),
            option('level', 'level', true),
        ]
    ),
    builtin_command(
        'ratio',
        'ratio',
        'ratio (name: varname/varname) [if] [in] [weight] [, options]',
        'statistics',
        [
            option('over', 'over', true),
            option('level', 'level', true),
        ]
    ),
];

/**
 * Regression commands
 */
const REGRESSION_COMMANDS: CommandInfo[] = [
    builtin_command(
        'regress',
        'reg',
        'regress depvar [indepvars] [if] [in] [weight] [, options]',
        'regression',
        [
            option('noconstant', 'nocons'),
            option('hascons', 'hascons'),
            option('tsscons', 'tsscons'),
            option('vce', 'vce', true),
            option('level', 'level', true),
            option('beta', 'beta'),
            option('eform', 'eform', true),
            option('depname', 'depname', true),
            option('mse1', 'mse1'),
            option('plus', 'plus'),
            option('coeflegend', 'coefl'),
        ]
    ),
    builtin_command(
        'logit',
        'logit',
        'logit depvar [indepvars] [if] [in] [weight] [, options]',
        'regression',
        [
            option('noconstant', 'nocons'),
            option('vce', 'vce', true),
            option('level', 'level', true),
            option('or', 'or'),
            option('asis', 'asis'),
            option('offset', 'offset', true),
            option('constraints', 'const', true),
            option('coeflegend', 'coefl'),
        ]
    ),
    builtin_command(
        'logistic',
        'logistic',
        'logistic depvar [indepvars] [if] [in] [weight] [, options]',
        'regression',
        [
            option('noconstant', 'nocons'),
            option('vce', 'vce', true),
            option('level', 'level', true),
            option('coef', 'coef'),
            option('asis', 'asis'),
            option('offset', 'offset', true),
            option('constraints', 'const', true),
            option('coeflegend', 'coefl'),
        ]
    ),
    builtin_command(
        'probit',
        'probit',
        'probit depvar [indepvars] [if] [in] [weight] [, options]',
        'regression',
        [
            option('noconstant', 'nocons'),
            option('vce', 'vce', true),
            option('level', 'level', true),
            option('asis', 'asis'),
            option('offset', 'offset', true),
            option('constraints', 'const', true),
            option('coeflegend', 'coefl'),
        ]
    ),
    builtin_command(
        'poisson',
        'poisson',
        'poisson depvar [indepvars] [if] [in] [weight] [, options]',
        'regression',
        [
            option('noconstant', 'nocons'),
            option('vce', 'vce', true),
            option('level', 'level', true),
            option('exposure', 'exp', true),
            option('offset', 'offset', true),
            option('irr', 'irr'),
            option('constraints', 'const', true),
            option('coeflegend', 'coefl'),
        ]
    ),
    builtin_command(
        'nbreg',
        'nbreg',
        'nbreg depvar [indepvars] [if] [in] [weight] [, options]',
        'regression',
        [
            option('noconstant', 'nocons'),
            option('vce', 'vce', true),
            option('level', 'level', true),
            option('exposure', 'exp', true),
            option('offset', 'offset', true),
            option('irr', 'irr'),
            option('dispersion', 'disp', true),
            option('constraints', 'const', true),
        ]
    ),
    builtin_command(
        'ologit',
        'ologit',
        'ologit depvar [indepvars] [if] [in] [weight] [, options]',
        'regression',
        [
            option('vce', 'vce', true),
            option('level', 'level', true),
            option('or', 'or'),
            option('offset', 'offset', true),
            option('constraints', 'const', true),
        ]
    ),
    builtin_command(
        'oprobit',
        'oprobit',
        'oprobit depvar [indepvars] [if] [in] [weight] [, options]',
        'regression',
        [
            option('vce', 'vce', true),
            option('level', 'level', true),
            option('offset', 'offset', true),
            option('constraints', 'const', true),
        ]
    ),
    builtin_command(
        'mlogit',
        'mlogit',
        'mlogit depvar [indepvars] [if] [in] [weight] [, options]',
        'regression',
        [
            option('noconstant', 'nocons'),
            option('vce', 'vce', true),
            option('level', 'level', true),
            option('baseoutcome', 'base', true),
            option('rrr', 'rrr'),
            option('constraints', 'const', true),
        ]
    ),
    builtin_command(
        'tobit',
        'tobit',
        'tobit depvar [indepvars] [if] [in] [weight] [, ll[(#)] ul[(#)] options]',
        'regression',
        [
            option('ll', 'll', true),
            option('ul', 'ul', true),
            option('noconstant', 'nocons'),
            option('vce', 'vce', true),
            option('level', 'level', true),
            option('offset', 'offset', true),
        ]
    ),
    builtin_command(
        'ivregress',
        'ivreg',
        'ivregress estimator depvar [varlist1] (varlist2 = varlist_iv) [if] [in] [weight] [, options]',
        'regression',
        [
            option('noconstant', 'nocons'),
            option('vce', 'vce', true),
            option('level', 'level', true),
            option('first', 'first'),
            option('small', 'small'),
            option('perfect', 'perfect'),
        ]
    ),
    builtin_command(
        'xtreg',
        'xtreg',
        'xtreg depvar [indepvars] [if] [in] [, fe|re|be|mle|pa options]',
        'regression',
        [
            option('fe', 'fe'),
            option('re', 're'),
            option('be', 'be'),
            option('mle', 'mle'),
            option('pa', 'pa'),
            option('vce', 'vce', true),
            option('level', 'level', true),
            option('theta', 'theta'),
        ]
    ),
    builtin_command(
        'areg',
        'areg',
        'areg depvar [indepvars] [if] [in] [weight], absorb(varname) [options]',
        'regression',
        [
            option('absorb', 'absorb', true),
            option('vce', 'vce', true),
            option('level', 'level', true),
        ]
    ),
];


/**
 * File I/O commands
 */
const FILE_IO_COMMANDS: CommandInfo[] = [
    builtin_command(
        'use',
        'use',
        'use [varlist] [if] [in] using filename [, clear nolabel]',
        'file_io',
        [
            option('clear', 'clear'),
            option('nolabel', 'nolabel'),
        ]
    ),
    builtin_command(
        'save',
        'save',
        'save [filename] [, replace nolabel orphans all emptyok]',
        'file_io',
        [
            option('replace', 'replace'),
            option('nolabel', 'nolabel'),
            option('orphans', 'orphans'),
            option('all', 'all'),
            option('emptyok', 'emptyok'),
        ]
    ),
    builtin_command(
        'import',
        'import',
        'import delimited [using] filename [, options]',
        'file_io',
        [
            option('clear', 'clear'),
            option('delimiter', 'delim', true),
            option('varnames', 'varnames', true),
            option('case', 'case', true),
            option('encoding', 'encoding', true),
            option('stringcols', 'stringcols', true),
            option('numericcols', 'numericcols', true),
        ]
    ),
    builtin_command(
        'export',
        'export',
        'export delimited [varlist] using filename [, options]',
        'file_io',
        [
            option('replace', 'replace'),
            option('delimiter', 'delim', true),
            option('novarnames', 'novarnames'),
            option('nolabel', 'nolabel'),
            option('quote', 'quote'),
            option('datafmt', 'datafmt'),
        ]
    ),
    builtin_command(
        'insheet',
        'insheet',
        'insheet [varlist] using filename [, options]',
        'file_io',
        [
            option('clear', 'clear'),
            option('tab', 'tab'),
            option('comma', 'comma'),
            option('delimiter', 'delim', true),
            option('names', 'names'),
            option('nonames', 'nonames'),
            option('double', 'double'),
            option('case', 'case'),
        ]
    ),
    builtin_command(
        'outsheet',
        'outsheet',
        'outsheet [varlist] using filename [, options]',
        'file_io',
        [
            option('replace', 'replace'),
            option('comma', 'comma'),
            option('delimiter', 'delim', true),
            option('nonames', 'nonames'),
            option('nolabel', 'nolabel'),
            option('noquote', 'noquote'),
        ]
    ),
    builtin_command(
        'infile',
        'infile',
        'infile [varlist] using filename [, options]',
        'file_io',
        [
            option('clear', 'clear'),
            option('automatic', 'auto'),
        ]
    ),
    builtin_command(
        'input',
        'input',
        'input [varlist] [, automatic label]',
        'file_io',
        [
            option('automatic', 'auto'),
            option('label', 'label'),
        ]
    ),
    builtin_command(
        'clear',
        'clear',
        'clear [all|results|mata|matrix|programs|ado|rngstate]',
        'file_io'
    ),
    builtin_command(
        'describe',
        'des',
        'describe [varlist] [, short detail fullnames numbers]',
        'file_io',
        [
            option('short', 'short'),
            option('detail', 'd'),
            option('fullnames', 'full'),
            option('numbers', 'numbers'),
            option('simple', 'simple'),
        ]
    ),
    builtin_command(
        'list',
        'list',
        'list [varlist] [if] [in] [, options]',
        'file_io',
        [
            option('noobs', 'noobs'),
            option('nolabel', 'nolabel'),
            option('clean', 'clean'),
            option('separator', 'sep', true),
            option('abbreviate', 'abb', true),
            option('string', 'string', true),
            option('table', 'table'),
            option('divider', 'divider'),
            option('header', 'header', true),
            option('noheader', 'noheader'),
        ]
    ),
    builtin_command(
        'codebook',
        'codebook',
        'codebook [varlist] [if] [in] [, options]',
        'file_io',
        [
            option('all', 'all'),
            option('header', 'header'),
            option('notes', 'notes'),
            option('mv', 'mv'),
            option('tabulate', 'tab', true),
            option('problems', 'problems'),
            option('detail', 'd'),
            option('compact', 'compact'),
        ]
    ),
    builtin_command(
        'file',
        'fi',
        'file subcommand handle [arguments]',
        'file_io',
        [],
        [
            subcommand('open', 'o'),
            subcommand('read', 'r'),
            subcommand('write', 'w'),
            subcommand('close', 'c'),
            subcommand('seek', 'see'),
            subcommand('query', 'q'),
            subcommand('set', 'set'),
        ]
    ),
];

/**
 * Programming commands
 */
const PROGRAMMING_COMMANDS: CommandInfo[] = [
    builtin_command(
        'program',
        'program',
        'program [define] progname [, options]',
        'programming',
        [
            option('nclass', 'nclass'),
            option('rclass', 'rclass'),
            option('eclass', 'eclass'),
            option('sclass', 'sclass'),
            option('sortpreserve', 'sortpreserve'),
            option('byable', 'byable', true),
            option('properties', 'properties', true),
        ]
    ),
    builtin_command(
        'local',
        'local',
        'local macname [= exp | : extended_fcn | `"string"` | "string"]',
        'programming'
    ),
    builtin_command(
        'global',
        'global',
        'global macname [= exp | : extended_fcn | `"string"` | "string"]',
        'programming'
    ),
    builtin_command(
        'tempvar',
        'tempvar',
        'tempvar name [name ...]',
        'programming'
    ),
    builtin_command(
        'tempname',
        'tempname',
        'tempname name [name ...]',
        'programming'
    ),
    builtin_command(
        'tempfile',
        'tempfile',
        'tempfile name [name ...]',
        'programming'
    ),
    builtin_command(
        'return',
        'return',
        'return local|scalar|matrix name [= exp]',
        'programming',
        [
            option('local', 'local'),
            option('scalar', 'scalar'),
            option('matrix', 'matrix'),
            option('add', 'add'),
            option('clear', 'clear'),
        ]
    ),
    builtin_command(
        'ereturn',
        'ereturn',
        'ereturn local|scalar|matrix name [= exp]',
        'programming',
        [
            option('local', 'local'),
            option('scalar', 'scalar'),
            option('matrix', 'matrix'),
            option('post', 'post'),
            option('clear', 'clear'),
            option('repost', 'repost'),
        ]
    ),
    builtin_command(
        'capture',
        'capture',
        'capture [:] command',
        'programming',
        [option('noisily', 'noisily')]
    ),
    builtin_command(
        'quietly',
        'qui',
        'quietly [:] command',
        'programming',
        [option('noisily', 'noisily')]
    ),
    builtin_command(
        'noisily',
        'noisily',
        'noisily [:] command',
        'programming'
    ),
    builtin_command(
        'display',
        'di',
        'display [display_directive [display_directive [...]]]',
        'programming',
        [
            option('newline', 'newline', true),
            option('skip', 'skip', true),
            option('column', 'column', true),
            option('continue', 'continue'),
            option('request', 'request', true),
        ]
    ),
    builtin_command(
        'assert',
        'assert',
        'assert exp [if] [in] [, fast null rc0]',
        'programming',
        [
            option('fast', 'fast'),
            option('null', 'null'),
            option('rc0', 'rc0'),
        ]
    ),
    builtin_command(
        'confirm',
        'confirm',
        'confirm [existence|new|numeric|string|date|format|names|number|integer|file|variable] ...',
        'programming'
    ),
    builtin_command(
        'error',
        'error',
        'error # [, message("text")]',
        'programming',
        [option('message', 'message', true)]
    ),
    builtin_command(
        'exit',
        'exit',
        'exit [#] [, clear STATA]',
        'programming',
        [
            option('clear', 'clear'),
            option('STATA', 'STATA'),
        ]
    ),
    builtin_command(
        'foreach',
        'foreach',
        'foreach lname in|of list { ... }',
        'programming'
    ),
    builtin_command(
        'forvalues',
        'forv',
        'forvalues lname = range { ... }',
        'programming'
    ),
    builtin_command(
        'while',
        'while',
        'while exp { ... }',
        'programming'
    ),
    builtin_command(
        'if',
        'if',
        'if exp { ... }',
        'programming'
    ),
    builtin_command(
        'else',
        'else',
        'else { ... }',
        'programming'
    ),
    builtin_command(
        'continue',
        'continue',
        'continue [, break]',
        'programming',
        [option('break', 'break')]
    ),
    builtin_command(
        'do',
        'do',
        'do filename [arguments] [, nostop]',
        'programming',
        [option('nostop', 'nostop')]
    ),
    builtin_command(
        'run',
        'run',
        'run filename [arguments]',
        'programming'
    ),
    builtin_command(
        'include',
        'include',
        'include filename',
        'programming'
    ),
    builtin_command(
        'syntax',
        'syntax',
        'syntax [varlist] [if] [in] [using] [= exp] [weight] [, options]',
        'programming'
    ),
    builtin_command(
        'args',
        'args',
        'args macname [macname ...]',
        'programming'
    ),
    builtin_command(
        'gettoken',
        'gettok',
        'gettoken macname1 [macname2] : macname3 [, options]',
        'programming',
        [
            option('parse', 'parse', true),
            option('quotes', 'quotes'),
            option('qed', 'qed', true),
            option('match', 'match', true),
            option('bind', 'bind'),
        ]
    ),
    builtin_command(
        'tokenize',
        'tokenize',
        'tokenize [string] [, parse("pchars")]',
        'programming',
        [option('parse', 'parse', true)]
    ),
    builtin_command(
        'version',
        'version',
        'version [#[.#[.#]]] [:] [command]',
        'programming'
    ),
    builtin_command(
        'set',
        'set',
        'set setname [value] [, permanently]',
        'programming',
        [option('permanently', 'perm')]
    ),
    builtin_command(
        'scalar',
        'scalar',
        'scalar [define] name = exp',
        'programming'
    ),
    builtin_command(
        'matrix',
        'matrix',
        'matrix [define] name = matrix_exp',
        'programming'
    ),
    builtin_command(
        'macro',
        'macro',
        'macro dir|list|drop macname',
        'programming'
    ),
    builtin_command(
        'timer',
        'timer',
        'timer on|off|clear|list #',
        'programming'
    ),
    builtin_command(
        'preserve',
        'preserve',
        'preserve',
        'programming'
    ),
    builtin_command(
        'restore',
        'restore',
        'restore [, not preserve]',
        'programming',
        [
            option('not', 'not'),
            option('preserve', 'preserve'),
        ]
    ),
];


/**
 * Graphics commands
 */
const GRAPHICS_COMMANDS: CommandInfo[] = [
    builtin_command(
        'graph',
        'graph',
        'graph [graphtype] [varlist] [if] [in] [weight] [, options]',
        'graphics',
        [
            option('title', 'title', true),
            option('subtitle', 'subtitle', true),
            option('note', 'note', true),
            option('caption', 'caption', true),
            option('legend', 'legend', true),
            option('scheme', 'scheme', true),
            option('name', 'name', true),
            option('saving', 'saving', true),
        ]
    ),
    builtin_command(
        'scatter',
        'scatter',
        'scatter yvar xvar [if] [in] [weight] [, options]',
        'graphics',
        [
            option('msymbol', 'msymbol', true),
            option('mcolor', 'mcolor', true),
            option('msize', 'msize', true),
            option('mlabel', 'mlabel', true),
            option('connect', 'connect', true),
            option('sort', 'sort'),
        ]
    ),
    builtin_command(
        'twoway',
        'twoway',
        'twoway (plottype ...) [, options]',
        'graphics',
        [
            option('title', 'title', true),
            option('subtitle', 'subtitle', true),
            option('legend', 'legend', true),
            option('by', 'by', true),
            option('xlabel', 'xlabel', true),
            option('ylabel', 'ylabel', true),
            option('xtitle', 'xtitle', true),
            option('ytitle', 'ytitle', true),
            option('xscale', 'xscale', true),
            option('yscale', 'yscale', true),
            option('scheme', 'scheme', true),
            option('name', 'name', true),
            option('saving', 'saving', true),
        ]
    ),
    builtin_command(
        'histogram',
        'hist',
        'histogram varname [if] [in] [weight] [, options]',
        'graphics',
        [
            option('discrete', 'discrete'),
            option('frequency', 'freq'),
            option('percent', 'percent'),
            option('fraction', 'frac'),
            option('density', 'density'),
            option('bin', 'bin', true),
            option('width', 'width', true),
            option('start', 'start', true),
            option('normal', 'normal'),
            option('kdensity', 'kdensity'),
            option('addlabels', 'addlabels'),
            option('gap', 'gap', true),
            option('barwidth', 'barwidth', true),
            option('color', 'color', true),
        ]
    ),
    builtin_command(
        'kdensity',
        'kdensity',
        'kdensity varname [if] [in] [weight] [, options]',
        'graphics',
        [
            option('kernel', 'kernel', true),
            option('bwidth', 'bwidth', true),
            option('generate', 'gen', true),
            option('n', 'n', true),
            option('at', 'at', true),
            option('nograph', 'nograph'),
            option('normal', 'normal'),
        ]
    ),
    builtin_command(
        'line',
        'line',
        'line yvar xvar [if] [in] [, options]',
        'graphics',
        [
            option('sort', 'sort'),
            option('connect', 'connect', true),
            option('lpattern', 'lpattern', true),
            option('lwidth', 'lwidth', true),
            option('lcolor', 'lcolor', true),
        ]
    ),
    builtin_command(
        'bar',
        'bar',
        'graph bar (stat) varlist [if] [in] [weight] [, options]',
        'graphics',
        [
            option('over', 'over', true),
            option('stack', 'stack'),
            option('percent', 'percent'),
            option('asyvars', 'asyvars'),
            option('bar', 'bar', true),
            option('blabel', 'blabel', true),
            option('bargap', 'bargap', true),
            option('outergap', 'outergap', true),
        ]
    ),
];

/**
 * Label commands
 */
const LABEL_COMMANDS: CommandInfo[] = [
    builtin_command(
        'label',
        'label',
        'label define|values|variable|data|drop|dir|list|copy|save|language ...',
        'labels',
        [
            option('add', 'add'),
            option('modify', 'modify'),
            option('replace', 'replace'),
            option('nofix', 'nofix'),
        ]
    ),
    builtin_command(
        'notes',
        'notes',
        'notes [varname] [: text]',
        'labels'
    ),
    builtin_command(
        'char',
        'char',
        'char [varname[charname]] [text]',
        'labels'
    ),
];

/**
 * Estimation post-processing commands
 */
const ESTIMATION_COMMANDS: CommandInfo[] = [
    builtin_command(
        'predict',
        'predict',
        'predict [type] newvar [if] [in] [, statistic options]',
        'estimation',
        [
            option('xb', 'xb'),
            option('stdp', 'stdp'),
            option('residuals', 'resid'),
            option('pr', 'pr', true),
            option('scores', 'scores'),
        ]
    ),
    builtin_command(
        'margins',
        'margins',
        'margins [marginlist] [if] [in] [weight] [, options]',
        'estimation',
        [
            option('at', 'at', true),
            option('over', 'over', true),
            option('dydx', 'dydx', true),
            option('eyex', 'eyex', true),
            option('eydx', 'eydx', true),
            option('dyex', 'dyex', true),
            option('atmeans', 'atmeans'),
            option('asbalanced', 'asbalanced'),
            option('asobserved', 'asobserved'),
            option('vce', 'vce', true),
            option('level', 'level', true),
            option('post', 'post'),
            option('noestimcheck', 'noestimcheck'),
        ]
    ),
    builtin_command(
        'test',
        'test',
        'test coeflist [, options]',
        'estimation',
        [
            option('accumulate', 'accum'),
            option('notest', 'notest'),
            option('mtest', 'mtest', true),
            option('coef', 'coef'),
            option('common', 'common'),
            option('constant', 'constant'),
        ]
    ),
    builtin_command(
        'testnl',
        'testnl',
        'testnl exp = exp [= exp ...] [, options]',
        'estimation',
        [
            option('mtest', 'mtest', true),
            option('iterate', 'iterate', true),
        ]
    ),
    builtin_command(
        'lincom',
        'lincom',
        'lincom exp [, options]',
        'estimation',
        [
            option('level', 'level', true),
            option('eform', 'eform', true),
            option('or', 'or'),
            option('hr', 'hr'),
            option('irr', 'irr'),
            option('rrr', 'rrr'),
        ]
    ),
    builtin_command(
        'nlcom',
        'nlcom',
        'nlcom exp [, options]',
        'estimation',
        [
            option('level', 'level', true),
            option('iterate', 'iterate', true),
            option('post', 'post'),
        ]
    ),
    builtin_command(
        'estimates',
        'estimates',
        'estimates store|restore|drop|dir|describe|replay|table|stats|for|notes|query|save|use name',
        'estimation'
    ),
    builtin_command(
        'estat',
        'estat',
        'estat subcommand [, options]',
        'estimation'
    ),
    builtin_command(
        'hausman',
        'hausman',
        'hausman name [name] [, options]',
        'estimation',
        [
            option('constant', 'constant'),
            option('alleqs', 'alleqs'),
            option('equations', 'equations', true),
            option('sigmamore', 'sigmamore'),
            option('sigmaless', 'sigmaless'),
            option('force', 'force'),
        ]
    ),
    builtin_command(
        'lrtest',
        'lrtest',
        'lrtest modelspec1 [modelspec2] [, options]',
        'estimation',
        [
            option('stats', 'stats'),
            option('dir', 'dir'),
            option('force', 'force'),
        ]
    ),
];

/**
 * Utility commands
 */
const UTILITY_COMMANDS: CommandInfo[] = [
    builtin_command(
        'help',
        'help',
        'help [command_or_topic_name] [, nonew name(viewername) marker(markername)]',
        'utility',
        [
            option('nonew', 'nonew'),
            option('name', 'name', true),
            option('marker', 'marker', true),
        ]
    ),
    builtin_command(
        'search',
        'search',
        'search word [word ...] [, options]',
        'utility',
        [
            option('all', 'all'),
            option('local', 'local'),
            option('net', 'net'),
            option('manual', 'manual'),
            option('faq', 'faq'),
            option('historical', 'historical'),
            option('author', 'author'),
            option('entry', 'entry'),
        ]
    ),
    builtin_command(
        'findit',
        'findit',
        'findit word [word ...]',
        'utility'
    ),
    builtin_command(
        'which',
        'which',
        'which filename [, all]',
        'utility',
        [option('all', 'all')]
    ),
    builtin_command(
        'about',
        'about',
        'about',
        'utility'
    ),
    builtin_command(
        'query',
        'query',
        'query [memory|output|interface|graphics|efficiency|network|update|mata|trace|lapack|rng|sort|unicode|java|python|other]',
        'utility'
    ),
    builtin_command(
        'creturn',
        'creturn',
        'creturn list',
        'utility'
    ),
    builtin_command(
        'sysdir',
        'sysdir',
        'sysdir [list|set dirname "path"]',
        'utility'
    ),
    builtin_command(
        'adopath',
        'adopath',
        'adopath [+ dirname ["path"] | - dirname | ++ dirname ["path"]]',
        'utility'
    ),
    builtin_command(
        'pwd',
        'pwd',
        'pwd',
        'utility'
    ),
    builtin_command(
        'cd',
        'cd',
        'cd ["dirname"]',
        'utility'
    ),
    builtin_command(
        'mkdir',
        'mkdir',
        'mkdir "dirname" [, public]',
        'utility',
        [option('public', 'public')]
    ),
    builtin_command(
        'rmdir',
        'rmdir',
        'rmdir "dirname"',
        'utility'
    ),
    builtin_command(
        'dir',
        'dir',
        'dir ["filespec"] [, wide]',
        'utility',
        [option('wide', 'wide')]
    ),
    builtin_command(
        'copy',
        'copy',
        'copy "filename1" "filename2" [, public replace]',
        'utility',
        [
            option('public', 'public'),
            option('replace', 'replace'),
        ]
    ),
    builtin_command(
        'erase',
        'erase',
        'erase "filename"',
        'utility'
    ),
    builtin_command(
        'type',
        'type',
        'type "filename" [, asis starbang]',
        'utility',
        [
            option('asis', 'asis'),
            option('starbang', 'starbang'),
        ]
    ),
    builtin_command(
        'log',
        'log',
        'log using filename [, append replace text smcl name(logname)]',
        'utility',
        [
            option('append', 'append'),
            option('replace', 'replace'),
            option('text', 'text'),
            option('smcl', 'smcl'),
            option('name', 'name', true),
        ]
    ),
    builtin_command(
        'cmdlog',
        'cmdlog',
        'cmdlog using filename [, append replace]',
        'utility',
        [
            option('append', 'append'),
            option('replace', 'replace'),
        ]
    ),
    builtin_command(
        'translate',
        'translate',
        'translate filename1 filename2 [, options]',
        'utility',
        [
            option('replace', 'replace'),
            option('translator', 'translator', true),
        ]
    ),
    builtin_command(
        'compress',
        'compress',
        'compress [varlist]',
        'utility'
    ),
    builtin_command(
        'recast',
        'recast',
        'recast type varlist [, force]',
        'utility',
        [option('force', 'force')]
    ),
    builtin_command(
        'memory',
        'memory',
        'memory',
        'utility'
    ),
];

/**
 * Prefix commands (used before other commands)
 */
const PREFIX_COMMANDS: CommandInfo[] = [
    builtin_command(
        'by',
        'by',
        'by varlist: command',
        'prefix',
        [
            option('sort', 'sort'),
            option('rc0', 'rc0'),
        ]
    ),
    builtin_command(
        'bysort',
        'bysort',
        'bysort varlist: command',
        'prefix'
    ),
    builtin_command(
        'statsby',
        'statsby',
        'statsby [exp_list], by(varlist) [options]: command',
        'prefix',
        [
            option('by', 'by', true),
            option('clear', 'clear'),
            option('saving', 'saving', true),
            option('total', 'total'),
            option('subsets', 'subsets'),
            option('nodots', 'nodots'),
            option('noisily', 'noisily'),
        ]
    ),
    builtin_command(
        'rolling',
        'rolling',
        'rolling [exp_list], window(#) [options]: command',
        'prefix',
        [
            option('window', 'window', true),
            option('clear', 'clear'),
            option('saving', 'saving', true),
            option('start', 'start', true),
            option('end', 'end', true),
            option('recursive', 'recursive'),
            option('rrecursive', 'rrecursive'),
            option('nodots', 'nodots'),
            option('noisily', 'noisily'),
        ]
    ),
    builtin_command(
        'bootstrap',
        'bootstrap',
        'bootstrap [exp_list] [, options]: command',
        'prefix',
        [
            option('reps', 'reps', true),
            option('size', 'size', true),
            option('strata', 'strata', true),
            option('cluster', 'cluster', true),
            option('idcluster', 'idcluster', true),
            option('seed', 'seed', true),
            option('saving', 'saving', true),
            option('nodots', 'nodots'),
            option('noisily', 'noisily'),
            option('bca', 'bca'),
            option('percentile', 'percentile'),
            option('normal', 'normal'),
        ]
    ),
    builtin_command(
        'jackknife',
        'jackknife',
        'jackknife [exp_list] [, options]: command',
        'prefix',
        [
            option('eclass', 'eclass'),
            option('rclass', 'rclass'),
            option('n', 'n', true),
            option('cluster', 'cluster', true),
            option('idcluster', 'idcluster', true),
            option('saving', 'saving', true),
            option('keep', 'keep'),
            option('nodots', 'nodots'),
            option('noisily', 'noisily'),
            option('mse', 'mse'),
        ]
    ),
    builtin_command(
        'permute',
        'permute',
        'permute permvar [exp_list], reps(#) [options]: command',
        'prefix',
        [
            option('reps', 'reps', true),
            option('left', 'left'),
            option('right', 'right'),
            option('strata', 'strata', true),
            option('seed', 'seed', true),
            option('saving', 'saving', true),
            option('nodots', 'nodots'),
            option('noisily', 'noisily'),
        ]
    ),
    builtin_command(
        'simulate',
        'simulate',
        'simulate [exp_list], reps(#) [options]: command',
        'prefix',
        [
            option('reps', 'reps', true),
            option('seed', 'seed', true),
            option('saving', 'saving', true),
            option('nodots', 'nodots'),
            option('noisily', 'noisily'),
        ]
    ),
    builtin_command(
        'svy',
        'svy',
        'svy [vcetype] [, svy_options]: command',
        'prefix',
        [
            option('subpop', 'subpop', true),
            option('over', 'over', true),
            option('vce', 'vce', true),
            option('level', 'level', true),
        ]
    ),
    builtin_command(
        'mi',
        'mi',
        'mi subcommand [arguments] [, options]',
        'prefix',
        [],
        [
            subcommand('set', 'set'),
            subcommand('describe', 'd'),
            subcommand('estimate', 'est'),
            subcommand('impute', 'imp'),
            subcommand('register', 'reg'),
            subcommand('unregister', 'unreg'),
            subcommand('passive', 'pass'),
            subcommand('varying', 'vary'),
            subcommand('convert', 'conv'),
            subcommand('export', 'exp'),
            subcommand('import', 'imp'),
            subcommand('merge', 'merge'),
            subcommand('append', 'app'),
            subcommand('expand', 'exp'),
            subcommand('reshape', 'resh'),
            subcommand('update', 'upd'),
            subcommand('xeq', 'xeq'),
        ]
    ),
    builtin_command(
        'nestreg',
        'nestreg',
        'nestreg [, options]: command',
        'prefix',
        [
            option('lr', 'lr'),
            option('wald', 'wald'),
            option('store', 'store', true),
        ]
    ),
    builtin_command(
        'stepwise',
        'stepwise',
        'stepwise [, options]: command',
        'prefix',
        [
            option('pr', 'pr', true),
            option('pe', 'pe', true),
            option('forward', 'forward'),
            option('hierarchical', 'hierarchical'),
            option('lockterm1', 'lockterm1'),
            option('lr', 'lr'),
        ]
    ),
    builtin_command(
        'xi',
        'xi',
        'xi [, prefix(string) noomit]: command',
        'prefix',
        [
            option('prefix', 'prefix', true),
            option('noomit', 'noomit'),
        ]
    ),
    builtin_command(
        'fvset',
        'fvset',
        'fvset base # varname [varname ...]',
        'prefix'
    ),
    builtin_command(
        'frame',
        'frame',
        'frame subcommand [arguments]: command',
        'prefix',
        [],
        [
            subcommand('create', 'create'),
            subcommand('change', 'change'),
            subcommand('copy', 'copy'),
            subcommand('drop', 'drop'),
            subcommand('rename', 'rename'),
            subcommand('put', 'put'),
            subcommand('post', 'post'),
            subcommand('dir', 'dir'),
            subcommand('reset', 'reset'),
            subcommand('list', 'list'),
            subcommand('prefix', 'prefix'),
        ]
    ),
];

/**
 * All built-in commands combined
 */
export const BUILTIN_COMMANDS: CommandInfo[] = [
    ...DATA_MANIPULATION_COMMANDS,
    ...STATISTICS_COMMANDS,
    ...REGRESSION_COMMANDS,
    ...FILE_IO_COMMANDS,
    ...PROGRAMMING_COMMANDS,
    ...GRAPHICS_COMMANDS,
    ...LABEL_COMMANDS,
    ...ESTIMATION_COMMANDS,
    ...UTILITY_COMMANDS,
    ...PREFIX_COMMANDS,
];

/**
 * Initialize the command database with all built-in commands.
 */
import { command_database } from '../command-database';

export function initialize_builtin_commands(): void {
    command_database.register_all(BUILTIN_COMMANDS);
}
