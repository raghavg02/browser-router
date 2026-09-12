import { useState, useEffect, useMemo } from "react";
import path from "path";
import { List, ActionPanel, Action, Icon, Color, showToast, Toast, confirmAlert, Alert, Keyboard } from "@raycast/api";
import { VaultItem, VaultAttachment } from "../../types/vault";
import { BrowserProfile } from "../../types";
import {
  getVaultItems,
  saveVaultItems,
  getVaultMetadata,
  updateVaultCategories,
  DEFAULT_CATEGORIES,
  cleanTempVaultFiles,
  openAttachment,
  updateAttachmentCustomApp,
} from "../../utils/vaultStorage";
import { detectInstalledProfiles } from "../../utils/browserDetector";
import { launchBrowserProfile } from "../../utils/launcher";
import { VaultItemForm } from "./VaultItemForm";
import { SetCustomAppForm } from "./SetCustomAppForm";
import { getSuggestedAppsForFile, browseExecutableOnWindows } from "../../utils/vaultAppHelper";

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

  // Clean temp decrypted files on unmount/lock
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

    try {
      const newItems = items.filter((i) => i.id !== item.id);
      setItems(newItems);
      await saveVaultItems(newItems, vaultKey);
      await showToast({
        style: Toast.Style.Success,
        title: "Vault Item Deleted",
      });
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to delete item",
        message: String(err),
      });
    }
  }

  async function handleToggleFavorite(itemId: string) {
    const newItems = items.map((i) => (i.id === itemId ? { ...i, isFavorite: !i.isFavorite } : i));
    setItems(newItems);
    await saveVaultItems(newItems, vaultKey);
  }

  async function handleLaunch(item: VaultItem, isPrivate = false) {
    if (!item.url) return;

    let profile = profiles.find((p) => p.id === item.preferredProfileId);
    if (!profile && profiles.length > 0) {
      profile = profiles[0];
    }

    if (!profile) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No browser profiles detected",
      });
      return;
    }

    try {
      await launchBrowserProfile(profile, item.url, isPrivate);
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

  async function handleOpenAttachment(att: VaultAttachment, specificApp?: string) {
    const targetApp = specificApp !== undefined ? specificApp : att.customAppPath;
    const appLabel = targetApp ? path.basename(targetApp) : "Windows default app";
    await showToast({ style: Toast.Style.Animated, title: `Opening in ${appLabel}...` });
    const res = await openAttachment(att, vaultKey, specificApp);
    if (!res.success) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to open file", message: res.error });
    } else {
      await showToast({ style: Toast.Style.Success, title: `Opened in ${appLabel}` });
    }
  }

  async function handleSetCustomApp(itemId: string, attachmentId: string, customAppPath: string | undefined) {
    await updateAttachmentCustomApp(itemId, attachmentId, customAppPath, vaultKey);
    setItems((prevItems) =>
      prevItems.map((item) => {
        if (item.id !== itemId) return item;
        return {
          ...item,
          attachments: item.attachments.map((a) => (a.id === attachmentId ? { ...a, customAppPath } : a)),
        };
      }),
    );
  }

  const filteredItems = useMemo(() => {
    if (selectedCategory === "all") return items;
    return items.filter((i) => i.category === selectedCategory);
  }, [items, selectedCategory]);

  const favorites = useMemo(() => filteredItems.filter((i) => i.isFavorite), [filteredItems]);
  const nonFavorites = useMemo(() => filteredItems.filter((i) => !i.isFavorite), [filteredItems]);

  function renderItemDetail(item: VaultItem) {
    const profile = profiles.find((p) => p.id === item.preferredProfileId);
    const profileName = profile ? profile.displayName : "Default System Browser";

    let md = `# ${item.title}\n\n`;

    if (item.url) {
      md += `**🔗 Destination URL:** [${item.url}](${item.url})\n\n`;
    }

    if (item.notes) {
      md += `### 📝 Secret Notes\n${item.notes}\n\n`;
    }

    if (item.attachments && item.attachments.length > 0) {
      md += `### 📎 Attached Encrypted Files\n`;
      for (const att of item.attachments) {
        const openerInfo = att.customAppPath
          ? " *(Opens in: " + att.customAppPath + ")*"
          : " *(Opens in Windows default app)*";
        md += `• **${att.name}** (${(att.size / 1024).toFixed(1)} KB)${openerInfo}\n`;
      }
      md += `\n*💡 Press **Enter** to decrypt and open in its configured viewer.*\n`;
    }

    md += `\n---\n*Added: ${new Date(item.createdAt).toLocaleDateString()}*\n`;

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
            {hasAttachments && firstAttachment ? (
              <ActionPanel.Section title="File Actions">
                <Action
                  title={
                    firstAttachment.customAppPath
                      ? `Open in ${path.basename(firstAttachment.customAppPath)}`
                      : `Open in Default App (${firstAttachment.name})`
                  }
                  icon={Icon.Document}
                  onAction={() => handleOpenAttachment(firstAttachment)}
                />
                <ActionPanel.Submenu
                  title="Open with…"
                  icon={Icon.AppWindow}
                  shortcut={Keyboard.Shortcut.Common.OpenWith}
                >
                  <Action
                    title="Windows 'Open with' Dialog…"
                    icon={Icon.Window}
                    onAction={() => handleOpenAttachment(firstAttachment, "__system_dialog__")}
                  />
                  <ActionPanel.Section title={`Suggested Apps for ${firstAttachment.name}`}>
                    {getSuggestedAppsForFile(firstAttachment.name).map((app) => (
                      <Action
                        key={app.id}
                        title={`Open in ${app.title}`}
                        icon={Icon.AppWindow}
                        onAction={() => handleOpenAttachment(firstAttachment, app.id)}
                      />
                    ))}
                  </ActionPanel.Section>
                  <Action
                    title="Browse Other App on PC…"
                    icon={Icon.Finder}
                    onAction={async () => {
                      const picked = await browseExecutableOnWindows();
                      if (picked) {
                        await handleOpenAttachment(firstAttachment, picked);
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
                      onSaved={(newApp) => handleSetCustomApp(item.id, firstAttachment.id, newApp)}
                    />
                  }
                />
              </ActionPanel.Section>
            ) : null}

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
