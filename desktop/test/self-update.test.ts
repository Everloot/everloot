import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open } from "node:fs/promises";
import { afterEach, expect, test, vi } from "vitest";
import { canInstallInPlace, downloadUpdate, runInstaller } from "../src/main/self-update";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, open: vi.fn(fs.open) };
});

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-update-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const URL_EXE = "https://github.com/Everloot/everloot/releases/download/desktop-v0.2.0/Everloot-DesktopApp-0.2.0-win-x64-setup.exe";
const URL_SUMS = "https://github.com/Everloot/everloot/releases/download/desktop-v0.2.0/SHA256SUMS";
const installer = Buffer.from("MZ pretend installer ".repeat(5000));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function fake(sums: string, body = installer) {
  return vi.fn(async (url: string) => (url === URL_SUMS
    ? new Response(sums, { status: 200 })
    : new Response(body, { status: 200, headers: { "content-length": String(body.length) } }))) as unknown as typeof fetch;
}

test("only the Windows installer updates in place", () => {
  expect(canInstallInPlace("win32", false)).toBe(true);
  expect(canInstallInPlace("win32", true)).toBe(false);
  expect(canInstallInPlace("darwin", false)).toBe(false);
  expect(canInstallInPlace("linux", false)).toBe(false);
});

test("the installer downloads with progress and is kept only when its checksum matches", async () => {
  const d = dir();
  const progress: number[] = [];
  const path = await downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, dir: d, send: fake(`${sha(installer)}  Everloot-DesktopApp-0.2.0-win-x64-setup.exe\n`), onProgress: (p) => progress.push(p) });
  expect(path).toBe(join(d, "Everloot-DesktopApp-0.2.0-win-x64-setup.exe"));
  expect(readFileSync(path).equals(installer)).toBe(true);
  expect(progress.at(-1)).toBe(100);
  expect(progress.every((p, i) => i === 0 || p >= progress[i - 1])).toBe(true);
});

test("a wrong checksum or a file the sums do not list installs nothing", async () => {
  const d = dir();
  await expect(downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, dir: d, send: fake(`${"0".repeat(64)}  Everloot-DesktopApp-0.2.0-win-x64-setup.exe\n`) }))
    .rejects.toThrow(/does not match its published checksum/);
  await expect(downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, dir: d, send: fake(`${sha(installer)}  something-else.exe\n`) }))
    .rejects.toThrow(/not listed/);
  expect(existsSync(join(d, "Everloot-DesktopApp-0.2.0-win-x64-setup.exe"))).toBe(false);
});

