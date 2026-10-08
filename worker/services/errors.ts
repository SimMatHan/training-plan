/** Fejl som routes oversætter til HTTP-statuskoder (og MCP til værktøjsfejl). */
export class NotFoundError extends Error {
  readonly status = 404;
}

export class ValidationError extends Error {
  readonly status = 400;
}

/** Tilstanden er ændret, fx et forslag der allerede er afgjort eller en session der allerede er logget. */
export class ConflictError extends Error {
  readonly status = 409;
}

/** Brugeren har adgang til atleten, men ikke med den rolle handlingen kræver (fx en træner der vil godkende). */
export class ForbiddenError extends Error {
  readonly status = 403;
}
