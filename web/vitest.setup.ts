import { vi } from "vitest";

// Test fixtures carry hand-picked dates, so the live scopes in kb/curated/recheck.json would cut their reports off
// as soon as a scope's date passes them. Tests read no curated scopes; a test that needs some mocks this module itself.
vi.mock("./src/lib/recheck-scopes", () => ({ RECHECK_SCOPES: [] }));
