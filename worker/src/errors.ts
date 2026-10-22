export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly publicMessage: string,
  ) {
    super(publicMessage);
  }
}

export const unauthorized = () => new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
export const forbidden = () => new ApiError(403, "FORBIDDEN", "Access denied.");
export const notFound = () => new ApiError(404, "NOT_FOUND", "Resource not found.");
export const badRequest = (message: string) => new ApiError(400, "INVALID_INPUT", message);
export const unavailable = () => new ApiError(503, "SERVICE_UNAVAILABLE", "Service unavailable.");

export function json(data: unknown, status = 200, requestId?: string): Response {
  return Response.json(data, {
    status,
    headers: requestId ? { "X-Request-Id": requestId, "Cache-Control": "no-store" } : { "Cache-Control": "no-store" },
  });
}
