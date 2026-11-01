import { expect, test } from "vitest";
import { loginItemOptions } from "../src/main/login-item";

test("the installed Windows app and macOS keep Electron's default executable", () => {
  expect(loginItemOptions("win32", true, undefined)).toEqual({ openAtLogin: true, args: ["--hidden"] });
  expect(loginItemOptions("darwin", false, undefined)).toEqual({ openAtLogin: false, args: ["--hidden"] });
});

test("the portable Windows exe signs in with itself, not the temporary folder it unpacks to", () => {
  expect(loginItemOptions("win32", true, "D:\\Tools\\Everloot Desktop App 0.1.10.exe")).toEqual({ openAtLogin: true, args: ["--hidden"], path: "D:\\Tools\\Everloot Desktop App 0.1.10.exe" });
  // Turning it off names the same entry.
  expect(loginItemOptions("win32", false, "D:\\Tools\\Everloot.exe")).toMatchObject({ openAtLogin: false, path: "D:\\Tools\\Everloot.exe" });
  expect(loginItemOptions("win32", true, "")).toEqual({ openAtLogin: true, args: ["--hidden"] });
});

test("Linux has no login item", () => {
  expect(loginItemOptions("linux", true, undefined)).toBeNull();
});
