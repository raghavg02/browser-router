import path from "path";
import { execFile } from "child_process";
import { Icon, Color, Image } from "@raycast/api";
import { VaultItem } from "../types/vault";
import { getDecryptedAttachmentPath } from "./vaultStorage";

export interface AppPreset {
  id: string;
  title: string;
}

export function getFileCategory(
  fileName: string,
): "image" | "pdf" | "video" | "audio" | "code" | "document" | "archive" | "other" {
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
  if ([".txt", ".log", ".csv", ".doc", ".docx", ".rtf", ".odt"].includes(ext)) {
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
export function getItemGridContent(item: VaultItem, vaultKey: Buffer): Image.ImageLike {
  const firstAttachment = item.attachments && item.attachments.length > 0 ? item.attachments[0] : undefined;

  if (firstAttachment) {
    const cat = getFileCategory(firstAttachment.name);
    if (cat === "image") {
      try {
        const localPath = getDecryptedAttachmentPath(firstAttachment, vaultKey);
        if (localPath) {
          return { source: localPath };
        }
      } catch {
        // fallback to icon
      }
      return { source: Icon.Image, tintColor: Color.Blue };
    }
    if (cat === "pdf") {
      return { source: Icon.Document, tintColor: Color.Red };
    }
    if (cat === "video") {
      return { source: Icon.Video, tintColor: Color.Purple };
    }
    if (cat === "audio") {
      return { source: Icon.SpeakerOn, tintColor: Color.Magenta };
    }
    if (cat === "code") {
      return { source: Icon.Code, tintColor: Color.Green };
    }
    if (cat === "document") {
      return { source: Icon.Paragraph, tintColor: Color.Orange };
    }
    if (cat === "archive") {
      return { source: Icon.Folder, tintColor: Color.Yellow };
    }
    return { source: Icon.Document, tintColor: Color.PrimaryText };
  }

  if (item.url) {
    return { source: Icon.Globe, tintColor: Color.Blue };
  }

  return { source: Icon.Lock, tintColor: Color.SecondaryText };
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
