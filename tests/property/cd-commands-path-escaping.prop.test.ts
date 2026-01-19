import { describe, it } from 'bun:test';
import * as fc from 'fast-check';
import { escape_path_for_stata } from '../../client/src/send-to-stata/cd-commands';

describe('cd-commands path escaping', () => {
    it('Property 3: Path escaping correctness', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 0, maxLength: 100 }),
                (path: string) => {
                    const result = escape_path_for_stata(path);
                    
                    // Paths with quotes use compound syntax
                    if (path.includes('"')) {
                        return result.use_compound === true;
                    }
                    
                    // Paths without quotes use simple syntax
                    if (!path.includes('"')) {
                        return result.use_compound === false;
                    }
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('backslashes are doubled', () => {
        fc.assert(
            fc.property(
                fc.string().filter(s => s.includes('\\')),
                (path: string) => {
                    const result = escape_path_for_stata(path);
                    const backslash_count = (path.match(/\\/g) || []).length;
                    const escaped_count = (result.escaped.match(/\\\\/g) || []).length;
                    
                    return escaped_count === backslash_count;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('paths without special chars unchanged except backslashes', () => {
        fc.assert(
            fc.property(
                fc.string().filter(s => !s.includes('"') && !s.includes('\\')),
                (path: string) => {
                    const result = escape_path_for_stata(path);
                    return result.escaped === path && result.use_compound === false;
                }
            ),
            { numRuns: 100 }
        );
    });
});
