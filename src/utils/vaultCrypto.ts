import util from "util";
import crypto from "crypto";
import { EncryptedPayload } from "../types/vault";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = "sha512";

export const CANARY_TEXT = "VAULT_CANARY_AUTHENTICATED_V1";

/**
 * Generate a cryptographically random salt
 */
export function generateSalt(): string {
  return crypto.randomBytes(SALT_LENGTH).toString("hex");
}

/**
 * Derive a 256-bit AES key from a user master password and salt using PBKDF2
 */

const pbkdf2Async = util.promisify(crypto.pbkdf2);

/**
 * Derive a 256-bit AES key asynchronously (non-blocking for background auto-unlock check)
 */
export async function deriveKeyAsync(password: string, saltHex: string): Promise<Buffer> {
  const salt = Buffer.from(saltHex, "hex");
  const key = await pbkdf2Async(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
  return key as Buffer;
}

export function deriveKey(password: string, saltHex: string): Buffer {
  const salt = Buffer.from(saltHex, "hex");
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

/**
 * Encrypt a buffer with AES-256-GCM
 */
export function encryptBuffer(buffer: Buffer, key: Buffer): EncryptedPayload {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
}

/**
 * Decrypt an AES-256-GCM encrypted payload to a buffer
 */
export function decryptBuffer(payload: EncryptedPayload, key: Buffer): Buffer {
  const iv = Buffer.from(payload.iv, "hex");
  const authTag = Buffer.from(payload.authTag, "hex");
  const ciphertext = Buffer.from(payload.ciphertext, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Encrypt a UTF-8 text string
 */
export function encryptText(text: string, key: Buffer): EncryptedPayload {
  return encryptBuffer(Buffer.from(text, "utf8"), key);
}

/**
 * Decrypt an AES-256-GCM encrypted payload back to a UTF-8 text string
 */
export function decryptText(payload: EncryptedPayload, key: Buffer): string {
  return decryptBuffer(payload, key).toString("utf8");
}
