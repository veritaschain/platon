// Usage DB queries
import { prisma } from "./prisma";
import { Decimal } from "@prisma/client/runtime/library";

export async function getUserUsage(userId: string, period: "day" | "week" | "month") {
  const now = new Date();
  const from = new Date(now);

  if (period === "day") from.setDate(now.getDate() - 1);
  else if (period === "week") from.setDate(now.getDate() - 7);
  else from.setMonth(now.getMonth() - 1);

  const logs = await prisma.usageLog.findMany({
    where: { userId, createdAt: { gte: from } },
  });

  const totalCost = logs.reduce(
    (sum, log) => sum + Number(log.estimatedCostUsd),
    0
  );
  const totalInputTokens = logs.reduce((sum, log) => sum + log.inputTokens, 0);
  const totalOutputTokens = logs.reduce((sum, log) => sum + log.outputTokens, 0);

  return { totalCost, totalInputTokens, totalOutputTokens, count: logs.length };
}

export async function getDailyMonthlyUsage(userId: string) {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [dayLogs, monthLogs] = await Promise.all([
    prisma.usageLog.findMany({ where: { userId, createdAt: { gte: dayStart } } }),
    prisma.usageLog.findMany({ where: { userId, createdAt: { gte: monthStart } } }),
  ]);

  const dailyUsed = dayLogs.reduce((sum, l) => sum + Number(l.estimatedCostUsd), 0);
  const monthlyUsed = monthLogs.reduce((sum, l) => sum + Number(l.estimatedCostUsd), 0);

  return { dailyUsed, monthlyUsed };
}
