import { useState, useEffect, useMemo } from "react";
import { List, ActionPanel, Action, Icon, Color, showToast, Toast, confirmAlert, Alert, Keyboard } from "@raycast/api";
import { VaultItem } from "../../types/vault";
import { BrowserProfile } from "../../types";
import {
  getVaultItems,
  saveVaultItems,
  getVaultMetadata,
  updateVaultCategories,
  DEFAULT_CATEGORIES,
  cleanTempVaultFiles,
  getDecryptedAttachmentPath,
} from "../../utils/vaultStorage";
import { detectInstalledProfiles } from "../../utils/browserDetector";
import { launchBrowserProfile } from "../../utils/launcher";
import { VaultItemForm } from "./VaultItemForm";
import { VaultFileViewer } from "./VaultFileViewer";

interface VaultMainViewProps {
  vaultKey: Buffer;
  onLock: () => void;
}

export function VaultMainView({ vaultKey, onLock }: VaultMainViewProps) {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Clean temp decrypted files on unmount
  useEffect(() => {
    return () => {
      cleanTempVaultFiles();
    };
  }, []);

  useEffect(() => {
    loadVaultData();
  }, []);

  async function loadVaultData() {
    setIsLoading(true);
    try {
      const [loadedItems, metadata, detectedProfiles] = await Promise.all([
        getVaultItems(vaultKey),
        getVaultMetadata(),
        detectInstalledProfiles(),
      ]);
      setItems(loadedItems);
      if (metadata?.categories && metadata.categories.length > 0) {
        setCategories(metadata.categories);
      }
      setProfiles(detectedProfiles);
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to load vault data",
        message: String(err),
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveItem(updatedItem: VaultItem) {
    const exists = items.some((i) => i.id === updatedItem.id);
    let newItems: VaultItem[];
    if (exists) {
      newItems = items.map((i) => (i.id === updatedItem.id ? updatedItem : i));
    } else {
      newItems = [updatedItem, ...items];
    }
    setItems(newItems);
    await saveVaultItems(newItems, vaultKey);

    // If new custom category, record it
    if (updatedItem.category && !categories.includes(updatedItem.category)) {
      const newCats = [...categories, updatedItem.category];
      setCategories(newCats);
      await updateVaultCategories(newCats);
    }
  }

  async function handleDeleteItem(item: VaultItem) {
    const confirmed = await confirmAlert({
      title: "Delete Vault Item",
      message: `Are you sure you want to delete "${item.title}"? Any attached encrypted files will also be removed.`,
      primaryAction: {
        title: "Delete",
        style: Alert.ActionStyle.Destructive,
      },
    });

    if (!confirmed) return;

    const newItems = items.filter((i) => i.id !== item.id);
    setItems(newItems);
    await saveVaultItems(newItems, vaultKey);
    await showToast({
      style: Toast.Style.Success,
      title: "Item Deleted",
      message: `"${item.title}" was removed from the vault.`,
    });
  }

  async function handleToggleFavorite(itemId: string) {
    const newItems = items.map((i) => (i.id === itemId ? { ...i, isFavorite: !i.isFavorite } : i));
    setItems(newItems);
    await saveVaultItems(newItems, vaultKey);
  }

  async function handleLaunch(item: VaultItem, incognito = false) {
    if (!item.url) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No URL assigned",
        message: "This item only contains secret notes or documents.",
      });
      return;
    }

    let targetProfile = profiles.find((p) => p.id === item.preferredProfileId);
    if (!targetProfile) {
      // Fallback to first detected profile (e.g. Chrome Default or Edge)
      targetProfile = profiles[0];
    }

    if (!targetProfile) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No browser profile found",
        message: "Could not locate an installed browser to launch this URL.",
      });
      return;
    }

    await launchBrowserProfile(targetProfile, item.url, incognito);
  }

  function getAssignedProfileName(profileId?: string): string {
    if (!profileId) return "Default / Unassigned";
    const p = profiles.find((prof) => prof.id === profileId);
    return p ? p.displayName : profileId;
  }

  const filteredItems = useMemo(() => {
    if (selectedCategory === "all") return items;
    return items.filter((i) => i.category === selectedCategory);
  }, [items, selectedCategory]);

  const favorites = useMemo(() => filteredItems.filter((i) => i.isFavorite), [filteredItems]);
  const nonFavorites = useMemo(() => filteredItems.filter((i) => !i.isFavorite), [filteredItems]);

  function renderItemDetail(item: VaultItem) {
    const profileName = getAssignedProfileName(item.preferredProfileId);
    const hasAttachments = item.attachments && item.attachments.length > 0;

    let md = `# ${item.title}

`;
    if (item.url) {
      md += `🔗 **URL:** [${item.url}](${item.url})\n\n`;
    }

    md += `🏷️ **Category:** *${item.category}* | 🌐 **Browser Profile:** *${profileName}*\n\n`;

    if (item.notes) {
      md += `### 📝 Secret Notes & Text
${item.notes}

`;
    }

    if (hasAttachments) {
      md += `### 📎 Encrypted Attachments (${item.attachments.length})
`;
      for (const att of item.attachments) {
        const ext = att.name.split(".").pop()?.toLowerCase() || "";
        const isImg = ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);

        if (isImg) {
          const tempPath = getDecryptedAttachmentPath(att, vaultKey);
          if (tempPath) {
            const uri = `file:///${tempPath.replace(/\\/g, "/")}`;
            md += `**${att.name}** (${(att.size / 1024).toFixed(1)} KB)\n![${att.name}](${uri})\n\n`;
          } else {
            md += `• 🖼️ ${att.name} (${(att.size / 1024).toFixed(1)} KB)\n`;
          }
        } else if (ext === "pdf") {
          md += `• 📑 **${att.name}** (${(att.size / 1024).toFixed(1)} KB) — *Press Space to View*\n`;
        } else {
          md += `• 📄 **${att.name}** (${(att.size / 1024).toFixed(1)} KB)\n`;
        }
      }
    }

    md += `
---
*Added: ${new Date(item.createdAt).toLocaleDateString()}*
`;

    return (
      <List.Item.Detail
        markdown={md}
        metadata={
          <List.Item.Detail.Metadata>
            <List.Item.Detail.Metadata.Label title="Title" text={item.title} />
            <List.Item.Detail.Metadata.TagList title="Category">
              <List.Item.Detail.Metadata.TagList.Item text={item.category} color={Color.Blue} />
            </List.Item.Detail.Metadata.TagList>
            <List.Item.Detail.Metadata.Label title="Preferred Profile" text={profileName} icon={Icon.Globe} />
            {item.url ? (
              <List.Item.Detail.Metadata.Link title="Destination Link" target={item.url} text={item.url} />
            ) : null}
            <List.Item.Detail.Metadata.Separator />
            <List.Item.Detail.Metadata.Label
              title="Attachments"
              text={`${item.attachments?.length || 0} file(s)`}
              icon={Icon.Paperclip}
            />
            <List.Item.Detail.Metadata.Label
              title="Last Updated"
              text={new Date(item.updatedAt).toLocaleDateString()}
            />
          </List.Item.Detail.Metadata>
        }
      />
    );
  }

  function renderRow(item: VaultItem) {
    const hasAttachments = item.attachments && item.attachments.length > 0;
    const firstAttachment = hasAttachments ? item.attachments[0] : undefined;

    return (
      <List.Item
        key={item.id}
        id={item.id}
        title={item.title}
        subtitle={item.url || item.notes?.substring(0, 30)}
        icon={item.isFavorite ? { source: Icon.Star, tintColor: Color.Yellow } : Icon.Lock}
        accessories={[
          ...(hasAttachments ? [{ icon: Icon.Paperclip, tooltip: `${item.attachments.length} attachment(s)` }] : []),
          { tag: { value: item.category, color: Color.Blue } },
        ]}
        detail={renderItemDetail(item)}
        actions={
          <ActionPanel>
            {item.url ? (
              <ActionPanel.Section title="Launch Destination">
                <Action
                  title="Launch in Preferred Profile"
                  icon={Icon.Globe}
                  onAction={() => handleLaunch(item, false)}
                />
                <Action
                  title="Launch in Incognito / InPrivate"
                  icon={Icon.EyeSlash}
                  shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                  onAction={() => handleLaunch(item, true)}
                />
              </ActionPanel.Section>
            ) : null}

            {firstAttachment ? (
              <ActionPanel.Section title="Attachment Viewer">
                <Action.Push
                  title={`View Attachment (${firstAttachment.name})`}
                  icon={Icon.Eye}
                  shortcut={{ modifiers: [], key: "space" }}
                  target={<VaultFileViewer attachment={firstAttachment} vaultKey={vaultKey} />}
                />
              </ActionPanel.Section>
            ) : null}

            <ActionPanel.Section title="Manage Item">
              <Action.Push
                title="Add New Secret Item…"
                icon={Icon.Plus}
                shortcut={Keyboard.Shortcut.Common.New}
                target={<VaultItemForm vaultKey={vaultKey} categories={categories} onSave={handleSaveItem} />}
              />
              <Action.Push
                title="Edit Item…"
                icon={Icon.Pencil}
                shortcut={Keyboard.Shortcut.Common.Edit}
                target={
                  <VaultItemForm
                    initialItem={item}
                    vaultKey={vaultKey}
                    categories={categories}
                    onSave={handleSaveItem}
                  />
                }
              />
              <Action
                title="Delete Item"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                // eslint-disable-next-line @raycast/prefer-common-shortcut
                shortcut={{ modifiers: ["ctrl"], key: "d" }}
                onAction={() => handleDeleteItem(item)}
              />
              <Action
                title={item.isFavorite ? "Remove from Favorites" : "Mark as Favorite"}
                icon={Icon.Star}
                shortcut={{ modifiers: ["ctrl"], key: "f" }}
                onAction={() => handleToggleFavorite(item.id)}
              />
            </ActionPanel.Section>

            <ActionPanel.Section title="Clipboard">
              {item.url ? (
                <Action.CopyToClipboard
                  title="Copy Destination URL"
                  content={item.url}
                  shortcut={{ modifiers: ["ctrl"], key: "c" }}
                />
              ) : null}
              {item.notes ? (
                <Action.CopyToClipboard
                  title="Copy Secret Notes"
                  content={item.notes}
                  shortcut={Keyboard.Shortcut.Common.Copy}
                />
              ) : null}
            </ActionPanel.Section>

            <ActionPanel.Section title="Security">
              <Action
                title="Lock Vault Immediately"
                icon={Icon.Lock}
                shortcut={{ modifiers: ["ctrl"], key: "l" }}
                onAction={onLock}
              />
            </ActionPanel.Section>
          </ActionPanel>
        }
      />
    );
  }

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={items.length > 0}
      searchBarPlaceholder="Search secret titles, URLs, notes, categories..."
      searchBarAccessory={
        <List.Dropdown tooltip="Filter Category" value={selectedCategory} onChange={setSelectedCategory}>
          <List.Dropdown.Item value="all" title="All Categories" icon={Icon.List} />
          {categories.map((cat) => (
            <List.Dropdown.Item key={cat} value={cat} title={cat} icon={Icon.Tag} />
          ))}
        </List.Dropdown>
      }
      actions={
        <ActionPanel>
          <Action.Push
            title="Add New Secret Item…"
            icon={Icon.Plus}
            shortcut={Keyboard.Shortcut.Common.New}
            target={<VaultItemForm vaultKey={vaultKey} categories={categories} onSave={handleSaveItem} />}
          />
          <Action title="Lock Vault" icon={Icon.Lock} shortcut={{ modifiers: ["ctrl"], key: "l" }} onAction={onLock} />
        </ActionPanel>
      }
    >
      {items.length === 0 ? (
        <List.EmptyView
          title="Your Vault is Empty"
          description="Press Ctrl + N to securely store your first private link, note, screenshot, or PDF document."
          icon={Icon.Lock}
          actions={
            <ActionPanel>
              <Action.Push
                title="Add New Secret Item…"
                icon={Icon.Plus}
                shortcut={Keyboard.Shortcut.Common.New}
                target={<VaultItemForm vaultKey={vaultKey} categories={categories} onSave={handleSaveItem} />}
              />
              <Action
                title="Lock Vault"
                icon={Icon.Lock}
                shortcut={{ modifiers: ["ctrl"], key: "l" }}
                onAction={onLock}
              />
            </ActionPanel>
          }
        />
      ) : (
        <>
          {favorites.length > 0 ? (
            <List.Section title="Favorites" subtitle={`${favorites.length} pinned`}>
              {favorites.map(renderRow)}
            </List.Section>
          ) : null}

          <List.Section title="Secret Items" subtitle={`${nonFavorites.length} item(s)`}>
            {nonFavorites.map(renderRow)}
          </List.Section>
        </>
      )}
    </List>
  );
}
