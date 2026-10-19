import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export const id = (bytes = 12) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error') { super(message); }
}
export const fail = (status: number, message: string, code?: string): never => { throw new HttpError(status, message, code); };

/** Lets route handlers be async and still reach the error handler. */
export const route = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  try { return schema.parse(data); } catch (e) {
    if (e instanceof ZodError) {
      const first = e.issues[0];
      fail(400, first?.message || 'Check the details and try again.', 'invalid');
    }
    throw e;
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  if ((err as { type?: string }).type === 'entity.too.large') return res.status(413).json({ error: 'That is too large to save.', code: 'too_large' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Try again in a moment.', code: 'server' });
}

export const PEOPLE = ['#2F5BFF', '#FF5A4E', '#12B5A6', '#8B5CF6', '#E69500', '#E0457B'];
export const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
