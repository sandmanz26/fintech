/** Domain errors carry an HTTP status and a stable code for the API error envelope. */
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
    public details?: unknown,
  ) {
    super(message);
  }
}

export class NotFoundError extends DomainError {
  constructor(what = "Resource") {
    super("NOT_FOUND", `${what} not found.`, 404);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("CONFLICT", message, 409, details);
  }
}

export class IllegalTransitionError extends DomainError {
  constructor(entity: string, from: string, to: string) {
    super("ILLEGAL_TRANSITION", `${entity} cannot move from ${from} to ${to}.`, 409, { from, to });
  }
}
