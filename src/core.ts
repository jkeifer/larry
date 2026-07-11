// Pure, DOM-free helpers — unit-tested in test/unit/core.test.ts.
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Kind = "object" | "array" | "string" | "number" | "boolean" | "null";

export const URL_RE = /^https?:\/\/[^\s]+$/i;

export function kindOf(v: Json): Kind {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "object") return "object";
  return t as Kind; // "string" | "number" | "boolean"
}

export function isContainer(k: Kind): boolean {
  return k === "object" || k === "array";
}

export function childCountOf(v: Json, k: Kind): number {
  if (k === "array") return (v as Json[]).length;
  if (k === "object") return Object.keys(v as object).length;
  return 0;
}

export function* entriesOf(v: Json, k: Kind): Generator<[string, Json]> {
  if (k === "array") {
    const a = v as Json[];
    for (let i = 0; i < a.length; i++) yield [String(i), a[i]];
  } else if (k === "object") {
    const o = v as { [k: string]: Json };
    for (const key of Object.keys(o)) yield [key, o[key]];
  }
}

export function childPath(parent: string, label: string, parentKind: Kind): string {
  return parentKind === "array" ? `${parent}[${label}]` : `${parent}[${JSON.stringify(label)}]`;
}

// Splice `items` into `arr` at `index` without hitting the argument-count
// limit that `arr.splice(i, 0, ...huge)` triggers for very large arrays.
export function spliceInto<T>(arr: T[], index: number, items: T[]): void {
  const CHUNK = 30000;
  if (items.length <= CHUNK) {
    arr.splice(index, 0, ...items);
    return;
  }
  const tail = arr.splice(index); // detach everything from index onward
  for (let i = 0; i < items.length; i += CHUNK) {
    arr.push.apply(arr, items.slice(i, i + CHUNK));
  }
  for (let i = 0; i < tail.length; i += CHUNK) {
    arr.push.apply(arr, tail.slice(i, i + CHUNK));
  }
}

// The lowercased haystack a find query is matched against for one row: its
// key/label plus, for scalar rows, the rendered value. Container rows (object
// /array) contribute only their label — never their nested contents — and a
// row with no label and a non-scalar value (e.g. a synthetic closing bracket)
// yields an empty string so it can never match. Case-insensitive by design.
export function searchableText(label: string | null, kind: Kind, value: Json): string {
  let s = label ?? "";
  if (kind === "string") s += " " + (value as string);
  else if (kind === "number" || kind === "boolean") s += " " + String(value);
  else if (kind === "null") s += " null";
  return s.trim().length ? s.toLowerCase() : "";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Converts a stored row path (bracket form, e.g. $["links"][3]["href"]) into
// the jq expression that selects the same value (e.g. .links[3].href).
// Numeric tokens are true array indices (unquoted in the stored path) and
// render as [n]; string tokens are object keys and render as bare .key when
// the key is a valid identifier, else as bracket-quoted .["key"] — including
// digit-only string keys (a JSON key of "123" is a quoted object lookup, not
// an array index, so it must stay bracket-quoted).
export function pathToJq(path: string): string {
  let out = "";
  const re = /\[("(?:[^"\\]|\\.)*"|\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    const token = m[1];
    if (/^\d+$/.test(token)) {
      out += `[${token}]`;
    } else {
      const key = JSON.parse(token) as string; // the raw key
      out += /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `.${key}` : `.[${token}]`;
    }
  }
  return out === "" ? "." : out;
}

// Returns the parsed records if `raw` is newline-delimited JSON (>=2 records,
// every non-blank line valid), else null.
export function tryParseNdjson(raw: string): Json[] | null {
  const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return null;
  const out: Json[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as Json);
    } catch {
      return null;
    }
  }
  return out;
}
