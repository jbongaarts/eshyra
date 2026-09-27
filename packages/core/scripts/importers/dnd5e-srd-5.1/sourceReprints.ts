/** Reviewed source pages that reprint content already emitted in a record. */
export const REPRINTED_RECORD_SOURCE_PAGES: ReadonlyMap<
  string,
  { readonly page: number; readonly reason: string }
> = new Map([
  [
    'table:size-categories',
    {
      page: 92,
      reason: 'combat-chapter reprint of the Size and Space columns',
    },
  ],
]);
