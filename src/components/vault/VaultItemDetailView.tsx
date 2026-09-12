import { useState, useEffect, useMemo } from "react";
import path from "path";
import fs from "fs";
import {
  Detail,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  useNavigation,
  Clipboard,
  confirmAlert,
  Alert,
  Keyboard,
} from "@raycast/api";
import { VaultItem, VaultAttachment } from "../../types/vault";
import { BrowserProfile } from "../../types";
import { getDecryptedAttachmentPath, openAttachment } from "../../utils/vaultStorage";
import { launchBrowserProfile } from "../../utils/launcher";
import { getFileCategory, getSuggestedAppsForFile, browseExecutableOnWindows } from "../../utils/vaultAppHelper";
import {
  inspectZipArchive,
  renderPdfPageToImage,
  extractAudioMetadata,
  formatCsvAsTable,
  extractWindowsThumbnail,
  ZipEntryInfo,
  AudioMetaInfo,
} from "../../utils/vaultPreviewHelper";
import { SetCustomAppForm } from "./SetCustomAppForm";
import { VaultItemForm } from "./VaultItemForm";

interface VaultItemDetailViewProps {
  item: VaultItem;
  vaultKey: Buffer;
  profiles: BrowserProfile[];
  onItemUpdated: (updatedItem: VaultItem) => Promise<void>;
  onItemDeleted: (itemId: string) => Promise<void>;
}

function getImageMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".bmp":
      return "image/bmp";
    case ".ico":
      return "image/x-icon";
    case ".png":
    default:
      return "image/png";
  }
}