test("only this project's release download of the Windows installer is fetched, from one desktop tag", async () => {
  const sums = `${sha(installer)}  Everloot-DesktopApp-0.2.0-win-x64-setup.exe\n`;
  const base = "https://github.com/Everloot/everloot/releases/download";
  const hostile: [string, string][] = [
    ["http://github.com/Everloot/everloot/releases/download/desktop-v0.2.0/Everloot-DesktopApp-0.2.0-win-x64-setup.exe", URL_SUMS],
    ["https://evil.example/Everloot/everloot/releases/download/desktop-v0.2.0/Everloot-DesktopApp-0.2.0-win-x64-setup.exe", URL_SUMS],
    ["https://github.com.evil.example/Everloot/everloot/releases/download/desktop-v0.2.0/Everloot-DesktopApp-0.2.0-win-x64-setup.exe", URL_SUMS],
    ["https://user:pw@github.com/Everloot/everloot/releases/download/desktop-v0.2.0/Everloot-DesktopApp-0.2.0-win-x64-setup.exe", URL_SUMS],
    ["https://github.com:8443/Everloot/everloot/releases/download/desktop-v0.2.0/Everloot-DesktopApp-0.2.0-win-x64-setup.exe", URL_SUMS],
    ["https://github.com/someone/fork/releases/download/desktop-v0.2.0/Everloot-DesktopApp-0.2.0-win-x64-setup.exe", URL_SUMS],
    [`${base}/desktop-v0.2.0/Everloot-DesktopApp-0.2.0-win-x64-setup.exe?x=1`, URL_SUMS],
    [`${base}/desktop-v0.2.0/Everloot-DesktopApp-0.2.0-win-x64-portable.exe`, URL_SUMS],
    [`${base}/desktop-v0.2.0/Everloot-DesktopApp-0.2.0-mac-arm64.dmg`, URL_SUMS],
    [`${base}/desktop-v0.2.0/setup.bat`, URL_SUMS],
    [`${base}/desktop-v0.2.0/CON.exe`, URL_SUMS],
    [`${base}/desktop-v0.2.0/Everloot-DesktopApp-0.2.0-win-x64-setup.exe%00.txt`, URL_SUMS],
    [`${base}/desktop-v0.2.0/Everloot-DesktopApp-0.2.0-win-x64%2Fsetup.exe`, URL_SUMS],
    [`${base}/addon-v0.2.0/Everloot-DesktopApp-0.2.0-win-x64-setup.exe`, `${base}/addon-v0.2.0/SHA256SUMS`],
    // The installer's name, its tag and its checksum file all name the same release.
    [`${base}/desktop-v0.2.0/Everloot-DesktopApp-0.1.0-win-x64-setup.exe`, URL_SUMS],
    [URL_EXE, `${base}/desktop-v0.1.0/SHA256SUMS`],
    [URL_EXE, "https://evil.example/Everloot/everloot/releases/download/desktop-v0.2.0/SHA256SUMS"],
    [URL_EXE, `${base}/desktop-v0.2.0/SHA256SUMS.txt`],
  ];
  for (const [url, sumsUrl] of hostile) {
    const send = fake(sums);
    await expect(downloadUpdate({ url, sumsUrl, dir: dir(), send }), url).rejects.toThrow(/not an Everloot Desktop App release/);
    expect(send, url).not.toHaveBeenCalled();
  }
  // And the release the app announced, not another one.
  const send = fake(sums);
  await expect(downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, version: "0.3.0", dir: dir(), send })).rejects.toThrow(/not an Everloot Desktop App release/);
  expect(send).not.toHaveBeenCalled();
});

test("an encoded path separator in the file name cannot write outside the updates folder", async () => {
  const root = dir();
  const d = join(root, "data", "updates");
  const name = "..\\escaped.exe";
  const url = `https://github.com/Everloot/everloot/releases/download/desktop-v0.2.0/..%5Cescaped.exe`;
  await expect(downloadUpdate({ url, sumsUrl: URL_SUMS, dir: d, send: fake(`${sha(installer)}  ${name}\n`) })).rejects.toThrow(/not an Everloot Desktop App release/);
  expect(existsSync(join(root, "data", "escaped.exe"))).toBe(false);
});

test("GitHub's redirect to its download host is followed, but not one off HTTPS", async () => {
  const signed = "https://release-assets.githubusercontent.com/github-production-release-asset/1/abc?sp=r&sig=x";
  const redirected = (to: string) => vi.fn(async (url: string) => {
    const res = url === URL_SUMS
      ? new Response(`${sha(installer)}  Everloot-DesktopApp-0.2.0-win-x64-setup.exe\n`, { status: 200 })
      : new Response(installer, { status: 200, headers: { "content-length": String(installer.length) } });
    Object.defineProperty(res, "url", { value: to });
    return res;
  }) as unknown as typeof fetch;
  const d = dir();
  expect(await downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, version: "0.2.0", dir: d, send: redirected(signed) })).toBe(join(d, "Everloot-DesktopApp-0.2.0-win-x64-setup.exe"));
  await expect(downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, dir: dir(), send: redirected("http://release-assets.githubusercontent.com/x") })).rejects.toThrow(/HTTPS/);
});

const SUMS_OK = `${sha(installer)}  Everloot-DesktopApp-0.2.0-win-x64-setup.exe\n`;
const TARGET = "Everloot-DesktopApp-0.2.0-win-x64-setup.exe";

