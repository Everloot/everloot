/**
 * The protocol's own version, stamped on every upload envelope by the uploaders. Semver: a new record
 * kind, field or tool is a minor release; removing or renaming anything, making a field required or
 * tightening a limit is a major release. The server accepts the current major and the previous one.
 */
export declare const PROTOCOL_VERSION = "1.11.0";
/** The majors the server still parses. Every addon today speaks major 1, and a missing `protocol` means 1. */
export declare const ACCEPTED_MAJORS: readonly number[];
/** The major of a `x.y.z` string, or null when it is not one. */
export declare function protocolMajor(version: unknown): number | null;
