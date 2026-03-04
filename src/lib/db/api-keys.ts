// APIキー暗号化・復号化
import { prisma } from "./prisma";
import { Provider } from "@prisma/client";
import { encrypt, decrypt } from "@/lib/crypto/encryption";

export async function getUserApiKey(
  userId: string,
  provider: Provider
): Promise<string | null> {
  const record = await prisma.userApiKey.findUnique({
    where: { userId_provider: { userId, provider } },
  });

  if (!record || !record.isActive) return null;

  try {
    return decrypt(record.encryptedKey);
  } catch {
    return null;
  }
}

export async function saveUserApiKey(
  userId: string,
  provider: Provider,
  apiKey: string
): Promise<void> {
  const encryptedKey = encrypt(apiKey);
  const keyHint = `...${apiKey.slice(-4)}`;

  await prisma.userApiKey.upsert({
    where: { userId_provider: { userId, provider } },
    update: { encryptedKey, keyHint, isActive: true },
    create: { userId, provider, encryptedKey, keyHint },
  });
}

export async function listUserApiKeys(userId: string) {
  const keys = await prisma.userApiKey.findMany({
    where: { userId, isActive: true },
    select: { id: true, provider: true, keyHint: true, createdAt: true },
  });
  return keys;
}