/** A body that hands out `chunk` `times` times, saying `length` (or nothing) up front, and records whether it was cancelled. */
function streamed(chunk: Buffer, times: number, length?: number) {
  const state = { sent: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(c) { if (state.sent++ < times) c.enqueue(new Uint8Array(chunk)); else c.close(); },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  const headers = length === undefined ? undefined : { "content-length": String(length) };
  return { state, send: vi.fn(async (url: string) => (url === URL_SUMS ? new Response(SUMS_OK, { status: 200 }) : new Response(body, { status: 200, headers }))) as unknown as typeof fetch };
}

/** The updates folder holding last time's verified installer, to show a failed download leaves it alone. */
function withOldInstaller() {
  const d = dir();
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, TARGET), "old verified installer");
  return d;
}
const untouched = (d: string) => {
  expect(readFileSync(join(d, TARGET), "utf8")).toBe("old verified installer");
  expect(readdirSync(d)).toEqual([TARGET]);
};

test("an installer declared larger than the limit is refused before it is read", async () => {
  const d = withOldInstaller();
  const { state, send } = streamed(Buffer.alloc(1024), 4, 10_000);
  await expect(downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, dir: d, send, limit: 4096 })).rejects.toThrow(/over the 4096 bytes allowed/);
  expect(state.sent).toBe(0);
  untouched(d);
});

test("an installer that streams past the limit, with no length or a false one, stops there and keeps the old one", async () => {
  for (const length of [undefined, 1024]) {
    const d = withOldInstaller();
    const { state, send } = streamed(Buffer.alloc(1024), 100, length);
    await expect(downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, dir: d, send, limit: 4096 })).rejects.toThrow(/over the 4096 bytes allowed/);
    expect(state.sent).toBeLessThan(10);
    expect(state.cancelled).toBe(true);
    untouched(d);
  }
});

test("a download that breaks part way leaves no partial file and keeps the old installer", async () => {
  const d = withOldInstaller();
  let n = 0;
  const body = new ReadableStream<Uint8Array>({ pull(c) { if (n++ < 2) c.enqueue(new Uint8Array(1024)); else c.error(new Error("connection reset")); } });
  const send = vi.fn(async (url: string) => (url === URL_SUMS ? new Response(SUMS_OK, { status: 200 }) : new Response(body, { status: 200 }))) as unknown as typeof fetch;
  await expect(downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, dir: d, send })).rejects.toThrow(/connection reset/);
  untouched(d);
});

test("a checksum failure or a missing entry keeps the old installer", async () => {
  const d = withOldInstaller();
  await expect(downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, dir: d, send: fake(`${"0".repeat(64)}  ${TARGET}\n`) })).rejects.toThrow(/does not match/);
  untouched(d);
  await expect(downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, dir: d, send: fake(`${sha(installer)}  other.exe\n`) })).rejects.toThrow(/not listed/);
  untouched(d);
});

test("a verified download replaces the old installer", async () => {
  const d = withOldInstaller();
  const path = await downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, version: "0.2.0", dir: d, send: fake(SUMS_OK) });
  expect(readFileSync(path).equals(installer)).toBe(true);
  expect(readdirSync(d)).toEqual([TARGET]);
});

test("short writes are completed before a verified installer replaces the old one", async () => {
  const { open: realOpen } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  let writes = 0;
  vi.mocked(open).mockImplementationOnce(async (...args) => {
    const out = await realOpen(...args);
    const write = out.write.bind(out);
    out.write = (async (buffer: Uint8Array, offset = 0, length = buffer.length - offset) => {
      writes++;
      return write(buffer, offset, Math.min(length, 4096));
    }) as typeof out.write;
    return out;
  });
  const d = withOldInstaller();
  const path = await downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, dir: d, send: fake(SUMS_OK) });
  expect(readFileSync(path).equals(installer)).toBe(true);
  expect(writes).toBeGreaterThan(1);
  expect(sha(readFileSync(path))).toBe(sha(installer));
  expect(readdirSync(d)).toEqual([TARGET]);
});

