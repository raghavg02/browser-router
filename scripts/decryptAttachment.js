const fs = require("fs");
const crypto = require("crypto");

// Usage: node scripts/decryptAttachment.js <encryptedPath> <destPath> <keyHex>
const [, , encPath, destPath, keyHex] = process.argv;

if (!encPath || !destPath || !keyHex) {
  process.exit(1);
}

try {
  const raw = fs.readFileSync(encPath, "utf8");
  const payload = JSON.parse(raw);
  const key = Buffer.from(keyHex, "hex");
  const iv = Buffer.from(payload.iv, "hex");
  const authTag = Buffer.from(payload.authTag, "hex");
  const ciphertext = Buffer.from(payload.ciphertext, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  fs.writeFileSync(destPath, decrypted);
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(2);
}
