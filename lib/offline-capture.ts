/**
 * Shared constants for capturing leads at an event with no connection.
 *
 * Kept in one place because the number is enforced three times over — the
 * capture form stops accepting at it, the upload endpoint refuses a larger
 * batch, and the leads page warns about it. Three separate literals would
 * drift, and the one that drifts is the server's, which is the only one that
 * actually protects anything.
 */

/**
 * Most leads held on a device before they must be uploaded.
 *
 * Not a technical ceiling — the storage would take far more. It is a limit on
 * how much unsent work is allowed to accumulate in one place, because a lost
 * or broken phone loses all of it, and because a batch this size uploads in a
 * few seconds on event wifi rather than timing out.
 */
export const OFFLINE_CAPTURE_LIMIT = 100;

/**
 * Shown on the leads page and above the capture form.
 *
 * Written as ONE template literal on purpose. Splitting it across two joined
 * with `+` produced a corrupted string in the production bundle: the minifier
 * constant-folds `${OFFLINE_CAPTURE_LIMIT}` to `100` because the constant is
 * local to this file, and while folding the two literals together it dropped
 * the static text between that interpolation and the closing backtick. The
 * banner shipped reading "holds up to 100Upload them before collecting more".
 *
 * The same `+` pattern elsewhere in the codebase is fine, because those
 * interpolate an *imported* binding that cannot be folded. It is the
 * combination of folding and concatenation that breaks. Do not reintroduce it
 * here — TypeScript, eslint and the build all pass either way, and only reading
 * the rendered text catches it.
 */
export const OFFLINE_CAPTURE_WARNING = `Offline capture holds up to ${OFFLINE_CAPTURE_LIMIT} leads per session. Upload them before collecting more — beyond ${OFFLINE_CAPTURE_LIMIT} nothing further can be saved on the device.`;
