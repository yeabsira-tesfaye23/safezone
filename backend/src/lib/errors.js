// Errors that carry an HTTP status. Route handlers throw these; the error middleware turns them into JSON.
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const badRequest = (m = 'Invalid request', code) => new HttpError(400, m, code);
export const unauthorized = (m = 'Authentication required', code) => new HttpError(401, m, code);
export const forbidden = (m = 'You are not allowed to do that', code) => new HttpError(403, m, code);
export const notFound = (m = 'Not found', code) => new HttpError(404, m, code);
export const conflict = (m = 'Conflict', code) => new HttpError(409, m, code);
