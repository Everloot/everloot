const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Every `{"$map": [...]}` (and, unless `sets` is false, `{"$set": [...]}`) in parsed JSON turned back into a Map or Set,
 * in place and innermost first, as a JSON.parse reviver would. Done after the parse because a reviver makes V8 keep the
 * source text of every value while it parses: on the stored aggregates that was about 40 MB more heap at once and four
 * times the CPU.
 */
export function reviveMapsAndSets(value: unknown, sets = true): unknown {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = reviveMapsAndSets(value[i], sets);
    return value;
  }
  if (!isObject(value)) return value;
  const keys = Object.keys(value);
  for (const key of keys) {
    const next = reviveMapsAndSets(value[key], sets);
    // Defined, not assigned, as JSON.parse defines it: a "__proto__" key stays a plain property.
    if (next !== value[key]) Object.defineProperty(value, key, { value: next, writable: true, enumerable: true, configurable: true });
  }
  if (keys.length === 1 && keys[0] === "$map" && Array.isArray(value.$map)) return new Map(value.$map as [unknown, unknown][]);
  if (sets && keys.length === 1 && keys[0] === "$set" && Array.isArray(value.$set)) return new Set(value.$set);
  return value;
}
