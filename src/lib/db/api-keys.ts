// APIキー暗号化・復号化
import { prisma } from "./prisma";
import { Provider } from "@prisma/client";
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;

function getEncryptionKey(): Buffer {
  const hexKey = process.env.ENCRYPTION_KEY;
  if (!hexKey) throw new Error("ENCRYPTION_KEY not set");
  return Buffer.from(hexKey, "hex");
}

export function encryptApiKey(apiKey: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(apiKey, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted (all base64)
  return [iv.toString("base64"), authTag.toString("base64"), encrypted].join(":");
}

export function decryptApiKey(encryptedData: string): string {
  const key = getEncryptionKey();
  const [ivB64, authTagB64, encrypted] = encryptedData.split(":");

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export async function getUserApiKey(
  userId: string,
  provider: Provider
): Promise<string | null> {
  const record = await prisma.userApiKey.findUnique({
    where: { userId_provider: { userId, provider } },
  });

  if (!record || !record.isActive) return null;

  try {
    return decryptApiKey(record.encryptedKey);
  } catch {
    return null;
  }
}

export async function saveUserApiKey(
  userId: string,
  provider: Provider,
  apiKey: string
): Promise<void> {
  const encryptedKey = encryptApiKey(apiKey);
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
