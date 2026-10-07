/**
 * Deterministisk UUID (version 8, RFC 9562) ud fra en nøgle, fx træning + øvelse + side + sæt.
 * Samme sæt får altid samme uuid, så hurtige ændringer aldrig kan oprette dubletter —
 * heller ikke på tværs af enheder.
 */
export async function deterministicUuid(...parts: (string | number | null)[]): Promise<string> {
  const data = new TextEncoder().encode(parts.map((p) => p ?? '-').join('|'));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', data)).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
