import type { NextFunction, Request, Response } from "express";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function asyncHandler<TRequest extends Request>(
  handler: (req: TRequest, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req as TRequest, res, next)).catch(next);
  };
}

export function sendError(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  const candidate = error as { message?: string };
  console.error(error);
  void candidate;
  res.status(500).json({ error: "Unexpected server error" });
}
