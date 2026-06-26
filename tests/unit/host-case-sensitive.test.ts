import { describe, it, expect } from 'bun:test';
import { host_is_case_sensitive } from '../../src/utils/file-path-utils';

describe('host_is_case_sensitive', () => {
    it('flipped variant exists -> case-insensitive', () => {
        const fs = { existsSync: (_p: string) => true };
        expect(host_is_case_sensitive('/Workspace/proj', fs)).toBe(false);
    });

    it('flipped variant absent -> case-sensitive', () => {
        // Only the exact original path exists; the flipped version does not.
        const fs = { existsSync: (p: string) => p === '/Workspace/proj' };
        expect(host_is_case_sensitive('/Workspace/proj', fs)).toBe(true);
    });

    it('no ascii letter -> assume case-sensitive', () => {
        const fs = { existsSync: (_p: string) => true };
        expect(host_is_case_sensitive('/123/456', fs)).toBe(true);
    });

    // ── Leaf-flip behaviour ──────────────────────────────────────────────────

    it('flips the leaf segment, not the first letter of the whole path', () => {
        // Seed: /mnt/Workspace/proj
        // The probe should flip 'W' in 'Workspace' (last segment with ASCII),
        // producing /mnt/Workspace/Proj or /mnt/Workspace/proj depending on
        // which letter is first in 'proj'. The leaf is 'proj', first letter
        // 'p' → 'P', so the probed path is /mnt/Workspace/Proj.
        const the_seen: string[] = [];
        const fs = {
            existsSync: (p: string) => {
                the_seen.push(p);
                return false; // absent → case-sensitive
            },
        };
        const result = host_is_case_sensitive('/mnt/Workspace/proj', fs);
        expect(result).toBe(true);
        // The probe path must contain the leaf, not flip /mnt → /Mnt
        expect(the_seen.length).toBeGreaterThan(0);
        const my_probe = the_seen[0]!;
        // The probe should not change the '/mnt/Workspace/' prefix at all
        expect(my_probe.startsWith('/mnt/Workspace/')).toBe(true);
        // The probe must differ from the original in the leaf only
        expect(my_probe).not.toBe('/mnt/Workspace/proj');
    });

    it('leaf has no ASCII letter → walks up to parent segment', () => {
        // Seed: /mnt/123/456 — leaf '456' has no ASCII letters; parent
        // '123' has none either; 'mnt' has letters. The probe flips the
        // 'm' in 'mnt' → '/Mnt/123/456'.
        const the_seen: string[] = [];
        const fs = {
            existsSync: (p: string) => {
                the_seen.push(p);
                return true; // exists → case-insensitive
            },
        };
        const result = host_is_case_sensitive('/mnt/123/456', fs);
        expect(result).toBe(false);
        const my_probe = the_seen[0]!;
        // The probe must flip a letter in 'mnt'
        expect(my_probe).toBe('/Mnt/123/456');
    });

    it('case-insensitive when leaf flipped path exists', () => {
        // Seed: /volumes/data/MyDir
        // Leaf 'MyDir' flips 'M' → 'myDir'; that path exists → insensitive.
        const seed = '/volumes/data/MyDir';
        const fs = {
            existsSync: (p: string) =>
                p === seed || p === '/volumes/data/myDir',
        };
        expect(host_is_case_sensitive(seed, fs)).toBe(false);
    });

    it('case-sensitive when leaf flipped path is absent', () => {
        const seed = '/volumes/data/MyDir';
        const fs = { existsSync: (p: string) => p === seed };
        expect(host_is_case_sensitive(seed, fs)).toBe(true);
    });
});
