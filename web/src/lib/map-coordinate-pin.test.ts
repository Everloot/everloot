import { expect, test } from "vitest";
import { mapCoordinates, mapPoint, parseCoordinatePin, serialiseCoordinatePin } from "./map-coordinate-pin";

test("coordinates use the map bounds with east and south increasing", () => {
  const bounds = { x: -200, y: -100, width: 1000, height: 500 };
  expect(mapCoordinates(bounds, { x: 50, y: 200 })).toEqual({ x: 25, y: 60 });
  expect(mapPoint(bounds, { x: 25, y: 60 })).toEqual({ x: 50, y: 200 });
  expect(mapCoordinates(bounds, { x: -201, y: 0 })).toBeNull();
});

test("coordinate pins parse and serialise including the map edges", () => {
  for (const text of ["0,100", "25.5,60", "100,0"]) {
    expect(serialiseCoordinatePin(parseCoordinatePin(text)!)).toBe(text);
  }
});

test.each([null, "", "1", "1,2,3", ",2", "1,", "NaN,2", "Infinity,2", "0x10,2", "1e2,2", "-1,2", "101,2", "2,-0.1", "2,100.1", "n123"])("ignores invalid pin %s", (text) => {
  expect(parseCoordinatePin(text)).toBeNull();
});
