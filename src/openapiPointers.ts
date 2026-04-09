import { isRecord } from "./json.js";

function decodePointerSegment(segment: string): string {
  // https://datatracker.ietf.org/doc/html/rfc6901
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function resolveJsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === "#" || pointer === "") return root;
  if (!pointer.startsWith("#/")) return undefined;

  const path = pointer
    .slice(2)
    .split("/")
    .map(decodePointerSegment);

  let current: unknown = root;
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (isRecord(current)) {
      current = current[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

export function resolveRef(spec: unknown, ref: string): unknown {
  return resolveJsonPointer(spec, ref);
}
