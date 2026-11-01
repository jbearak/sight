import { afterAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    compare_versions,
    parse_release_version,
    release_channel,
} from '../../scripts/release-channel';
import { next_version } from '../../scripts/bump-version';
import { resolve_release_version } from '../../scripts/release';
import {
    find_vsix_release_problems,
    read_vsix_manifest_release,
} from '../../scripts/check-vsix-release';
import { decide_npm_release } from '../../scripts/npm-release-state';

const REPO_ROOT = join(__dirname, '../..');

// extension.vsixmanifest from `vsce package --pre-release` (vsce 3.9.1),
// trimmed to the elements the release check reads.
const PRE_RELEASE_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
	<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
		<Metadata>
			<Identity Language="en-US" Id="sight" Version="0.17.0" Publisher="jbearak" />
			<DisplayName>Sight</DisplayName>
			<Properties>
				<Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.123.0" />
				<Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
				<Property Id="Microsoft.VisualStudio.Code.PreRelease" Value="true" />
				<Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
				<Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free"/>
			</Properties>
		</Metadata>
	</PackageManifest>`;

// A stable `vsce package` omits the PreRelease property entirely.
const STABLE_MANIFEST = PRE_RELEASE_MANIFEST
    .replace(
        '\t\t\t\t<Property Id="Microsoft.VisualStudio.Code.PreRelease" ' +
        'Value="true" />\n',
        ''
    )
    .replace('Version="0.17.0" Publisher', 'Version="0.18.0" Publisher');

function run_script(
    script: string,
    the_args: string[]
): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(
        process.execPath,
        [join('scripts', script), ...the_args],
        { cwd: REPO_ROOT, encoding: 'utf8' }
    );
    return {
        status: result.status,
        stdout: result.stdout.trim(),
        stderr: result.stderr,
    };
}

describe('release_channel', () => {
    it.each([
        ['0.16.0', 'stable'],
        ['0.18.3', 'stable'],
        ['v0.18.0', 'stable'],
        ['1.0.0', 'stable'],
        ['0.17.0', 'pre-release'],
        ['v0.19.3', 'pre-release'],
        ['1.1.0', 'pre-release'],
        // Every minor through 0.15 shipped as stable before the scheme.
        ['0.15.1', 'stable'],
        ['0.15.2', 'stable'],
        ['0.13.0', 'stable'],
    ])('classifies %s as %s', (version, expected) => {
        expect(release_channel(version)).toBe(expected);
    });

    it.each(['1.0.0-beta.1', '0.17', '01.2.3', 'v', 'latest', ''])(
        'rejects %p',
        (version) => {
            expect(() => release_channel(version)).toThrow(/X\.Y\.Z/);
        }
    );

    it('parses and compares versions numerically', () => {
        expect(parse_release_version('v0.17.2'))
            .toEqual({ major: 0, minor: 17, patch: 2 });
        expect(compare_versions('0.17.0', '0.15.1')).toBeGreaterThan(0);
        expect(compare_versions('0.9.9', '0.10.0')).toBeLessThan(0);
        expect(compare_versions('v1.2.3', '1.2.3')).toBe(0);
    });

    it('keeps the classifier free of imports', () => {
        // bump-homebrew.yml checks out only this file and runs it without
        // installing dependencies.
        const source = readFileSync(
            join(REPO_ROOT, 'scripts/release-channel.ts'),
            'utf8'
        );
        expect(source).not.toMatch(/^\s*import\s/m);
        expect(source).not.toMatch(/\brequire\(/);
    });
});

describe('next_version', () => {
    it.each([
        ['0.15.1', 'patch', '0.15.2'],
        ['0.15.1', 'minor', '0.16.0'],
        ['0.15.1', 'preview', '0.17.0'],
        ['0.15.1', 'major', '1.0.0'],
        ['0.16.3', 'preview', '0.17.0'],
        ['0.17.0', 'patch', '0.17.1'],
        ['0.17.0', 'preview', '0.17.1'],
        ['0.17.2', 'minor', '0.18.0'],
        ['0.18.0', 'patch', '0.18.1'],
        ['0.18.0', 'preview', '0.19.0'],
        ['0.18.0', 'minor', '0.20.0'],
        ['0.18.0', 'v0.19.0', '0.19.0'],
        ['0.18.0', '0.21.0', '0.21.0'],
    ])('from %s, %s gives %s', (current, bump, expected) => {
        expect(next_version(current, bump)).toBe(expected);
    });

    it('rejects suffixed explicit versions', () => {
        expect(() => next_version('0.18.0', '1.0.0-beta.1')).toThrow();
    });

    it('rejects an invalid current version', () => {
        expect(() => next_version('0.18', 'patch')).toThrow();
    });
});

describe('resolve_release_version', () => {
    it('requires the release to be above the current version', () => {
        expect(resolve_release_version('0.15.1', 'preview')).toBe('0.17.0');
        expect(() => resolve_release_version('0.17.0', '0.16.0'))
            .toThrow(/must be above/);
        expect(() => resolve_release_version('0.17.0', '0.17.0'))
            .toThrow(/must be above/);
    });
});

describe('release script CLIs', () => {
    const package_version: string = JSON.parse(
        readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')
    ).version;
    const expected_preview = next_version(package_version, 'preview');
    const expected_output =
        `${expected_preview} ${release_channel(expected_preview)}`;

    it('release-channel.ts prints only the channel', () => {
        expect(run_script('release-channel.ts', ['v0.17.0']))
            .toMatchObject({ status: 0, stdout: 'pre-release' });
        expect(run_script('release-channel.ts', ['0.18.0']))
            .toMatchObject({ status: 0, stdout: 'stable' });
    });

    it('release-channel.ts fails without stdout on bad input', () => {
        expect(run_script('release-channel.ts', ['1.0.0-beta.1']))
            .toMatchObject({ status: 1, stdout: '' });
        expect(run_script('release-channel.ts', []))
            .toMatchObject({ status: 2, stdout: '' });
    });

    it.each([
        [['--dry-run', 'preview']],
        [['preview', '--dry-run']],
    ])('release.ts %p prints version and channel', (the_args) => {
        expect(run_script('release.ts', the_args))
            .toMatchObject({ status: 0, stdout: expected_output });
    });

    it('release.ts rejects a missing or suffixed version', () => {
        expect(run_script('release.ts', ['--dry-run']).status).toBe(1);
        expect(run_script('release.ts', ['--dry-run', '1.0.0-beta.1']).status)
            .toBe(1);
    });

    it('bump-version.ts --dry-run changes nothing', () => {
        expect(run_script('bump-version.ts', ['--dry-run', 'preview']))
            .toMatchObject({ status: 0, stdout: expected_output });
        expect(
            JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
                .version
        ).toBe(package_version);
    });
});

describe('check-vsix-release', () => {
    it('reads version and channel from real vsce manifests', () => {
        expect(read_vsix_manifest_release(PRE_RELEASE_MANIFEST))
            .toEqual({ version: '0.17.0', channel: 'pre-release' });
        expect(read_vsix_manifest_release(STABLE_MANIFEST))
            .toEqual({ version: '0.18.0', channel: 'stable' });
    });

    it('reads attributes in any order and spacing', () => {
        const manifest =
            '<Identity Version = "0.19.0"\n  Id="sight" Publisher="jbearak"/>' +
            '<Property\n Value="true"   Id="Microsoft.VisualStudio.Code.PreRelease"/>';
        expect(read_vsix_manifest_release(manifest))
            .toEqual({ version: '0.19.0', channel: 'pre-release' });
    });

    it('treats a PreRelease value other than "true" as stable', () => {
        const manifest = PRE_RELEASE_MANIFEST.replace(
            'PreRelease" Value="true"',
            'PreRelease" Value="false"'
        );
        expect(read_vsix_manifest_release(manifest).channel).toBe('stable');
    });

    it('accepts a VSIX that matches its tag', () => {
        expect(find_vsix_release_problems(PRE_RELEASE_MANIFEST, 'v0.17.0'))
            .toEqual([]);
        expect(find_vsix_release_problems(STABLE_MANIFEST, 'v0.18.0'))
            .toEqual([]);
    });

    it('flags a channel or version that does not match the tag', () => {
        expect(find_vsix_release_problems(STABLE_MANIFEST, 'v0.19.0'))
            .toEqual([
                'manifest version is 0.18.0, expected 0.19.0 for v0.19.0',
                'VSIX is packaged as stable, but v0.19.0 is pre-release',
            ]);
        const pre_release_0_18 = PRE_RELEASE_MANIFEST
            .replace('Version="0.17.0" Publisher', 'Version="0.18.0" Publisher');
        expect(find_vsix_release_problems(pre_release_0_18, 'v0.18.0'))
            .toEqual([
                'VSIX is packaged as pre-release, but v0.18.0 is stable',
            ]);
    });

    describe('CLI', () => {
        const scratch = mkdtempSync(join(tmpdir(), 'sight-vsix-release-'));
        afterAll(() => rmSync(scratch, { recursive: true, force: true }));

        function make_vsix(name: string, manifest: string): string {
            writeFileSync(join(scratch, 'extension.vsixmanifest'), manifest);
            const vsix_path = join(scratch, name);
            const zipped = spawnSync(
                'zip',
                ['-q', vsix_path, 'extension.vsixmanifest'],
                { cwd: scratch }
            );
            expect(zipped.status).toBe(0);
            return vsix_path;
        }

        it('passes a matching VSIX and fails a mismatched one', () => {
            const vsix_path = make_vsix('pre.vsix', PRE_RELEASE_MANIFEST);
            expect(run_script('check-vsix-release.ts', [vsix_path, 'v0.17.0'])
                .status).toBe(0);
            const mismatched =
                run_script('check-vsix-release.ts', [vsix_path, 'v0.18.0']);
            expect(mismatched.status).toBe(1);
            expect(mismatched.stderr).toContain('packaged as pre-release');
        });

        it('fails when the file is not a VSIX', () => {
            const not_vsix = join(scratch, 'not.vsix');
            writeFileSync(not_vsix, 'not a zip');
            expect(run_script('check-vsix-release.ts', [not_vsix, 'v0.17.0'])
                .status).toBe(1);
        });
    });
});

describe('decide_npm_release', () => {
    const decide = (
        version_status: number,
        dist_tags_body?: string,
        dist_tag = 'next'
    ) => decide_npm_release(
        '@jbearak/sight',
        '0.17.0',
        dist_tag,
        version_status,
        dist_tags_body
    );

    it('publishes a version the registry does not have', () => {
        expect(decide(404)).toBe('publish');
    });

    it('skips a version already published under its dist-tag', () => {
        expect(decide(200, '{"latest":"0.15.1","next":"0.17.0"}'))
            .toBe('skip');
    });

    it('fails when the version is published under another dist-tag', () => {
        expect(() => decide(200, '{"latest":"0.17.0"}'))
            .toThrow(/npm dist-tag add @jbearak\/sight@0\.17\.0 next/);
    });

    it('fails on registry errors and malformed dist-tags', () => {
        expect(() => decide(401)).toThrow(/HTTP 401/);
        expect(() => decide(500)).toThrow(/HTTP 500/);
        expect(() => decide(200, 'not json')).toThrow(/malformed/);
        expect(() => decide(200, 'null')).toThrow(/malformed/);
        expect(() => decide(200, undefined)).toThrow(/malformed/);
    });
});
