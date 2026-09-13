import path from "path";
import { execFile, spawnSync } from "child_process";
import fs from "fs";
import { Icon, Color, Image, environment } from "@raycast/api";
import { VaultItem, VaultAttachment } from "../types/vault";
import { getVaultFilesDir, getTempDecryptedDir, getDecryptedAttachmentPath } from "./vaultStorage";

export interface AppPreset {
  id: string;
  title: string;
}

export function getFileCategory(
  fileName: string,
): "image" | "pdf" | "video" | "audio" | "code" | "document" | "spreadsheet" | "archive" | "other" {
  const ext = path.extname(fileName).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico", ".tiff", ".avif"].includes(ext)) {
    return "image";
  }
  if (ext === ".pdf") {
    return "pdf";
  }
  if ([".mp4", ".mkv", ".webm", ".avi", ".mov", ".wmv", ".flv"].includes(ext)) {
    return "video";
  }
  if ([".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac", ".wma"].includes(ext)) {
    return "audio";
  }
  if ([".csv", ".tsv", ".xlsx", ".xls"].includes(ext)) {
    return "spreadsheet";
  }
  if (
    [
      ".js",
      ".ts",
      ".jsx",
      ".tsx",
      ".json",
      ".html",
      ".css",
      ".py",
      ".java",
      ".c",
      ".cpp",
      ".cs",
      ".go",
      ".rs",
      ".php",
      ".rb",
      ".sh",
      ".bat",
      ".ps1",
      ".sql",
      ".xml",
      ".yaml",
      ".yml",
      ".md",
    ].includes(ext)
  ) {
    return "code";
  }
  if ([".txt", ".log", ".doc", ".docx", ".rtf", ".odt"].includes(ext)) {
    return "document";
  }
  if ([".zip", ".rar", ".7z", ".tar", ".gz"].includes(ext)) {
    return "archive";
  }
  return "other";
}

export function getSuggestedAppsForFile(fileName: string): AppPreset[] {
  const cat = getFileCategory(fileName);

  switch (cat) {
    case "image":
      return [
        { id: "mspaint.exe", title: "Paint" },
        { id: "msedge.exe", title: "Microsoft Edge" },
        { id: "chrome.exe", title: "Google Chrome" },
      ];
    case "pdf":
      return [
        { id: "msedge.exe", title: "Microsoft Edge" },
        { id: "chrome.exe", title: "Google Chrome" },
        { id: "AcroRd32.exe", title: "Adobe Acrobat Reader" },
      ];
    case "video":
      return [
        { id: "vlc.exe", title: "VLC Media Player" },
        { id: "wmplayer.exe", title: "Windows Media Player" },
        { id: "mpv.exe", title: "MPV Player" },
      ];
    case "audio":
      return [
        { id: "wmplayer.exe", title: "Windows Media Player" },
        { id: "vlc.exe", title: "VLC Media Player" },
        { id: "foobar2000.exe", title: "foobar2000" },
      ];
    case "code":
    case "document":
      return [
        { id: "code.cmd", title: "Visual Studio Code" },
        { id: "notepad.exe", title: "Notepad" },
        { id: "notepad++.exe", title: "Notepad++" },
      ];
    case "spreadsheet":
      return [
        { id: "excel.exe", title: "Microsoft Excel" },
        { id: "code.cmd", title: "Visual Studio Code" },
        { id: "notepad.exe", title: "Notepad" },
      ];
    case "archive":
      return [
        { id: "explorer.exe", title: "Windows Explorer" },
        { id: "WinRAR.exe", title: "WinRAR" },
        { id: "7zFM.exe", title: "7-Zip File Manager" },
      ];
    default:
      return [
        { id: "notepad.exe", title: "Notepad" },
        { id: "explorer.exe", title: "Windows Explorer" },
      ];
  }
}

