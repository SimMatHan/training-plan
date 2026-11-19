// Øvelser med to muligheder i navnet, fx "Kabelrows eller håndvægtsrows".

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Mulighederne i et navn som "Kabelrows eller håndvægtsrows" → ["Kabelrows", "Håndvægtsrows"]. Tom liste uden "eller". */
export function exerciseChoices(name: string): string[] {
  const parts = name
    .split(/\s+eller\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts.map(capitalize) : [];
}
