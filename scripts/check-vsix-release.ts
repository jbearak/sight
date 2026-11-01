#!/usr/bin/env bun
/**
 * Checks that a VSIX matches its release tag: the manifest version is
 * the tag's version, and the Marketplace pre-release marker is present
 * exactly when the tag is a pre-release (scripts/release-channel.ts).
 * The Marketplace and Open VSX both read the channel from the manifest,
 * so a mismatch here would publish to the wrong channel.
 *
 * Usage: bun scripts/check-vsix-release.ts PATH.vsix TAG
 */

import { spawnSync } from 'child_process';
import {
    parse_release_version,
    release_channel,
    type ReleaseChannel,
} from './release-channel';

const PRE_RELEASE_PROPERTY_ID = 'Microsoft.VisualStudio.Code.PreRelease';

export interface VsixManifestRelease {
    version: string | undefined;
    channel: ReleaseChannel;
}

/** Attribute values of each `<tag_name ...>` element, in any order. */
function get_element_attributes(
    manifest_xml: string,
    tag_name: string
): Map<string, string>[] {
    const element_pattern = new RegExp(`<${tag_name}\\b([^>]*)>`, 'g');
    const attribute_pattern = /([\w.:-]+)\s*=\s*"([^"]*)"/g;
    const the_elements: Map<string, string>[] = [];
    for (const my_element of manifest_xml.matchAll(element_pattern)) {
        const the_attributes = new Map<string, string>();
        for (const my_attribute of my_element[1].matchAll(attribute_pattern)) {
            the_attributes.set(my_attribute[1], my_attribute[2]);
        }
        the_elements.push(the_attributes);
    }
    return the_elements;
}

export function read_vsix_manifest_release(
    manifest_xml: string
): VsixManifestRelease {
    const identity = get_element_attributes(manifest_xml, 'Identity')[0];
    const is_pre_release = get_element_attributes(manifest_xml, 'Property')
        .some((my_property) =>
            my_property.get('Id') === PRE_RELEASE_PROPERTY_ID
            && my_property.get('Value') === 'true');
    return {
        version: identity?.get('Version'),
        channel: is_pre_release ? 'pre-release' : 'stable',
    };
}

export function find_vsix_release_problems(
    manifest_xml: string,
    tag: string
): string[] {
    const { major, minor, patch } = parse_release_version(tag);
    const expected_version = `${major}.${minor}.${patch}`;
    const expected_channel = release_channel(tag);
    const actual = read_vsix_manifest_release(manifest_xml);
    const the_problems: string[] = [];
    if (actual.version !== expected_version) {
        the_problems.push(
            `manifest version is ${actual.version ?? 'missing'}, ` +
            `expected ${expected_version} for ${tag}`
        );
    }
    if (actual.channel !== expected_channel) {
        the_problems.push(
            `VSIX is packaged as ${actual.channel}, but ${tag} is ` +
            `${expected_channel}`
        );
    }
    return the_problems;
}

if (import.meta.main) {
    const [vsix_path, tag] = process.argv.slice(2);
    if (!vsix_path || !tag) {
        console.error('Usage: bun scripts/check-vsix-release.ts PATH.vsix TAG');
        process.exit(2);
    }
    const unzipped = spawnSync(
        'unzip',
        ['-p', vsix_path, 'extension.vsixmanifest'],
        { encoding: 'utf8' }
    );
    if (unzipped.status !== 0 || !unzipped.stdout) {
        console.error(
            unzipped.stderr
            || `ERROR: could not read extension.vsixmanifest from ${vsix_path}`
        );
        process.exit(1);
    }
    let the_problems: string[];
    try {
        the_problems = find_vsix_release_problems(unzipped.stdout, tag);
    } catch (error) {
        console.error(`ERROR: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
    }
    for (const my_problem of the_problems) {
        console.error(`ERROR: ${my_problem}`);
    }
    if (the_problems.length > 0) {
        process.exit(1);
    }
    console.log(`OK: ${vsix_path} is ${tag} (${release_channel(tag)})`);
}
