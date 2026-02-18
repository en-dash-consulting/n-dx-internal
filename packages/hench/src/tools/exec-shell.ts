/**
 * Backward-compatibility re-export.
 *
 * `execShell` has moved to `../process/exec-shell.js` to co-locate all
 * process execution infrastructure and reduce cross-zone coupling.
 *
 * @deprecated Import from `../process/exec-shell.js` or `../process/index.js` instead.
 */
export { execShell } from "../process/exec-shell.js";
export type { ExecShellOptions } from "../process/exec-shell.js";
