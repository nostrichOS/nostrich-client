import { PrismaClient } from '@prisma/client'

/** The one Prisma client for the whole process. */
const globalForPrisma = globalThis as typeof globalThis & {
  __nostrichPrisma?: PrismaClient
}

function createClient(): PrismaClient {
  return new PrismaClient({
    // Query logging in dev only.
    log:
      process.env.NODE_ENV === 'production'
        ? ['warn', 'error']
        : ['query', 'warn', 'error'],
  })
}

export const prisma: PrismaClient = globalForPrisma.__nostrichPrisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__nostrichPrisma = prisma
}

/** Explicit shutdown for a long-lived worker process, rather than a request handler. */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect()
  if (process.env.NODE_ENV !== 'production') {
    delete globalForPrisma.__nostrichPrisma
  }
}
