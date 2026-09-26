/** The dotted paths of a failed `safeParse`'s issues, e.g. `['addresses.0.pincode']`. */
export const pathsOf = (result: {
  error?: { issues: { path: PropertyKey[] }[] } | undefined;
}): string[] => (result.error?.issues ?? []).map((i) => i.path.map(String).join('.'));

/** The keys a strict schema reported as unrecognised. */
export const unrecognizedKeysOf = (result: {
  error?: { issues: { code: string; keys?: string[] }[] } | undefined;
}): string[] =>
  (result.error?.issues ?? []).flatMap((i) =>
    i.code === 'unrecognized_keys' ? (i.keys ?? []) : [],
  );
