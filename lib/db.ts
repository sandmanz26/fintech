import { PrismaClient, Prisma } from "@prisma/client";
import { isMockMode, mockDatabaseUrl } from "./mode";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG ? ["query", "warn", "error"] : ["warn", "error"],
    // Demo mode: the embedded database started by instrumentation.ts (see lib/mockdb.ts).
    ...(isMockMode() ? { datasourceUrl: mockDatabaseUrl() } : {}),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/** A Prisma transaction client, or the root client when no transaction is open. */
export type Tx = Prisma.TransactionClient | PrismaClient;

export { Prisma };
