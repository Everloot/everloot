import type { Box } from "./map-view";

export interface CoordinatePin { x: number; y: number }
const valid = ({ x, y }: CoordinatePin) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 100 && y >= 0 && y <= 100;

/** Pins use the game's full continent rectangle, never the current camera's bounds. */
export function mapCoordinates(bounds: Box, point: CoordinatePin): CoordinatePin | null {
  const pin = { x: (point.x - bounds.x) / bounds.width * 100, y: (point.y - bounds.y) / bounds.height * 100 };
  return valid(pin) ? pin : null;
}

export function mapPoint(bounds: Box, pin: CoordinatePin): CoordinatePin {
  return { x: bounds.x + pin.x / 100 * bounds.width, y: bounds.y + pin.y / 100 * bounds.height };
}

export function parseCoordinatePin(text: string | null | undefined): CoordinatePin | null {
  if (!text || !/^\d+(?:\.\d+)?,\d+(?:\.\d+)?$/.test(text)) return null;
  const [x, y] = text.split(",").map(Number);
  const pin = { x: x!, y: y! };
  return valid(pin) ? pin : null;
}

export function serialiseCoordinatePin(pin: CoordinatePin): string {
  return `${Number(pin.x.toFixed(4))},${Number(pin.y.toFixed(4))}`;
}
