/**
 * Property test for PATH detection.
 * 
 * **Property 2: PATH Detection**
 * *For any* PATH environment string, the `is_path_in_env()` function SHALL correctly
 * detect whether ~/bin (expanded to the user's home directory) is present in the PATH,
 * handling:
 * - Colon-separated paths (Unix)
 * - Semicolon-separated paths (Windows)
 * - Paths with trailing slashes
 * - Paths using $HOME or ~ notation
 * 
 * **Validates: Requirements 5.1**
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import { homedir } from 'os';
import { is_path_in_env } from '../../scripts/install';

// Store original PATH
let original_path: string | undefined;

describe('PATH Detection Property Tests', () => {
    beforeEach(() => {
        original_path = process.env.PATH;
    });

    afterEach(() => {
        if (original_path !== undefined) {
            process.env.PATH = original_path;
        }
    });

    /**
     * Feature: binary-installation, Property 2: PATH Detection
     * 
     * When the target directory is explicitly in PATH, it should be detected.
     */
    it('should detect target directory when explicitly in PATH', () => {
        const home = homedir();
        const target = `${home}/bin`;
        
        fc.assert(
            fc.property(
                fc.array(fc.stringMatching(/^\/[a-z0-9_/]+$/), { minLength: 0, maxLength: 5 }),
                (other_paths) => {
                    // Include target in PATH
                    const path_with_target = [...other_paths, target].join(':');
                    process.env.PATH = path_with_target;
                    
                    expect(is_path_in_env(target)).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: binary-installation, Property 2: PATH Detection
     * 
     * When the target directory is NOT in PATH, it should not be detected.
     */
    it('should not detect target directory when not in PATH', () => {
        const home = homedir();
        const target = `${home}/bin`;
        
        fc.assert(
            fc.property(
                fc.array(
                    fc.stringMatching(/^\/[a-z0-9_]+$/).filter(p => !p.includes('bin')),
                    { minLength: 1, maxLength: 5 }
                ),
                (other_paths) => {
                    // Exclude target from PATH
                    const path_without_target = other_paths.join(':');
                    process.env.PATH = path_without_target;
                    
                    expect(is_path_in_env(target)).toBe(false);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: binary-installation, Property 2: PATH Detection
     * 
     * Should handle paths with trailing slashes.
     */
    it('should handle paths with trailing slashes', () => {
        const home = homedir();
        const target = `${home}/bin`;
        
        // Target with trailing slash in PATH
        process.env.PATH = `/usr/bin:${target}/:${home}/local`;
        expect(is_path_in_env(target)).toBe(true);
        
        // Target without trailing slash, query with trailing slash
        process.env.PATH = `/usr/bin:${target}:${home}/local`;
        expect(is_path_in_env(`${target}/`)).toBe(true);
    });

    /**
     * Feature: binary-installation, Property 2: PATH Detection
     * 
     * Should handle ~ notation for home directory.
     */
    it('should handle tilde notation', () => {
        const home = homedir();
        const target = `${home}/bin`;
        
        // PATH uses ~ notation
        process.env.PATH = `/usr/bin:~/bin:/usr/local/bin`;
        expect(is_path_in_env(target)).toBe(true);
    });

    /**
     * Feature: binary-installation, Property 2: PATH Detection
     * 
     * Should handle $HOME notation.
     */
    it('should handle $HOME notation', () => {
        const home = homedir();
        const target = `${home}/bin`;
        
        // PATH uses $HOME notation
        process.env.PATH = `/usr/bin:$HOME/bin:/usr/local/bin`;
        expect(is_path_in_env(target)).toBe(true);
    });

    /**
     * Feature: binary-installation, Property 2: PATH Detection
     * 
     * Should handle empty PATH gracefully.
     */
    it('should handle empty PATH', () => {
        const home = homedir();
        const target = `${home}/bin`;
        
        process.env.PATH = '';
        expect(is_path_in_env(target)).toBe(false);
    });

    /**
     * Feature: binary-installation, Property 2: PATH Detection
     * 
     * Should not match partial paths.
     */
    it('should not match partial paths', () => {
        const home = homedir();
        const target = `${home}/bin`;
        
        // PATH has similar but different paths
        process.env.PATH = `/usr/bin:${home}/bin2:${home}/mybin`;
        expect(is_path_in_env(target)).toBe(false);
    });
});
