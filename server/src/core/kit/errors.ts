/**
 * The one error model the API uses. Throw one of these from a route (or let a rejected
 * promise carry it — Express 5 forwards async rejections) and `errorHandler` turns it into the
 * single error body: `{ error: string, issues?: string[] }`.
 *
 * `message` is always safe to show a user. Anything that is not an HttpError is treated as an
 * internal failure and never has its message echoed to the caller.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly issues?: string[];

  constructor(status: number, message: string, issues?: string[]) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    if (issues && issues.length > 0) this.issues = issues;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = "Bad request", issues?: string[]) {
    super(400, message, issues);
    this.name = "BadRequestError";
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Unauthorized") {
    super(401, message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden") {
    super(403, message);
    this.name = "ForbiddenError";
  }
}

/**
 * Also what is sent for "exists but you can't see it": a caller cannot tell the two apart, so reach for this rather than ForbiddenError when hiding existence.
 */
export class NotFoundError extends HttpError {
  constructor(message = "Not found") {
    super(404, message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends HttpError {
  constructor(message = "Conflict") {
    super(409, message);
    this.name = "ConflictError";
  }
}
