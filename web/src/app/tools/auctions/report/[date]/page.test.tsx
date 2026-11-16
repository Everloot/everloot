import { expect, test, vi } from "vitest";
vi.mock("@/lib/auction-report-store", () => ({ storedAuctionReport: vi.fn().mockResolvedValue(null) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); } }));
import Page, { generateMetadata } from "./page";
test("unknown archive dates 404 in page and metadata", async () => {
 const props = { params: Promise.resolve({ date: "2020-01-01" }) };
 await expect(Page(props)).rejects.toThrow("404");
 await expect(generateMetadata(props)).rejects.toThrow("404");
});
