/** Fejl som routes oversætter til HTTP-statuskoder (og MCP til værktøjsfejl). */
export class NotFoundError extends Error {
  readonly status = 404;
}

export class ValidationError extends Error {
  readonly status = 400;
}
