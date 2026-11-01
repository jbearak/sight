#!/usr/bin/env bun
/**
 * Bumps version in both package.json files and optionally commits, tags, and pushes.
 * Usage: bun scripts/bump-version.ts [--dry-run] [patch|minor|preview|major|<version>] [--push]
 *
 * Even minor versions are stable releases and odd minor versions are
 * Marketplace pre-releases (see scripts/release-channel.ts).
 *   patch    same channel: 0.18.0 → 0.18.1, 0.17.0 → 0.17.1
 *   minor    next stable (even) minor: 0.17.2 → 0.18.0
 *   preview  next pre-release: 0.18.1 → 0.19.0, 0.19.0 → 0.19.1
 *   major    0.18.0 → 1.0.0
 * --dry-run prints "<version> <channel>" and changes nothing.
 */

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import {
    parse_release_version,
    release_channel,
} from "./release-channel";

/** The version a bump produces from `current`; throws if invalid. */
export function next_version(current: string, bump: string): string {
    const { major, minor, patch } = parse_release_version(current);
    let version: string;

    switch (bump) {
        case "major":
            version = `${major + 1}.0.0`;
            break;
        case "minor":
            version = `${major}.${(Math.floor(minor / 2) + 1) * 2}.0`;
            break;
        case "preview":
            if (release_channel(current) === "pre-release") {
                version = `${major}.${minor}.${patch + 1}`;
            } else {
                const preview_minor = minor % 2 === 1 ? minor + 2 : minor + 1;
                version = `${major}.${preview_minor}.0`;
            }
            break;
        case "patch":
            version = `${major}.${minor}.${patch + 1}`;
            break;
        default:
            // An explicit version
            version = bump.replace(/^v/, "");
    }

    const channel = release_channel(version);
    if (bump === "preview" && channel !== "pre-release") {
        throw new Error(
            `preview bump produced ${version}, a ${channel} version. ` +
            "Pass an explicit odd-minor version instead."
        );
    }
    return version;
}

function update_package(path: string, new_version: string): void {
    const content: Record<string, unknown> =
        JSON.parse(readFileSync(path, "utf-8"));
    content.version = new_version;
    writeFileSync(path, JSON.stringify(content, null, 2) + "\n");
}

function read_current_version(): string {
    const content: { version?: unknown } =
        JSON.parse(readFileSync("package.json", "utf-8"));
    if (typeof content.version !== "string") {
        throw new Error("package.json has no version");
    }
    return content.version;
}

function main(): void {
    const the_args = process.argv.slice(2);
    const should_push = the_args.includes("--push");
    const should_skip_git = the_args.includes("--no-git");
    const is_dry_run = the_args.includes("--dry-run");
    const bump_type = the_args.find((arg) => !arg.startsWith("--"))
        ?? "patch";

    const current_version = read_current_version();
    let new_version: string;
    try {
        new_version = next_version(current_version, bump_type);
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
    const channel = release_channel(new_version);

    if (is_dry_run) {
        console.log(`${new_version} ${channel}`);
        return;
    }

    console.log(
        `Bumping version: ${current_version} → ${new_version} (${channel})`
    );

    // Update both package.json files
    update_package("package.json", new_version);
    update_package("client/package.json", new_version);

    console.log("Updated package.json and client/package.json");

    if (!should_skip_git) {
        try {
            console.log("Committing...");
            execSync("git add package.json client/package.json", { stdio: "inherit" });
            execSync(`git commit -m "Bump version to ${new_version}"`, { stdio: "inherit" });

            console.log("Tagging...");
            execSync(`git tag v${new_version}`, { stdio: "inherit" });

            if (should_push) {
                console.log("Pushing commits...");
                execSync("git push origin", { stdio: "inherit" });

                console.log("Pushing tags...");
                execSync("git push origin --tags", { stdio: "inherit" });
            }

            console.log(`✓ Version ${new_version} bumped and tagged`);
        } catch (error) {
            console.error("Git operation failed:", error);
            process.exit(1);
        }
    }
}

if (import.meta.main) {
    main();
}
