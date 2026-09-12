import { useState, useEffect, useMemo } from "react";
import path from "path";
import { Grid, ActionPanel, Action, Icon, showToast, Toast, confirmAlert, Alert, Keyboard } from "@raycast/api";
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
import { VaultItemDetailView } from "./VaultItemDetailView";
import {
  getSuggestedAppsForFile,
  browseExecutableOnWindows,
  formatRelativeDateTime,
  getItemGridContent,
} from "../../utils/vaultAppHelper";

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
        title: "Item Deleted",
      });
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to delete item",
        message: String(err),
      });
    }
  }

  async function handleDeleteItemDirect(itemId: string) {
    const newItems = items.filter((i) => i.id !== itemId);
    setItems(newItems);
    await saveVaultItems(newItems, vaultKey);
    await showToast({
      style: Toast.Style.Success,
      title: "Item Deleted",
    });
  }

  async function handleToggleFavorite(itemId: string) {
    const newItems = items.map((i) => (i.id === itemId ? { ...i, isFavorite: !i.isFavorite } : i));
    setItems(newItems);
    await saveVaultItems(newItems, vaultKey);
  }

  async function handleLaunch(item: VaultItem, isPrivate = false) {
    if (!item.url) return;
    const profile = profiles.find((p) => p.id === item.preferredProfileId) || profiles[0];
    if (!profile) {
      await showToast({ style: Toast.Style.Failure, title: "No browser profile found" });
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
    const isSystemDialog = specificApp === "__system_dialog__";
    const targetApp = specificApp !== undefined ? specificApp : att.customAppPath;
    const appLabel = isSystemDialog
      ? "Windows 'Open With' dialog"
      : targetApp
        ? path.basename(targetApp)
        : "Windows default app";
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

  function renderGridItem(item: VaultItem) {
    const hasAttachments = item.attachments && item.attachments.length > 0;
    const firstAttachment = hasAttachments ? item.attachments[0] : undefined;

    return (
      <Grid.Item
        key={item.id}
        id={item.id}
        title={item.title}
        subtitle={formatRelativeDateTime(item.createdAt)}
        content={getItemGridContent(item, vaultKey)}
        actions={
          <ActionPanel>
            {/* 1. PRIMARY ACTION: Opens inside Raycast on Enter and on Click! */}
            <Action.Push
              title="Open Inside Raycast"
              icon={Icon.Eye}
              target={
                <VaultItemDetailView
                  item={item}
                  vaultKey={vaultKey}
                  profiles={profiles}
                  onItemUpdated={handleSaveItem}
                  onItemDeleted={handleDeleteItemDirect}
                />
              }
            />

            {/* 2. EXTERNAL OPENER: Triggered by Ctrl + Enter directly from Grid! */}
            {hasAttachments && firstAttachment ? (
              <Action
                title={
                  firstAttachment.customAppPath
                    ? `Open in ${path.basename(firstAttachment.customAppPath)}`
                    : `Open in Default App (${firstAttachment.name})`
                }
                icon={Icon.ArrowRight}
                shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                onAction={() => handleOpenAttachment(firstAttachment)}
              />
            ) : item.url ? (
              <Action
                title="Launch Destination URL"
                icon={Icon.Globe}
                shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                onAction={() => handleLaunch(item, false)}
              />
            ) : null}

            {/* 3. Open With Submenu: Triggered by Ctrl + Shift + O */}
            {hasAttachments && firstAttachment ? (
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
            ) : null}

            {/* 4. Set Default App: Triggered by Ctrl + O */}
            {hasAttachments && firstAttachment ? (
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
            ) : null}

            <ActionPanel.Section title="Management">
              <Action.Push
                title="Add New Vault Item"
                icon={Icon.Plus}
                shortcut={Keyboard.Shortcut.Common.New}
                target={<VaultItemForm categories={categories} vaultKey={vaultKey} onSave={handleSaveItem} />}
              />
              <Action.Push
                title="Edit Item"
                icon={Icon.Pencil}
                shortcut={Keyboard.Shortcut.Common.Edit}
                target={
                  <VaultItemForm
                    initialItem={item}
                    categories={categories}
                    vaultKey={vaultKey}
                    onSave={handleSaveItem}
                  />
                }
              />
              <Action
                title={item.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                icon={Icon.Star}
                shortcut={{ modifiers: ["ctrl"], key: "f" }}
                onAction={() => handleToggleFavorite(item.id)}
              />
              <Action
                title="Delete Vault Item"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={Keyboard.Shortcut.Common.Remove}
                onAction={() => handleDeleteItem(item)}
              />
              <Action
                title="Lock Vault Now"
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
    <Grid
      columns={4}
      aspectRatio="16/9"
      fit={Grid.Fit.Fill}
      isLoading={isLoading}
      searchBarPlaceholder="Filter vault items by name or notes..."
      searchBarAccessory={
        <Grid.Dropdown
          tooltip="Filter by Category"
          value={selectedCategory}
          onChange={(newCategory) => setSelectedCategory(newCategory)}
        >
          <Grid.Dropdown.Item title="All Items" value="all" />
          <Grid.Dropdown.Section title="Categories">
            {categories.map((cat) => (
              <Grid.Dropdown.Item key={cat} title={cat.toUpperCase()} value={cat} />
            ))}
          </Grid.Dropdown.Section>
        </Grid.Dropdown>
      }
    >
      {filteredItems.length === 0 ? (
        <Grid.EmptyView
          icon={Icon.Lock}
          title="No Vault Items"
          description="Press Ctrl+N to add an encrypted file, credential, or bookmark."
          actions={
            <ActionPanel>
              <Action.Push
                title="Add New Vault Item"
                icon={Icon.Plus}
                shortcut={Keyboard.Shortcut.Common.New}
                target={<VaultItemForm categories={categories} vaultKey={vaultKey} onSave={handleSaveItem} />}
              />
              <Action
                title="Lock Vault Now"
                icon={Icon.Lock}
                shortcut={{ modifiers: ["ctrl"], key: "l" }}
                onAction={onLock}
              />
            </ActionPanel>
          }
        />
      ) : (
        <>
          {favorites.length > 0 ? <Grid.Section title="Favorites">{favorites.map(renderGridItem)}</Grid.Section> : null}
          <Grid.Section title={favorites.length > 0 ? "All Items" : undefined}>
            {nonFavorites.map(renderGridItem)}
          </Grid.Section>
        </>
      )}
    </Grid>
  );
}
