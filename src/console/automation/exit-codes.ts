/**
 * Exit codes for each case where `sight console` on Windows didn't take
 * Stata. Editors (Sight's VS Code extension) read them to offer
 * send-to-stata instead; docs/cli.md lists them. They avoid 0, 1, 2
 * (`EXIT_USAGE`) and 128 and up (signal statuses).
 */
export const EXIT_SEVERAL_STATA_OPEN = 80;
export const EXIT_TAKEOVER_DECLINED = 81;
export const EXIT_SEND_FROM_EDITOR = 82;
export const EXIT_STATA_HELD_ELSEWHERE = 83;
export const EXIT_AUTOMATION_NOT_REGISTERED = 84;
export const EXIT_BRIDGE_BLOCKED = 85;
export const EXIT_TERMINAL_UNSUPPORTED = 86;
