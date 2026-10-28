/**
 * The protocol's own version, stamped on every upload envelope by the uploaders. Semver: a new record
 * kind, field or tool is a minor release; removing or renaming anything, making a field required or
 * tightening a limit is a major release. The server accepts the current major and the previous one.
 */
export const PROTOCOL_VERSION = "1.10.0";
/** The majors the server still parses. Every addon today speaks major 1, and a missing `protocol` means 1. */
export const ACCEPTED_MAJORS = [1];
/** The major of a `x.y.z` string, or null when it is not one. */
export function protocolMajor(version) {
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version))
        return null;
    return Number(version.split(".")[0]);
}
