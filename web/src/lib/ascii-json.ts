/**
 * A response's JSON text with every character outside ASCII written as a `\uXXXX` escape, which JSON reads as the same
 * character, so the text parses to the same value as `res.text()`.
 *
 * Why: V8 keeps a string at one byte per character only when every character fits in one byte. The stored aggregates
 * hold a few thousand that do not (curly quotes, accented names), so `res.text()` made the whole 9 MB file a string of
 * two bytes per character, 19 MB on the heap for as long as it was parsed. Read here it is about half that. The body is
 * copied into one buffer piece by piece as it arrives, so it is not held twice either.
 *
 * Read as `res.text()` reads it otherwise: a leading byte order mark is dropped, and broken bytes become U+FFFD.
 */
export async function asciiJsonText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const size = Number(res.headers.get("content-length"));
  const known = Number.isFinite(size) && size > 0;
  let out = new Uint8Array(known ? size + (size >> 5) : 1 << 16);
  let o = 0;
  const room = (n: number) => {
    if (o + n <= out.length) return;
    // A known size leaves little to grow by: a few escapes, not a second copy of the file.
    const bigger = new Uint8Array(Math.max(o + n, known ? out.length + (out.length >> 3) : out.length * 2));
    bigger.set(out.subarray(0, o));
    out = bigger;
  };
  // Runs of non-ASCII bytes end at an ASCII byte, which UTF-8 never uses inside a character, so each run decodes alone
  // to what decoding the whole body gives it. A run that reaches the end of a piece waits for the next one (`carry`).
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  let atStart = true;
  const wide = (run: Uint8Array) => {
    let text = decoder.decode(run);
    if (atStart && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    atStart = false;
    room(text.length * 6 + 1);
    // After an odd number of backslashes the character was an escape JSON does not have: a control character keeps
    // that text failing to parse instead of turning it into an escaped backslash.
    let b = o;
    while (b > 0 && out[b - 1] === BACKSLASH) b--;
    if ((o - b) % 2 === 1) out[o++] = 0x01;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      out[o++] = BACKSLASH; out[o++] = U;
      out[o++] = HEX[c >> 12]; out[o++] = HEX[(c >> 8) & 15]; out[o++] = HEX[(c >> 4) & 15]; out[o++] = HEX[c & 15];
    }
  };
  let carry: Uint8Array | null = null;
  for (;;) {
    const { done, value: piece } = await reader.read();
    if (done) break;
    const n = piece.length;
    let i = 0;
    if (carry) {
      while (i < n && piece[i] >= 0x80) i++;
      const run: Uint8Array = new Uint8Array(carry.length + i);
      run.set(carry);
      run.set(piece.subarray(0, i), carry.length);
      carry = null;
      if (i === n) { carry = run; continue; }
      wide(run);
    }
    while (i < n) {
      let j = i;
      while (j < n && piece[j] < 0x80) j++;
      if (j > i) {
        room(j - i);
        out.set(piece.subarray(i, j), o);
        o += j - i;
        atStart = false;
      }
      if (j === n) break;
      let k = j;
      while (k < n && piece[k] >= 0x80) k++;
      if (k === n) { carry = piece.slice(j); break; }
      wide(piece.subarray(j, k));
      i = k;
    }
  }
  if (carry) wide(carry);
  return new TextDecoder().decode(out.subarray(0, o));
}

const BACKSLASH = 0x5c;
const U = 0x75;
const HEX = new Uint8Array([..."0123456789abcdef"].map((c) => c.charCodeAt(0)));
