import { extract_commands_from_file } from '../src/command-database/smcl-extractor.js';

const result = extract_commands_from_file('/Applications/Stata/ado/base/r/regress.sthlp');

const regress = result.commands.find(c => c.name === 'regress');
if (regress) {
    console.log('Regress command found');
    console.log('Options count:', regress.options.length);
    console.log('Options:', JSON.stringify(regress.options, null, 2));
} else {
    console.log('Regress command NOT found');
    console.log('Commands found:', result.commands.map(c => c.name));
}
