import path from "path";
import { execFile } from "child_process";
import fs from "fs";
import { spawnSync } from "child_process";
import { Icon, Color, Image, environment } from "@raycast/api";
import { VaultItem } from "../types/vault";
import { getDecryptedAttachmentPath } from "./vaultStorage";

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
      ".tsx",
      ".jsx",
      ".json",
      ".html",
      ".css",
      ".py",
      ".c",
      ".cpp",
      ".cs",
      ".rs",
      ".go",
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
    case "audio":
      return [
        { id: "vlc.exe", title: "VLC Media Player" },
        { id: "wmplayer.exe", title: "Windows Media Player" },
      ];
    case "code":
      return [
        { id: "code.cmd", title: "Visual Studio Code" },
        { id: "notepad.exe", title: "Notepad" },
      ];
    case "document":
      return [
        { id: "notepad.exe", title: "Notepad" },
        { id: "code.cmd", title: "Visual Studio Code" },
        { id: "write.exe", title: "WordPad" },
      ];
    case "archive":
      return [
        { id: "explorer.exe", title: "Windows Explorer" },
        { id: "7zFM.exe", title: "7-Zip" },
      ];
    default:
      return [
        { id: "notepad.exe", title: "Notepad" },
        { id: "msedge.exe", title: "Microsoft Edge" },
      ];
  }
}

/**
 * Formats a timestamp into a natural, friendly string matching modern Raycast grids
 * (e.g. "Today, 2:26 PM", "Yesterday, 7:20 AM", or "Sep 10, 4:15 PM")
 */
export function formatRelativeDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeStr = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (isToday) {
    return `Today, ${timeStr}`;
  }
  if (isYesterday) {
    return `Yesterday, ${timeStr}`;
  }

  const isSameYear = date.getFullYear() === now.getFullYear();
  if (isSameYear) {
    return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${timeStr}`;
  }
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Returns the card thumbnail / icon for a vault item in the Grid.
 * For images, decrypts to temp storage and returns the local file path.
 * For other types, returns rich themed icons.
 */
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

function getShellThumbnailExe(): string | null {
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

export function getItemGridContent(item: VaultItem, vaultKey: Buffer): Image.ImageLike {
  const firstAttachment = item.attachments && item.attachments.length > 0 ? item.attachments[0] : undefined;

  if (firstAttachment) {
    const cat = getFileCategory(firstAttachment.name);
    if (cat === "image") {
      try {
        const localPath = getDecryptedAttachmentPath(firstAttachment, vaultKey);
        if (localPath && fs.existsSync(localPath)) {
          return { source: localPath };
        }
      } catch {
        // fallback
      }
      return { source: Icon.Image, tintColor: Color.Blue };
    }

    if (cat === "video") {
      try {
        const localPath = getDecryptedAttachmentPath(firstAttachment, vaultKey);
        if (localPath && fs.existsSync(localPath)) {
          const thumbPath = `${localPath}.thumb.jpg`;
          if (fs.existsSync(thumbPath)) {
            return { source: thumbPath };
          }
          const exe = getShellThumbnailExe();
          if (exe) {
            const res = spawnSync(exe, [localPath, thumbPath, "360"], {
              windowsHide: true,
              timeout: 4000,
            });
            if (res.status === 0 && fs.existsSync(thumbPath)) {
              return { source: thumbPath };
            }
          }
        }
      } catch {
        // fallback
      }
      return { source: getCardAsset("video_card.svg") };
    }

    if (cat === "pdf") {
      try {
        const localPath = getDecryptedAttachmentPath(firstAttachment, vaultKey);
        if (localPath && fs.existsSync(localPath)) {
          const previewPath = `${localPath}.preview.jpg`;
          if (fs.existsSync(previewPath)) {
            return { source: previewPath };
          }
        }
      } catch {
        // fallback
      }
      return { source: getCardAsset("doc_card.svg") };
    }

    if (cat === "audio") {
      try {
        const localPath = getDecryptedAttachmentPath(firstAttachment, vaultKey);
        if (localPath && fs.existsSync(localPath)) {
          const artPath = `${localPath}.art.jpg`;
          if (fs.existsSync(artPath)) {
            return { source: artPath };
          }
        }
      } catch {
        // fallback
      }
      return { source: getCardAsset("audio_card.svg") };
    }

    if (cat === "spreadsheet") {
      return { source: getCardAsset("sheet_card.svg") };
    }

    if (cat === "code") {
      return { source: getCardAsset("code_card.svg") };
    }

    if (cat === "document") {
      return { source: getCardAsset("doc_card.svg") };
    }

    if (cat === "archive") {
      return { source: getCardAsset("archive_card.svg") };
    }

    return { source: getCardAsset("doc_card.svg") };
  }

  if (item.url) {
    return { source: Icon.Globe, tintColor: Color.Blue };
  }

  return { source: getCardAsset("doc_card.svg") };
}

/**
 * Opens a native Windows Open File dialog so the user can easily select any
 * executable (.exe) from anywhere on their PC without typing or copying paths.
 */
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