export function VaultItemDetailView({
  item,
  vaultKey,
  profiles,
  onItemUpdated,
  onItemDeleted,
}: VaultItemDetailViewProps) {
  const { pop } = useNavigation();
  const [decryptedPath, setDecryptedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [imageBase64Uri, setImageBase64Uri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isShowingDetails, setIsShowingDetails] = useState(false);
  const [zipInfo, setZipInfo] = useState<{
    totalFiles: number;
    totalUncompressedSize: number;
    entries: ZipEntryInfo[];
  } | null>(null);
  const [pdfImageUri, setPdfImageUri] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number | undefined>(undefined);
  const [audioMeta, setAudioMeta] = useState<AudioMetaInfo | null>(null);
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);

  const firstAttachment: VaultAttachment | undefined =
    item.attachments && item.attachments.length > 0 ? item.attachments[0] : undefined;

  const fileCategory = useMemo(() => {
    return firstAttachment ? getFileCategory(firstAttachment.name) : "other";
  }, [firstAttachment]);

  const preferredProfile = useMemo(() => {
    return profiles.find((p) => p.id === item.preferredProfileId);
  }, [profiles, item.preferredProfileId]);

  useEffect(() => {
    if (!firstAttachment) {
      setIsLoading(false);
      return;
    }

    try {
      const p = getDecryptedAttachmentPath(firstAttachment, vaultKey);
      setDecryptedPath(p);

      if (p) {
        if (fileCategory === "image") {
          // Read and convert to base64 Data URI so Raycast renders it natively without Chromium local resource blocks
          try {
            const buf = fs.readFileSync(p);
            const mime = getImageMimeType(firstAttachment.name);
            setImageBase64Uri(`data:${mime};base64,${buf.toString("base64")}`);
          } catch {
            // ignore
          }
        } else if (fileCategory === "code" || fileCategory === "document") {
          try {
            const stat = fs.statSync(p);
            if (stat.size < 500 * 1024) {
              const txt = fs.readFileSync(p, "utf8");
              setFileContent(txt);
            }
          } catch {
            // ignore
          }
        } else if (fileCategory === "archive") {
          try {
            const buf = fs.readFileSync(p);
            const z = inspectZipArchive(buf);
            setZipInfo(z);
          } catch {
            // ignore
          }
        } else if (fileCategory === "pdf") {
          // Render visual page-1 image preview of the PDF
          renderPdfPageToImage(p).then((res) => {
            if (res.imageUri) setPdfImageUri(res.imageUri);
            if (res.pageCount) setPdfPageCount(res.pageCount);
          });
        } else if (fileCategory === "video") {
          extractWindowsThumbnail(p).then((thumb) => {
            if (thumb) setThumbnailUri(thumb);
          });
        } else if (fileCategory === "audio") {
          try {
            const buf = fs.readFileSync(p);
            const meta = extractAudioMetadata(buf);
            setAudioMeta(meta);
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      showToast({
        style: Toast.Style.Failure,
        title: "Could not decrypt attachment preview",
        message: String(err),
      });
    } finally {
      setIsLoading(false);
    }
  }, [firstAttachment, vaultKey, fileCategory]);

  async function handleOpenExternal(specificApp?: string) {
    if (!firstAttachment) return;
    const isSystemDialog = specificApp === "__system_dialog__";
    const targetApp = specificApp !== undefined ? specificApp : firstAttachment.customAppPath;
    const appLabel = isSystemDialog
      ? "Windows 'Open With' dialog"
      : targetApp
        ? path.basename(targetApp)
        : "Windows default app";
    await showToast({ style: Toast.Style.Animated, title: `Opening in ${appLabel}...` });
    const res = await openAttachment(firstAttachment, vaultKey, specificApp);
    if (!res.success) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to open file", message: res.error });
    } else {
      await showToast({ style: Toast.Style.Success, title: `Opened in ${appLabel}` });
    }
  }

  async function handleLaunchBrowser(incognito = false) {
    if (!item.url) return;
    const profile = preferredProfile || profiles[0];
    if (!profile) {
      await showToast({ style: Toast.Style.Failure, title: "No browser profile found" });
      return;
    }
    try {
      await launchBrowserProfile(profile, item.url, incognito);
      await showToast({
        style: Toast.Style.Success,
        title: `Opened in ${profile.displayName}`,
        message: item.url,
      });
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to launch URL",
        message: String(err),
      });
    }
  }

  async function handleDelete() {
    const confirmed = await confirmAlert({
      title: "Delete Vault Item",
      message: `Are you sure you want to delete "${item.title}"?`,
      primaryAction: {
        title: "Delete",
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) return;
    await onItemDeleted(item.id);
    pop();
  }

  async function handleCopyContent() {
    if (fileContent) {
      await Clipboard.copy(fileContent);
      await showToast({ style: Toast.Style.Success, title: "Content Copied to Clipboard" });
    } else if (item.notes) {
      await Clipboard.copy(item.notes);
      await showToast({ style: Toast.Style.Success, title: "Secret Notes Copied" });
    } else if (item.url) {
      await Clipboard.copy(item.url);
      await showToast({ style: Toast.Style.Success, title: "URL Copied" });
    } else if (decryptedPath) {
      await Clipboard.copy({ file: decryptedPath });
      await showToast({ style: Toast.Style.Success, title: "File Copied to Clipboard" });
    }
  }

  const displayTitle = useMemo(() => {
    return item.title?.trim() || firstAttachment?.name || "Vault Item";
  }, [item.title, firstAttachment]);

  const markdown = useMemo(() => {
    let md = "";

    if (firstAttachment) {
      if (fileCategory === "image") {
        // Image displays full-window edge-to-edge without markdown header text pushing it down
        if (imageBase64Uri) {
          md += `![${firstAttachment.name.replace(/\[|\]/g, "")}](${imageBase64Uri})\n\n`;
        } else {
          md += "*Loading image preview...*\n\n";
        }
      } else if (fileCategory === "code" || fileCategory === "document") {
        md += `# ${displayTitle}\n\n`;
        if (
          item.title?.trim() &&
          firstAttachment.name &&
          item.title.trim().toLowerCase() !== firstAttachment.name.toLowerCase()
        ) {
          md += `*${firstAttachment.name}*\n\n`;
        }
        const ext = path.extname(firstAttachment.name).toLowerCase();
        if ((ext === ".csv" || ext === ".tsv") && fileContent) {
          md += `### 📊 Tabular Data Preview\n\n`;
          const table = formatCsvAsTable(fileContent, 20);
          md += table ? table + "\n\n" : "";
        } else {
          const lang = ext.replace(".", "") || "txt";
          md += "```" + lang + "\n" + (fileContent || "(Empty or binary content)") + "\n```\n\n";
        }
      } else if (fileCategory === "pdf") {
        md += `# ${displayTitle}\n\n`;
        if (pdfImageUri) {
          md += `![${firstAttachment.name.replace(/\[|\]/g, "")}](${pdfImageUri})\n\n`;
        } else {
          md += "*Loading visual PDF document preview...*\n\n";
        }
        const pageStr = pdfPageCount ? ` • ${pdfPageCount} pages` : "";
        md += `### 📄 PDF Document: ${firstAttachment.name}\n\n`;
        md += `*Size: ${(firstAttachment.size / 1024).toFixed(1)} KB${pageStr}*\n\n`;
        md += `> Press **Ctrl + Enter** to open and read this PDF in your default PDF viewer (Edge / Chrome / Acrobat).\n\n`;
      } else if (fileCategory === "archive") {
        md += `# ${displayTitle}\n\n`;
        md += `### 📦 Archive: ${firstAttachment.name}\n\n`;
        const uncompMB = zipInfo ? (zipInfo.totalUncompressedSize / (1024 * 1024)).toFixed(2) : undefined;
        const sizeStr = uncompMB && Number(uncompMB) > 0 ? ` • ${uncompMB} MB uncompressed` : "";
        md += `*Size: ${(firstAttachment.size / 1024).toFixed(1)} KB compressed${sizeStr}*\n\n`;

        if (zipInfo && zipInfo.entries.length > 0) {
          md += `#### 📂 Archived Files (${zipInfo.totalFiles}):\n\n`;
          md += `| File Name | Size |\n| :--- | :---: |\n`;
          const displayEntries = zipInfo.entries.slice(0, 30);
          for (const e of displayEntries) {
            if (e.isDirectory) {
              md += `| 📁 \`${e.name}\` | *Folder* |\n`;
            } else {
              const sz =
                e.size > 1024 * 1024 ? `${(e.size / (1024 * 1024)).toFixed(2)} MB` : `${(e.size / 1024).toFixed(1)} KB`;
              md += `| 📄 \`${e.name}\` | ${sz} |\n`;
            }
          }
          if (zipInfo.entries.length > 30) {
            md += `\n*... and ${zipInfo.entries.length - 30} more files*\n\n`;
          } else {
            md += `\n`;
          }
        }

        md += `> Press **Ctrl + Enter** to open or extract in your archive manager (7-Zip / WinRAR / Windows Explorer).\n\n`;
      } else if (fileCategory === "video") {
        md += `# ${displayTitle}\n\n`;
        if (thumbnailUri) {
          md += `![Video Poster Frame](${thumbnailUri})\n\n`;
        }
        md += `### 🎬 Video File: ${firstAttachment.name}\n\n`;
        md += `*Size: ${(firstAttachment.size / (1024 * 1024)).toFixed(2)} MB*\n\n`;
        md += `> Press **Ctrl + Enter** to play in your media player (VLC / Windows Media Player).\n\n`;
      } else if (fileCategory === "audio") {
        md += `# ${displayTitle}\n\n`;
        if (audioMeta?.coverImageUri) {
          md += `![Album Artwork](${audioMeta.coverImageUri})\n\n`;
        }
        md += `### 🎵 Audio File: ${firstAttachment.name}\n\n`;
        if (audioMeta?.title || audioMeta?.artist || audioMeta?.album) {
          const track = audioMeta.title ? `**${audioMeta.title}**` : "";
          const by = audioMeta.artist ? ` by **${audioMeta.artist}**` : "";
          const alb = audioMeta.album ? ` • *${audioMeta.album}*` : "";
          const yr = audioMeta.year ? ` (${audioMeta.year})` : "";
          md += `> 🎶 ${track}${by}${alb}${yr}\n\n`;
        }
        md += `*Size: ${(firstAttachment.size / (1024 * 1024)).toFixed(2)} MB*\n\n`;
        md += `> Press **Ctrl + Enter** to play in your media player (VLC / Windows Media Player).\n\n`;
      } else {
        md += `# ${displayTitle}\n\n`;
        md += `### 📦 Attached File: ${firstAttachment.name}\n\n`;
        md += `*Size: ${(firstAttachment.size / 1024).toFixed(1)} KB*\n\n`;
        md += `> Press **Ctrl + Enter** to open in its external application.\n\n`;
      }
    } else {
      md += `# ${displayTitle}\n\n`;
      if (item.url) {
        md += `**Destination URL:** [${item.url}](${item.url})\n\n`;
      }
    }

    if (item.notes) {
      md += `### 🔒 Secret Notes\n${item.notes}\n\n`;
    }

    return md;
  }, [
    item,
    firstAttachment,
    fileCategory,
    imageBase64Uri,
    fileContent,
    displayTitle,
    zipInfo,
    pdfImageUri,
    pdfPageCount,
    audioMeta,
    thumbnailUri,
  ]);

  const navTitle = useMemo(() => {
    return displayTitle;
  }, [displayTitle]);

  return (
    <Detail
      navigationTitle={navTitle}
      isLoading={isLoading}
      markdown={markdown}
      metadata={
        isShowingDetails ? (
          <Detail.Metadata>
            <Detail.Metadata.Label
              title="Category"
              text={item.category.toUpperCase()}
              icon={item.isFavorite ? { source: Icon.Star, tintColor: Color.Yellow } : Icon.Lock}
            />
            <Detail.Metadata.Label
              title="Created"
              text={new Date(item.createdAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            />
            {firstAttachment ? (
              <>
                <Detail.Metadata.Separator />
                <Detail.Metadata.Label title="Attachment" text={firstAttachment.name} icon={Icon.Paperclip} />
                <Detail.Metadata.Label
                  title="Size"
                  text={
                    firstAttachment.size > 1024 * 1024
                      ? `${(firstAttachment.size / (1024 * 1024)).toFixed(2)} MB`
                      : `${(firstAttachment.size / 1024).toFixed(1)} KB`
                  }
                />
                <Detail.Metadata.Label
                  title="Default Opener"
                  text={
                    firstAttachment.customAppPath ? path.basename(firstAttachment.customAppPath) : "Windows Default"
                  }
                />
              </>
            ) : null}
            {item.url ? (
              <>
                <Detail.Metadata.Separator />
                <Detail.Metadata.Link title="Destination URL" target={item.url} text={item.url} />
                <Detail.Metadata.Label
                  title="Preferred Browser"
                  text={preferredProfile ? preferredProfile.displayName : "Default Browser"}
                  icon={Icon.Globe}
                />
              </>
            ) : null}
          </Detail.Metadata>
        ) : undefined
      }
      actions={
        <ActionPanel>
          {firstAttachment ? (
            <ActionPanel.Section title="File Opener">
              <Action
                title="Open in External App"
                icon={Icon.ArrowRight}
                shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                onAction={() => handleOpenExternal()}
              />
              <ActionPanel.Submenu
                title="Open with…"
                icon={Icon.AppWindow}
                shortcut={Keyboard.Shortcut.Common.OpenWith}
              >
                <Action
                  title="Windows 'Open with' Dialog…"
                  icon={Icon.Window}
                  onAction={() => handleOpenExternal("__system_dialog__")}
                />
                <ActionPanel.Section title={`Suggested Apps for ${firstAttachment.name}`}>
                  {getSuggestedAppsForFile(firstAttachment.name).map((app) => (
                    <Action
                      key={app.id}
                      title={`Open in ${app.title}`}
                      icon={Icon.AppWindow}
                      onAction={() => handleOpenExternal(app.id)}
                    />
                  ))}
                </ActionPanel.Section>
                <Action
                  title="Browse Other App on PC…"
                  icon={Icon.Finder}
                  onAction={async () => {
                    const picked = await browseExecutableOnWindows();
                    if (picked) {
                      await handleOpenExternal(picked);
                    }
                  }}
                />
              </ActionPanel.Submenu>
              <Action.Push
                title="Set Default App for File…"
                icon={Icon.Gear}
                shortcut={Keyboard.Shortcut.Common.Open}
                target={
                  <SetCustomAppForm
                    item={item}
                    attachment={firstAttachment}
                    mode="set_default"
                    onSaved={async (newApp) => {
                      const updated = {
                        ...item,
                        attachments: item.attachments.map((a) =>
                          a.id === firstAttachment.id ? { ...a, customAppPath: newApp } : a,
                        ),
                      };
                      await onItemUpdated(updated);
                    }}
                  />
                }
              />
            </ActionPanel.Section>
          ) : item.url ? (
            <ActionPanel.Section title="Browser Launcher">
              <Action
                title="Open Destination URL"
                icon={Icon.Globe}
                shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                onAction={() => handleLaunchBrowser(false)}
              />
              <Action
                title="Open in Incognito / InPrivate"
                icon={Icon.EyeSlash}
                shortcut={{ modifiers: ["ctrl", "shift"], key: "enter" }}
                onAction={() => handleLaunchBrowser(true)}
              />
            </ActionPanel.Section>
          ) : null}

          <ActionPanel.Section title="Item Actions">
            <Action
              title={isShowingDetails ? "Hide Item Details" : "Show Item Details"}
              icon={Icon.Sidebar}
              shortcut={{ modifiers: ["ctrl"], key: "i" }}
              onAction={() => setIsShowingDetails(!isShowingDetails)}
            />
            <Action
              title="Copy Content / Secret"
              icon={Icon.Clipboard}
              shortcut={{ modifiers: ["ctrl"], key: "c" }}
              onAction={handleCopyContent}
            />
            <Action.Push
              title="Edit Item"
              icon={Icon.Pencil}
              shortcut={Keyboard.Shortcut.Common.Edit}
              target={
                <VaultItemForm
                  initialItem={item}
                  categories={[item.category]}
                  vaultKey={vaultKey}
                  onSave={async (updated) => {
                    await onItemUpdated(updated);
                    pop();
                  }}
                />
              }
            />
            <Action
              title="Delete Item"
              icon={Icon.Trash}
              style={Action.Style.Destructive}
              shortcut={Keyboard.Shortcut.Common.Remove}
              onAction={handleDelete}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}
