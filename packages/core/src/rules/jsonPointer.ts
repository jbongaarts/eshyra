/**
 * Strict RFC 6901 JSON Pointer resolution over parsed JSON data
 * (eshyra-o9bd.19.2.2.3). Shared by `validate.ts` (the pack-loader boundary for
 * `RecordProvenance.fieldLocators`) and the importer's locator-completeness
 * gate, so both apply identical semantics.
 *
 * - Object segments match OWN properties only: `/toString` or `/constructor`
 *   never resolve through `Object.prototype`.
 * - Array segments must be canonical RFC 6901 indices (`0` or a digit string
 *   without a leading zero) within bounds; `01`, `-`, `1.0`, `+1` do not
 *   resolve.
 * - `~1` decodes to `/` and `~0` to `~`, in that order. Any other `~` escape
 *   makes the pointer invalid.
 * - The pointer must be empty (the whole document) or start with `/`.
 */

const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;
const INVALID_ESCAPE = /~(?![01])/;

export type JsonPointerResolution =
  | { readonly found: true; readonly value: unknown }
  | { readonly found: false };

export function resolveJsonPointer(
  data: unknown,
  pointer: string,
): JsonPointerResolution {
  if (pointer === '') return { found: true, value: data };
  if (!pointer.startsWith('/')) return { found: false };
  let current: unknown = data;
  for (const raw of pointer.slice(1).split('/')) {
    if (INVALID_ESCAPE.test(raw)) return { found: false };
    const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      if (!ARRAY_INDEX.test(segment)) return { found: false };
      const index = Number(segment);
      if (index >= current.length) return { found: false };
      current = current[index];
      continue;
    }
    if (
      typeof current !== 'object' ||
      current === null ||
      !Object.hasOwn(current, segment)
    ) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}
