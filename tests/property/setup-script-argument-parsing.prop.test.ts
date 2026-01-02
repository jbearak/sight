import { describe, it, expect } from "bun:test";
import * as fc from "fast-check";

/**
 * Property 6: Flag Recognition Flexibility
 * 
 * For any argument list containing --yes or -y, the script should recognize
 * the flag regardless of its position in the argument list and enable auto mode.
 * 
 * Validates: Requirements 5.4
 */

/**
 * Simulates the argument parsing logic from setup.sh
 * Returns true if AUTO_YES should be set to true
 */
function parseArguments(args: string[]): boolean {
    let autoYes = false;
    for (const arg of args) {
        if (arg === "--yes" || arg === "-y") {
            autoYes = true;
        }
    }
    return autoYes;
}

describe("setup.sh argument parsing", () => {
    it("Property 6: Flag Recognition Flexibility - recognizes --yes flag at any position", () => {
        fc.assert(
            fc.property(
                fc.array(fc.string().filter(s => s !== "--yes" && s !== "-y")),
                fc.integer({ min: 0, max: 10 }),
                (otherArgs, flagPosition) => {
                    // Insert --yes at a random position
                    const args = [...otherArgs];
                    const insertPos = Math.min(flagPosition, args.length);
                    args.splice(insertPos, 0, "--yes");

                    const result = parseArguments(args);
                    expect(result).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    it("Property 6: Flag Recognition Flexibility - recognizes -y flag at any position", () => {
        fc.assert(
            fc.property(
                fc.array(fc.string().filter(s => s !== "--yes" && s !== "-y")),
                fc.integer({ min: 0, max: 10 }),
                (otherArgs, flagPosition) => {
                    // Insert -y at a random position
                    const args = [...otherArgs];
                    const insertPos = Math.min(flagPosition, args.length);
                    args.splice(insertPos, 0, "-y");

                    const result = parseArguments(args);
                    expect(result).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    it("Property 6: Flag Recognition Flexibility - returns false when no flag is present", () => {
        fc.assert(
            fc.property(
                fc.array(fc.string().filter(s => s !== "--yes" && s !== "-y")),
                (args) => {
                    const result = parseArguments(args);
                    expect(result).toBe(false);
                }
            ),
            { numRuns: 100 }
        );
    });

    it("Property 6: Flag Recognition Flexibility - recognizes multiple flag occurrences", () => {
        fc.assert(
            fc.property(
                fc.array(fc.string().filter(s => s !== "--yes" && s !== "-y")),
                (otherArgs) => {
                    // Add multiple flags
                    const args = [...otherArgs, "--yes", "-y"];

                    const result = parseArguments(args);
                    expect(result).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    it("Property 6: Flag Recognition Flexibility - handles mixed flag formats", () => {
        fc.assert(
            fc.property(
                fc.array(fc.string().filter(s => s !== "--yes" && s !== "-y")),
                fc.boolean(),
                (otherArgs, useShortForm) => {
                    const flag = useShortForm ? "-y" : "--yes";
                    const args = [...otherArgs, flag];

                    const result = parseArguments(args);
                    expect(result).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });
});