test("a write that makes no progress fails safely and retains the old installer", async () => {
  const { open: realOpen } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(open).mockImplementationOnce(async (...args) => {
    const out = await realOpen(...args);
    out.write = (async (buffer: Uint8Array) => ({ bytesWritten: 0, buffer })) as typeof out.write;
    return out;
  });
  const d = withOldInstaller();
  await expect(downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, dir: d, send: fake(SUMS_OK) })).rejects.toThrow(/could not be written/);
  untouched(d);
});

for (const stage of ["checksums", "installer"]) for (const failure of ["status", "redirect"]) {
  test(`an early ${stage} ${failure} refusal cancels its body`, async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const send = vi.fn(async (url: string) => {
      if (stage === "installer" && url === URL_SUMS) return new Response(SUMS_OK);
      const res = new Response(body, { status: failure === "status" ? 503 : 200 });
      Object.defineProperty(res, "url", { value: failure === "redirect" ? "http://example.test/file" : url });
      return res;
    }) as unknown as typeof fetch;
    const d = withOldInstaller();
    await expect(downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, dir: d, send })).rejects.toThrow();
    expect(cancelled).toBe(true);
    untouched(d);
  });
}

test("a disk-open failure cancels the installer body and keeps the old installer", async () => {
  vi.mocked(open).mockRejectedValueOnce(new Error("disk unavailable"));
  const { state, send } = streamed(installer, 1);
  const d = withOldInstaller();
  await expect(downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, dir: d, send })).rejects.toThrow("disk unavailable");
  expect(state.cancelled).toBe(true);
  untouched(d);
});

test("an oversized checksum file is refused without reading it all", async () => {
  let pulled = 0;
  const huge = new ReadableStream<Uint8Array>({ pull(c) { if (pulled++ < 64) c.enqueue(new Uint8Array(16 * 1024)); else c.close(); } });
  const send = vi.fn(async () => new Response(huge, { status: 200 })) as unknown as typeof fetch;
  await expect(downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, dir: dir(), send })).rejects.toThrow(/release checksums.*over the/);
  expect(pulled).toBeLessThan(10);
  expect(send).toHaveBeenCalledTimes(1);
  const declared = vi.fn(async () => new Response("x", { status: 200, headers: { "content-length": String(10 * 1024 * 1024) } })) as unknown as typeof fetch;
  await expect(downloadUpdate({ url: URL_EXE, sumsUrl: URL_SUMS, dir: dir(), send: declared })).rejects.toThrow(/release checksums.*over the/);
});

/** A stand-in child process: `launch` returns it, and the test decides whether it spawns or fails. */
function child() {
  const c = Object.assign(new EventEmitter(), { unref: vi.fn() });
  return { c, launch: vi.fn(() => c) };
}

test("the installer starts silent and detached, and reports started only once it has spawned", async () => {
  const { c, launch } = child();
  let started = false;
  const run = runInstaller("C:/data/updates/setup.exe", launch as never).then(() => { started = true; });
  expect(launch).toHaveBeenCalledWith("C:/data/updates/setup.exe", ["/S", "--force-run"], { detached: true, stdio: "ignore" });
  await Promise.resolve();
  expect(started).toBe(false);
  c.emit("spawn");
  await run;
  expect(started).toBe(true);
  expect(c.unref).toHaveBeenCalled();
  // A later error from the detached child is not an uncaught exception in the app.
  expect(() => c.emit("error", new Error("late"))).not.toThrow();
});

test("an installer that cannot start is reported, whether spawn throws or fails later", async () => {
  const { c, launch } = child();
  const run = runInstaller("C:/data/updates/setup.exe", launch as never);
  c.emit("error", Object.assign(new Error("spawn EACCES"), { code: "EACCES" }));
  await expect(run).rejects.toThrow(/EACCES/);
  expect(c.unref).not.toHaveBeenCalled();
  const throws = vi.fn(() => { throw new Error("spawn EINVAL"); });
  await expect(runInstaller("C:/data/updates/setup.exe", throws as never)).rejects.toThrow(/EINVAL/);
});
