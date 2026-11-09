import { expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({
  permanentRedirect: (to: string) => { throw new Error(`308 ${to}`); },
  redirect: (to: string) => { throw new Error(`307 ${to}`); },
}));

import Completionist from "./completionist/page";
import Database from "./database/page";
import GuildTracker from "./guild-tracker/page";
import ProfessionPlanner from "./profession-planner/page";

test("each retired tool address answers 308 to the page that replaced it", () => {
  expect(() => Database()).toThrow("308 /database");
  expect(() => Completionist()).toThrow("308 /tools/collections");
  expect(() => GuildTracker()).toThrow("308 /tools/guild-board");
  expect(() => ProfessionPlanner()).toThrow("308 /tools/professions");
});
