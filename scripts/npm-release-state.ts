#!/usr/bin/env bun
/**
 * Decides whether the release workflow should publish a version to npm.
 * npm refuses to republish a version, so without this a publish rerun
 * after a later step failed (Marketplace, Open VSX) would die at npm.
 *
 * Usage: bun scripts/npm-release-state.ts PACKAGE VERSION DIST_TAG
 *
 * Prints "publish" when the version is not on the registry, or "skip"
 * when it is and DIST_TAG already points at it. Exits 1 otherwise: the
 * registry answered something unexpected, or the version exists under a
 * different dist-tag. Trusted Publishing can only `npm publish`, so a
 * wrong dist-tag has to be fixed by hand with `npm dist-tag add`.
 *
 * The registry is queried without auth on purpose: setup-node's
 * registry-url writes an .npmrc with a placeholder token that can make
 * `npm view` fail even for a public package.
 */

export type NpmReleaseAction = 'publish' | 'skip';

const REGISTRY_URL = 'https://registry.npmjs.org';

export function decide_npm_release(
    package_name: string,
    version: string,
    dist_tag: string,
    version_status: number,
    dist_tags_body: string | undefined
): NpmReleaseAction {
    if (version_status === 404) {
        return 'publish';
    }
    if (version_status !== 200) {
        throw new Error(
            `npm registry returned HTTP ${version_status} for ` +
            `${package_name}@${version}`
        );
    }

    let dist_tags: unknown;
    try {
        dist_tags = JSON.parse(dist_tags_body ?? '');
    } catch {
        throw new Error(`npm registry returned malformed dist-tags JSON`);
    }
    if (typeof dist_tags !== 'object' || dist_tags === null) {
        throw new Error(`npm registry returned malformed dist-tags JSON`);
    }

    const tagged_version: unknown = Reflect.get(dist_tags, dist_tag);
    if (tagged_version === version) {
        return 'skip';
    }
    throw new Error(
        `${package_name}@${version} is already published, but dist-tag ` +
        `"${dist_tag}" points at ${String(tagged_version ?? 'nothing')}. ` +
        `Fix it locally: npm dist-tag add ${package_name}@${version} ` +
        dist_tag
    );
}

async function main(): Promise<void> {
    const [package_name, version, dist_tag] = process.argv.slice(2);
    if (!package_name || !version || !dist_tag) {
        console.error(
            'Usage: bun scripts/npm-release-state.ts PACKAGE VERSION DIST_TAG'
        );
        process.exit(2);
    }

    const encoded_name = package_name.replace('/', '%2f');
    const version_response =
        await fetch(`${REGISTRY_URL}/${encoded_name}/${version}`);
    let dist_tags_body: string | undefined;
    if (version_response.status === 200) {
        const dist_tags_response = await fetch(
            `${REGISTRY_URL}/-/package/${encoded_name}/dist-tags`
        );
        if (!dist_tags_response.ok) {
            throw new Error(
                `npm registry returned HTTP ${dist_tags_response.status} ` +
                `for ${package_name} dist-tags`
            );
        }
        dist_tags_body = await dist_tags_response.text();
    }

    console.log(decide_npm_release(
        package_name,
        version,
        dist_tag,
        version_response.status,
        dist_tags_body
    ));
}

if (import.meta.main) {
    main().catch((error) => {
        console.error(`ERROR: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
    });
}
