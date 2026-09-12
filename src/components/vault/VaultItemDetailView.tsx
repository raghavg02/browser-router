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

  const markdown = useMemo(() => {
    let md = "";

    if (firstAttachment) {
      if (fileCategory === "image") {
        if (imageBase64Uri) {
          md += `![${firstAttachment.name.replace(/\[|\]/g, "")}](${imageBase64Uri})\n\n`;
        } else {
          md += "*Loading image preview...*\n\n";
        }
      } else if (fileCategory === "code" || fileCategory === "document") {
        const ext = path.extname(firstAttachment.name).replace(".", "") || "txt";
        md += `# ${item.title}\n\n`;
        md += "```" + ext + "\n" + (fileContent || "(Empty or binary content)") + "\n```\n\n";
      } else if (fileCategory === "pdf") {
        md += `# ${item.title}\n\n`;
        md += `### 📄 PDF Document: ${firstAttachment.name}\n\n`;
        md += `*Size: ${(firstAttachment.size / 1024).toFixed(1)} KB*\n\n`;
        md += `> Press **Ctrl + Enter** to open and read this PDF in your default PDF viewer (Edge / Chrome / Acrobat).\n\n`;
      } else if (fileCategory === "video" || fileCategory === "audio") {
        const icon = fileCategory === "video" ? "🎬" : "🎵";
        md += `# ${item.title}\n\n`;
        md += `### ${icon} Media File: ${firstAttachment.name}\n\n`;
        md += `*Size: ${(firstAttachment.size / (1024 * 1024)).toFixed(2)} MB*\n\n`;
        md += `> Press **Ctrl + Enter** to play in your media player (VLC / Media Player).\n\n`;
      } else {
        md += `# ${item.title}\n\n`;
        md += `### 📦 Attached File: ${firstAttachment.name}\n\n`;
        md += `*Size: ${(firstAttachment.size / 1024).toFixed(1)} KB*\n\n`;
        md += `> Press **Ctrl + Enter** to open in its external application.\n\n`;
      }
    } else {
      md += `# ${item.title}\n\n`;
      if (item.url) {
        md += `**Destination URL:** [${item.url}](${item.url})\n\n`;
      }
    }

    if (item.notes) {
      md += `### 🔒 Secret Notes\n${item.notes}\n\n`;
    }

    return md;
  }, [item, firstAttachment, fileCategory, imageBase64Uri, fileContent]);

  const navTitle = useMemo(() => {
    return item.title || firstAttachment?.name || "Vault Item";
  }, [item.title, firstAttachment]);

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
