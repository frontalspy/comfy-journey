/**
 * localStorage for per-browser conveniences only (theme, drafts, remembered prompts). It can be
 * missing, full or blocked, and anything read from it is untrusted, so every read is parsed by
 * the caller's validator and every access is guarded.
 */
export function readStored<T>(
  key: string,
  validate: (raw: unknown) => T | undefined,
): T | undefined {
  try {
    const text = localStorage.getItem(key);
    if (text === null) return undefined;
    return validate(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable or full: the app works without it.
  }
}

export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to clean up.
  }
}