function getCardAsset(cardName: string): string {
  const candidates = [
    path.join(environment.assetsPath, "vault_cards", cardName),
    path.resolve(__dirname, "assets/vault_cards", cardName),
    path.resolve(__dirname, "../assets/vault_cards", cardName),
    path.resolve("assets/vault_cards", cardName),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return `vault_cards/${cardName}`;
}

export function getShellThumbnailExe(): string | null {
  const candidates = [
    path.resolve(__dirname, "bin/ShellThumbnail.exe"),
    path.resolve(__dirname, "../bin/ShellThumbnail.exe"),
    path.resolve("bin/ShellThumbnail.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Generates and caches a video frame thumbnail asynchronously.
 * Saves permanently to vault_files/{attachment.id}.thumb.jpg so it only generates once.
 */
export async function extractVideoThumbnailAsync(
  attachment: VaultAttachment,
  vaultKey: Buffer,
): Promise<string | null> {
  const persistentThumb = path.join(getVaultFilesDir(), `${attachment.id}.thumb.jpg`);
  if (fs.existsSync(persistentThumb)) {
    return persistentThumb;
  }

  try {
    const localPath = getDecryptedAttachmentPath(attachment, vaultKey);
    if (!localPath || !fs.existsSync(localPath)) return null;

    const exe = getShellThumbnailExe();
    if (!exe) return null;

    const res = spawnSync(exe, [localPath, persistentThumb, "360"], {
      windowsHide: true,
      timeout: 10000,
    });

    if (res.status === 0 && fs.existsSync(persistentThumb)) {
      return persistentThumb;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Fast, non-blocking card content provider.
 * Returns pre-existing thumbnail images if available, otherwise immediate high-end visual cards.
 * NEVER blocks or runs heavy decryption inside React render!
 */
export function getItemGridContent(item: VaultItem): Image.ImageLike {
  const firstAttachment = item.attachments && item.attachments.length > 0 ? item.attachments[0] : undefined;

  if (firstAttachment) {
    const cat = getFileCategory(firstAttachment.name);

    // 1. Check persistent thumbnail in vault_files
    const persistentThumb = path.join(getVaultFilesDir(), `${firstAttachment.id}.thumb.jpg`);
    if (fs.existsSync(persistentThumb)) {
      return { source: persistentThumb };
    }

    // 2. Check temporary thumbnail or cover preview
    const tempDir = getTempDecryptedDir();
    const tempFile = path.join(tempDir, `${firstAttachment.id}_${firstAttachment.name}`);
    const tempThumb = `${tempFile}.thumb.jpg`;
    if (fs.existsSync(tempThumb)) {
      return { source: tempThumb };
    }
    const tempPreview = `${tempFile}.preview.jpg`;
    if (fs.existsSync(tempPreview)) {
      return { source: tempPreview };
    }
    const tempArt = `${tempFile}.art.jpg`;
    if (fs.existsSync(tempArt)) {
      return { source: tempArt };
    }

    // 3. If it's a small image already decrypted in temp
    if (cat === "image" && fs.existsSync(tempFile)) {
      return { source: tempFile };
    }

    // 4. Return modern themed visual cards
    if (cat === "video") return { source: getCardAsset("video_card.svg") };
    if (cat === "audio") return { source: getCardAsset("audio_card.svg") };
    if (cat === "spreadsheet") return { source: getCardAsset("sheet_card.svg") };
    if (cat === "code") return { source: getCardAsset("code_card.svg") };
    if (cat === "document") return { source: getCardAsset("doc_card.svg") };
    if (cat === "archive") return { source: getCardAsset("archive_card.svg") };
    if (cat === "pdf") return { source: getCardAsset("doc_card.svg") };
    return { source: getCardAsset("doc_card.svg") };
  }

  if (item.url) {
    return { source: Icon.Globe, tintColor: Color.Blue };
  }

  return { source: getCardAsset("doc_card.svg") };
}

export async function browseExecutableOnWindows(): Promise<string | null> {
  if (process.platform !== "win32") return null;

  return new Promise((resolve) => {
    const psCmd =
      "Add-Type -AssemblyName System.Windows.Forms; " +
      "$d = New-Object Windows.Forms.OpenFileDialog; " +
      "$d.Filter = 'Applications (*.exe)|*.exe|All Files (*.*)|*.*'; " +
      "$d.Title = 'Select Application to Open File'; " +
      "if ($d.ShowDialog() -eq [Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }";

    execFile("powershell.exe", ["-NoProfile", "-Sta", "-WindowStyle", "Hidden", "-Command", psCmd], (err, stdout) => {
      if (err || !stdout || !stdout.trim()) {
        resolve(null);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}
