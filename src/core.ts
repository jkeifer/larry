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

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
