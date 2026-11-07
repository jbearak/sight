/**
 * Exit codes for each case where `sight console` on Windows didn't get
 * Stata. Editors (Sight's VS Code extension) read them to offer
 * send-to-stata instead; docs/console.md lists them. They avoid 0, 1, 2
 * (`EXIT_USAGE`) and 128 and up (signal statuses).
 *
 * 80-83 are retired: they were the take-over cases (several Statas open
 * with --yes, take-over declined, send from the editor instead, open
 * Stata held by another program), which can't happen now that the
 * console always starts its own Stata. Don't reuse them.
 */
export const EXIT_AUTOMATION_NOT_REGISTERED = 84;
export const EXIT_BRIDGE_BLOCKED = 85;
export const EXIT_TERMINAL_UNSUPPORTED = 86;
export const EXIT_AUTOMATION_UNSUPPORTED = 87;
