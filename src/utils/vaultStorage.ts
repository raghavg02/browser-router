import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { LocalStorage, environment, open } from "@raycast/api";
import { VaultItem, VaultMetadata, VaultAttachment, EncryptedPayload } from "../types/vault";
import {
  generateSalt,
  deriveKey,
  deriveKeyAsync,
  encryptText,
  decryptText,
  encryptBuffer,
  decryptBuffer,
  CANARY_TEXT,
} from "./vaultCrypto";

const KEY_VAULT_METADATA = "vault_metadata";
const KEY_VAULT_ITEMS = "vault_items";

export const DEFAULT_CATEGORIES = ["Personal", "Work", "Finance", "Development", "Social", "Documents"];

function getVaultFilesDir(): string {
  const dir = path.join(environment.supportPath, "vault_files");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getTempDecryptedDir(): string {
  const dir = path.join(environment.supportPath, "vault_temp");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export async function isVaultSetup(): Promise<boolean> {
  const metaJson = await LocalStorage.getItem<string>(KEY_VAULT_METADATA);
  return !!metaJson;
}

export async function getVaultMetadata(): Promise<VaultMetadata | null> {
  const metaJson = await LocalStorage.getItem<string>(KEY_VAULT_METADATA);
  if (!metaJson) return null;
  try {
    return JSON.parse(metaJson) as VaultMetadata;
  } catch {
    return null;
  }
}

export async function setupVault(password: string, passwordHint?: string): Promise<Buffer> {
  const salt = generateSalt();
  const key = deriveKey(password, salt);
  const canary = encryptText(CANARY_TEXT, key);

  const metadata: VaultMetadata = {
    salt,
    canary,
    categories: DEFAULT_CATEGORIES,
    passwordHint: passwordHint?.trim() || undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await LocalStorage.setItem(KEY_VAULT_METADATA, JSON.stringify(metadata));

  // Initialize empty items array
  const emptyEncrypted = encryptText(JSON.stringify([]), key);
  await LocalStorage.setItem(KEY_VAULT_ITEMS, JSON.stringify(emptyEncrypted));

  return key;
}

export async function unlockVault(password: string): Promise<Buffer | null> {
  const metadata = await getVaultMetadata();
  if (!metadata) return null;

  try {
    const key = deriveKey(password, metadata.salt);
    const decryptedCanary = decryptText(metadata.canary, key);
    if (decryptedCanary === CANARY_TEXT) {
      return key;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getVaultItems(key: Buffer): Promise<VaultItem[]> {
  const rawJson = await LocalStorage.getItem<string>(KEY_VAULT_ITEMS);
  if (!rawJson) return [];

  try {
    const payload = JSON.parse(rawJson) as EncryptedPayload;
    const decryptedJson = decryptText(payload, key);
    return JSON.parse(decryptedJson) as VaultItem[];
  } catch {
    return [];
  }
}

export async function saveVaultItems(items: VaultItem[], key: Buffer): Promise<void> {
  const json = JSON.stringify(items);
  const encrypted = encryptText(json, key);
  await LocalStorage.setItem(KEY_VAULT_ITEMS, JSON.stringify(encrypted));
}

export async function saveAttachment(sourceFilePath: string, key: Buffer): Promise<VaultAttachment> {
  const fileBytes = fs.readFileSync(sourceFilePath);
  const stat = fs.statSync(sourceFilePath);
  const fileName = path.basename(sourceFilePath);
  const ext = path.extname(sourceFilePath).toLowerCase();

  const id = "att_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
  const encryptedFileName = `${id}.enc`;
  const destPath = path.join(getVaultFilesDir(), encryptedFileName);

  const encrypted = encryptBuffer(fileBytes, key);
  fs.writeFileSync(destPath, JSON.stringify(encrypted), "utf8");

  return {
    id,
    name: fileName,
    size: stat.size,
    mimeType: ext,
    encryptedFileName,
    createdAt: Date.now(),
  };
}

export function getDecryptedAttachmentPath(attachment: VaultAttachment, key: Buffer): string | null {
  const encryptedPath = path.join(getVaultFilesDir(), attachment.encryptedFileName);
  if (!fs.existsSync(encryptedPath)) return null;

  try {
    const raw = fs.readFileSync(encryptedPath, "utf8");
    const payload = JSON.parse(raw) as EncryptedPayload;
    const decryptedBuffer = decryptBuffer(payload, key);

    const tempDir = getTempDecryptedDir();
    const tempFile = path.join(tempDir, `${attachment.id}_${attachment.name}`);
    fs.writeFileSync(tempFile, decryptedBuffer);
    return tempFile;
  } catch {
    return null;
  }
}

export function deleteAttachmentFile(encryptedFileName: string): void {
  const filePath = path.join(getVaultFilesDir(), encryptedFileName);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
}

export function cleanTempVaultFiles(): void {
  const tempDir = getTempDecryptedDir();
  if (fs.existsSync(tempDir)) {
    try {
      const files = fs.readdirSync(tempDir);
      for (const f of files) {
        fs.unlinkSync(path.join(tempDir, f));
      }
    } catch {
      // ignore
    }
  }
}

export async function updateVaultCategories(categories: string[]): Promise<void> {
  const metadata = await getVaultMetadata();
  if (!metadata) return;
  metadata.categories = categories;
  metadata.updatedAt = Date.now();
  await LocalStorage.setItem(KEY_VAULT_METADATA, JSON.stringify(metadata));
}

export async function changeVaultMasterPassword(
  oldKey: Buffer,
  newPassword: string,
  newHint?: string,
): Promise<Buffer> {
  const metadata = await getVaultMetadata();
  if (!metadata) throw new Error("Vault not found");

  // 1. Decrypt existing items
  const items = await getVaultItems(oldKey);

  // 2. Re-encrypt all attachments with new key
  const newSalt = generateSalt();
  const newKey = deriveKey(newPassword, newSalt);

  const vaultDir = getVaultFilesDir();
  for (const item of items) {
    for (const att of item.attachments) {
      const filePath = path.join(vaultDir, att.encryptedFileName);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        const payload = JSON.parse(raw) as EncryptedPayload;
        const decrypted = decryptBuffer(payload, oldKey);
        const reEncrypted = encryptBuffer(decrypted, newKey);
        fs.writeFileSync(filePath, JSON.stringify(reEncrypted), "utf8");
      }
    }
  }

  // 3. Re-encrypt items
  await saveVaultItems(items, newKey);

  // 4. Update metadata
  const newCanary = encryptText(CANARY_TEXT, newKey);
  const updatedMetadata: VaultMetadata = {
    ...metadata,
    salt: newSalt,
    canary: newCanary,
    passwordHint: newHint !== undefined ? newHint.trim() || undefined : metadata.passwordHint,
    updatedAt: Date.now(),
  };
  await LocalStorage.setItem(KEY_VAULT_METADATA, JSON.stringify(updatedMetadata));

  return newKey;
}

export async function resetVaultEntirely(): Promise<void> {
  await LocalStorage.removeItem(KEY_VAULT_METADATA);
  await LocalStorage.removeItem(KEY_VAULT_ITEMS);

  // Remove encrypted attachments
  const vaultDir = getVaultFilesDir();
  if (fs.existsSync(vaultDir)) {
    const files = fs.readdirSync(vaultDir);
    for (const f of files) {
      try {
        fs.unlinkSync(path.join(vaultDir, f));
      } catch {
        // ignore
      }
    }
  }
  cleanTempVaultFiles();
}

export async function tryUnlockVault(password: string, cachedMetadata?: VaultMetadata | null): Promise<Buffer | null> {
  if (!password || !password.trim()) return null;
  const metadata = cachedMetadata || (await getVaultMetadata());
  if (!metadata) return null;

  try {
    const key = await deriveKeyAsync(password, metadata.salt);
    const decryptedCanary = decryptText(metadata.canary, key);
    if (decryptedCanary === CANARY_TEXT) {
      return key;
    }
    return null;
  } catch {
    return null;
  }
}

export async function openAttachment(
  attachment: VaultAttachment,
  key: Buffer,
  specificApp?: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
  const filePath = getDecryptedAttachmentPath(attachment, key);
  if (!filePath) {
    return { success: false, error: "Failed to decrypt attachment file" };
  }

  const app = (specificApp || attachment.customAppPath || "").trim();
  try {
    if (app) {
      // Launch using specific user-configured executable
      const child = spawn("cmd.exe", ["/c", "start", '""', `"${app}"`, `"${filePath}"`], {
        windowsVerbatimArguments: true,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } else {
      // Launch with Windows default application
      await open(filePath);
    }
    return { success: true, path: filePath };
  } catch (err) {
    return { success: false, error: String(err), path: filePath };
  }
}

export async function updateAttachmentCustomApp(
  itemId: string,
  attachmentId: string,
  customAppPath: string | undefined,
  key: Buffer,
): Promise<void> {
  const items = await getVaultItems(key);
  const itemIndex = items.findIndex((i) => i.id === itemId);
  if (itemIndex === -1) return;

  const attIndex = items[itemIndex].attachments.findIndex((a) => a.id === attachmentId);
  if (attIndex === -1) return;

  items[itemIndex].attachments[attIndex].customAppPath = customAppPath ? customAppPath.trim() : undefined;
  items[itemIndex].updatedAt = Date.now();
  await saveVaultItems(items, key);
}
