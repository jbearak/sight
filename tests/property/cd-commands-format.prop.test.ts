import { format_cd_command } from '../../client/src/send-to-stata/cd-commands';

describe('Property Tests: CD Command Format', () => {
    test('Property 2: CD command path correctness', () => {
        const test_paths = [
            '/Users/test/Documents',
            'C:\\Users\\test\\Documents',
            '/path/with spaces/folder',
            'C:\\path with spaces\\folder',
            '/path/with"quotes/folder',
            'C:\\path\\with"quotes\\folder',
            '/simple/path',
            'C:\\simple\\path',
            '/path/with/multiple"quotes"here/folder',
            'C:\\path\\with\\multiple"quotes"here\\folder'
        ];
        
        // Generate additional random paths
        for (let my_i = 0; my_i < 100; my_i++) {
            const my_segments = [];
            const my_segment_count = Math.floor(Math.random() * 5) + 1;
            
            for (let my_j = 0; my_j < my_segment_count; my_j++) {
                let my_segment = '';
                const my_length = Math.floor(Math.random() * 10) + 1;
                
                for (let my_k = 0; my_k < my_length; my_k++) {
                    const my_chars = 'abcdefghijklmnopqrstuvwxyz0123456789_- ';
                    if (Math.random() < 0.1) {
                        my_segment += '"';
                    } else {
                        my_segment += my_chars[Math.floor(Math.random() * my_chars.length)];
                    }
                }
                my_segments.push(my_segment);
            }
            
            const my_is_windows = Math.random() < 0.5;
            const my_separator = my_is_windows ? '\\' : '/';
            const my_prefix = my_is_windows ? 'C:' : '';
            const my_path = my_prefix + my_separator + my_segments.join(my_separator);
            
            test_paths.push(my_path);
        }
        
        for (const my_path of test_paths) {
            const my_command = format_cd_command(my_path);
            
            // Command starts with 'cd '
            expect(my_command).toMatch(/^cd /);
            
            // Path is properly quoted
            const my_has_quotes = my_path.includes('"');
            if (my_has_quotes) {
                // Should use compound syntax
                expect(my_command).toMatch(/^cd `".*"'$/);
            } else {
                // Should use simple syntax
                expect(my_command).toMatch(/^cd ".*"$/);
            }
            
            // Backslashes are doubled
            const my_escaped_path = my_path.replace(/\\/g, '\\\\');
            expect(my_command).toContain(my_escaped_path);
        }
    });
});