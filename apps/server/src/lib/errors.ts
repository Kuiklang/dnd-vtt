export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "bad_request", message, details);
export const unauthorized = (message = "You need to sign in") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "You don't have permission to do that") =>
  new HttpError(403, "forbidden", message);
export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found`);
export const conflict = (message: string, details?: unknown) => new HttpError(409, "conflict", message, details);
