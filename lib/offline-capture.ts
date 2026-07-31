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

/** Shown on the leads page and above the capture form. */
export const OFFLINE_CAPTURE_WARNING =
  `Offline capture holds up to ${OFFLINE_CAPTURE_LIMIT} leads per session. ` +
  `Upload them before collecting more — beyond ${OFFLINE_CAPTURE_LIMIT} nothing further can be saved on the device.`;
