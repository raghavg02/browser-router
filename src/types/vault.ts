export interface EncryptedPayload {
  iv: string; // hex
  authTag: string; // hex
  ciphertext: string; // hex
}

export interface VaultAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  encryptedFileName: string;
  createdAt: number;
  customAppPath?: string;
}

export interface VaultItem {
  id: string;
  title: string;
  url?: string;
  category: string;
  notes?: string;
  preferredProfileId?: string;
  isFavorite?: boolean;
  attachments: VaultAttachment[];
  createdAt: number;
  updatedAt: number;
}

export interface VaultMetadata {
  salt: string; // hex
  canary: EncryptedPayload;
  categories: string[];
  passwordHint?: string;
  createdAt: number;
  updatedAt: number;
}
