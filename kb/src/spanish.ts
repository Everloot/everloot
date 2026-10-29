/**
 * Spanish questions against an English knowledge base. Many Spanish-speaking players run the English client and
 * ask in Spanish: the names are already English ("cuánto cuesta Black Lotus"), but the words that say what is asked
 * are not, and the wiki is English, so "cuánto cuesta un mount" met pages that only share "mount"
 * (docs/evals/question-eval-2026-10-29-spanish.md). A question that reads as Spanish loses its Spanish filler words
 * and has its asking words glossed into the English the pages use; an English question is never touched, and no
 * word inside a name is looked up unless it is one of these Spanish words.
 */

const TOKEN = /[\p{L}\p{N}]+/gu;

/** A word without its accents, lower case: "Dónde" is "donde". The search index folds accents the same way. */
const fold = (word: string) => word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Words only a Spanish question has; one of them, or an ¿ or ¡, marks the question as Spanish. */
const MARKERS = new Set([
  "que", "donde", "como", "cuanto", "cuanta", "cuantos", "cual", "cuales", "quien", "cuando",
  "hay", "necesito", "puedo", "debo", "consigo", "llego", "para", "del", "una",
]);

/** Spanish words that carry no meaning for a lookup, as the English stopwords do ("dónde queda" is "where is"). */
const FILLER = new Set([
  ...MARKERS,
  "a", "al", "con", "de", "el", "en", "es", "esta", "estan", "la", "las", "lo", "los", "me", "mi", "mis", "o",
  "por", "queda", "quedan", "se", "son", "su", "sus", "un", "unos", "unas", "y", "da", "dan", "trae", "traen",
  "tiene", "tienen", "tengo", "conseguir", "llegar", "voy", "ir",
]);

/** Asking words in Spanish, by their folded form, and the word the English pages use for each. */
const GLOSS: Readonly<Record<string, string>> = {
  // Not "vale" (worth): it is half of Stranglethorn Vale.
  cuesta: "cost", cuestan: "cost", costo: "cost", coste: "cost", precio: "price",
  aprendo: "learn", aprender: "learn", aprende: "learn",
  nivel: "level", subir: "level", subo: "level",
  oro: "gold", ruta: "route", rapida: "fastest", rapido: "fastest",
  mejor: "best", mejores: "best", clase: "class", clases: "classes",
  profesion: "profession", profesiones: "professions", llave: "key", recompensa: "reward",
  vende: "sells", venden: "sells", dropea: "drop", dropean: "drop", entrada: "entrance",
  jefe: "boss", jefes: "bosses", mision: "quest", misiones: "quests", logro: "achievement", logros: "achievements",
  montura: "mount", monturas: "mounts", raza: "race", razas: "races", faccion: "faction", jugadores: "players",
  personaje: "character", datos: "data", hago: "make", hacer: "make", completo: "complete",
  sale: "launch", talento: "talent", talentos: "talents", mazmorra: "dungeon", vuelo: "fly", volar: "fly",
};

/** Whether the question reads as Spanish: an inverted mark, or a word only Spanish questions use. */
export function readsAsSpanish(text: string): boolean {
  return /[¿¡]/.test(text) || (text.match(TOKEN) ?? []).some((w) => MARKERS.has(fold(w)));
}

/**
 * The question as the English pages would word it: Spanish filler dropped, asking words glossed, every other
 * word (the names) as it was. A capitalized word after the first is taken as part of a name and kept ("El Pollo
 * Grande"). An English question comes back unchanged, and so does one that would be left empty.
 */
export function fromSpanish(text: string): string {
  if (!readsAsSpanish(text)) return text;
  const kept = (text.match(TOKEN) ?? []).flatMap((w, i) => {
    if (i > 0 && w[0] !== w[0]!.toLowerCase()) return [w];
    const f = fold(w);
    if (FILLER.has(f)) return [];
    return [GLOSS[f] ?? w];
  });
  return kept.length ? kept.join(" ") : text;
}
