// Claudes forslag til planen, som API'et sender dem til appen. Uden zod, så frontenden kan importere typen.

export const PROPOSAL_STATUSES = ['afventer', 'godkendt', 'afvist', 'forældet'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface Proposal {
  id: string;
  createdAt: string;
  baseVersion: number;
  summary: string;
  rationale: string;
  status: ProposalStatus;
  decidedAt: string | null;
  resultVersion: number | null;
  /** Læsbare ændringer, fx "Styrke A · Enbens RDL, uge 5–8: 3 × 8/side → 3 × 10/side". */
  diff: string[];
}

/** Et MCP-kald i revisionsloggen. Aldrig input-indhold. */
export interface McpAuditEntry {
  at: string;
  tool: string;
  ok: boolean;
  error: 'ugyldigt-input' | 'ikke-fundet' | 'konflikt' | 'serverfejl' | null;
  durationMs: number | null;
}
