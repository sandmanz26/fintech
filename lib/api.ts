import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import type { Role } from "@prisma/client";
import { auth } from "@/auth";
import { can, ForbiddenError, type Capability } from "@/lib/auth/rbac";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { Actor } from "@/lib/domain/audit";

export type SessionUser = { id: string; role: Role; name: string; merchantId: string | null };

export function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details !== undefined ? { details } : {}) } }, { status });
}

/** JSON response that serialises BigInt as string (PRD §8: amounts travel as strings). */
export function json(data: unknown, init?: ResponseInit) {
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
}

export function toActor(u: SessionUser): Actor {
  return { id: u.id, role: u.role };
}

type Ctx<P> = { params: Promise<P> };

/**
 * Wrap a route handler with authentication, an optional capability check and uniform errors.
 * `cap` may be a list: any one of them grants access.
 */
export function route<P = Record<string, string>>(
  opts: { cap?: Capability | Capability[] },
  handler: (req: NextRequest, ctx: { params: P; user: SessionUser }) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      const session = await auth();
      if (!session?.user?.id) return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
      const user: SessionUser = {
        id: session.user.id,
        role: session.user.role,
        name: session.user.name ?? "",
        merchantId: session.user.merchantId,
      };
      if (opts.cap) {
        const caps = Array.isArray(opts.cap) ? opts.cap : [opts.cap];
        if (!caps.some((c) => can(user.role, c))) {
          return errorResponse(403, "FORBIDDEN", "Your role does not allow this action.");
        }
      }
      const params = (await ctx.params) as P;
      return await handler(req, { params, user });
    } catch (e) {
      return handleError(e);
    }
  };
}

/** Public, token-gated routes (merchant portal): no session, same error envelope. */
export function publicRoute<P = Record<string, string>>(handler: (req: NextRequest, ctx: { params: P }) => Promise<Response>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      return await handler(req, { params: (await ctx.params) as P });
    } catch (e) {
      return handleError(e);
    }
  };
}

export function handleError(e: unknown): Response {
  if (e instanceof ZodError) return errorResponse(400, "VALIDATION", "The request is not valid.", e.flatten());
  if (e instanceof ForbiddenError) return errorResponse(403, "FORBIDDEN", e.message);
  if (e instanceof DomainError) return errorResponse(e.status, e.code, e.message, e.details);
  logger.error({ err: e }, "unhandled route error");
  return errorResponse(500, "INTERNAL", "Something went wrong on our side.");
}

export async function body<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  const raw = await req.json().catch(() => ({}));
  return schema.parse(raw);
}

export function query(req: NextRequest) {
  return Object.fromEntries(req.nextUrl.searchParams.entries());
}

/** Cursor pagination helper: ?cursor=&limit= (max 100). */
export function pageParams(req: NextRequest) {
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50));
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  return { limit, cursor };
}

export function page<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}
