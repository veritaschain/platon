import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error'] : [],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  })

// 本番でもシングルトンを保持（サーバーレス環境での接続プール枯渇を防止）
globalForPrisma.prisma = prisma
