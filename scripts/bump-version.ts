#!/usr/bin/env bun
/**
 * Bumps version in both package.json files and optionally commits, tags, and pushes.
 * Usage: bun scripts/bump-version.ts [patch|minor|major|<version>] [--push]
 */

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const bump_type = process.argv[2] || "patch";
const should_push = process.argv.includes("--push");
const should_skip_git = process.argv.includes("--no-git");

function read_package(path: string): { content: any; raw: string } {
    const raw = readFileSync(path, "utf-8");
    return { content: JSON.parse(raw), raw };
}

function bump_version(current: string, type: string): string {
    if (!["patch", "minor", "major"].includes(type)) {
        // Assume it's an explicit version
        return type;
    }
    
    const [major, minor, patch] = current.split(".").map(Number);
    
    switch (type) {
        case "major":
            return `${major + 1}.0.0`;
        case "minor":
            return `${major}.${minor + 1}.0`;
        case "patch":
        default:
            return `${major}.${minor}.${patch + 1}`;
    }
}

function update_package(path: string, new_version: string): void {
    const { content } = read_package(path);
    content.version = new_version;
    writeFileSync(path, JSON.stringify(content, null, 2) + "\n");
}

// Read current version from root package.json
const root_pkg = read_package("package.json");
const current_version = root_pkg.content.version;
const new_version = bump_version(current_version, bump_type);

console.log(`Bumping version: ${current_version} → ${new_version}`);

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
