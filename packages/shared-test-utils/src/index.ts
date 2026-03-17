export function assertStringFields(
  value: Record<string, unknown>,
  keys: string[],
): void {
  for (const key of keys) {
    if (typeof value[key] !== 'string') {
      throw new Error(`Expected "${key}" to be a string.`);
    }
  }
}
