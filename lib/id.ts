/** Short unique ids. `crypto.randomUUID` is available in all extension contexts
 * and the page (MAIN) world (secure context). */
export function uid(prefix = ''): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return prefix ? `${prefix}_${uuid}` : uuid;
}
