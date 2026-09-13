import { useState, useEffect, useMemo } from "react";
import path from "path";
import fs from "fs";
import {
  Grid,
  List,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  confirmAlert,
  Alert,
  Keyboard,
  getPreferenceValues,
  Color,
} from "@raycast/api";
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
  getDecryptedAttachmentPath,
} from "../../utils/vaultStorage";
import { detectInstalledProfiles } from "../../utils/browserDetector";
import { launchBrowserProfile } from "../../utils/launcher";
import { VaultItemForm } from "./VaultItemForm";
import { SetCustomAppForm } from "./SetCustomAppForm";
import { VaultItemDetailView } from "./VaultItemDetailView";
import { VaultSecurityQuestionView } from "./VaultSecurityQuestionView";
import {
  getSuggestedAppsForFile,
  browseExecutableOnWindows,
  formatRelativeDateTime,
  getItemGridContent,
  getFileCategory,
} from "../../utils/vaultAppHelper";

interface Preferences {
  vaultLayout?: "grid" | "split" | "list";
  vaultGridColumns?: string;
}

export const FILE_TYPES = [
  { id: "all", title: "All Types", icon: Icon.Filter },
  { id: "video", title: "Videos", icon: Icon.Video },
  { id: "image", title: "Images", icon: Icon.Image },
  { id: "pdf", title: "PDF Documents", icon: Icon.Document },
  { id: "audio", title: "Audio Tracks", icon: Icon.SpeakerOn },
  { id: "spreadsheet", title: "Spreadsheets (CSV)", icon: Icon.BarChart },
  { id: "code", title: "Source Code", icon: Icon.Code },
  { id: "document", title: "Text & Docs", icon: Icon.Paragraph },
  { id: "archive", title: "ZIP Archives", icon: Icon.Folder },
  { id: "url", title: "Bookmarks & Links", icon: Icon.Globe },
  { id: "note", title: "Secret Notes", icon: Icon.Text },
];

function getItemType(item: VaultItem): string {
  if (item.attachments && item.attachments.length > 0) {
    return getFileCategory(item.attachments[0].name);
  }
  if (item.url) return "url";
  return "note";
}

interface VaultMainViewProps {
  vaultKey: Buffer;
  onLock: () => void;
}

export function VaultMainView({ vaultKey, onLock }: VaultMainViewProps) {
  const prefs = getPreferenceValues<Preferences>();
  const [activeLayout, setActiveLayout] = useState<"grid" | "split" | "list">(prefs.vaultLayout || "grid");
  const [activeColumns, setActiveColumns] = useState<number>(parseInt(prefs.vaultGridColumns || "4", 10) || 4);

  const [items, setItems] = useState<VaultItem[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedFileType, setSelectedFileType] = useState<string>("all");

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

  // Dual simultaneous filtering: Category + File Type
  const filteredItems = useMemo(() => {
    return items.filter((i) => {
      const matchCat = selectedCategory === "all" || i.category.toLowerCase() === selectedCategory.toLowerCase();
      const itemType = getItemType(i);
      const matchType = selectedFileType === "all" || itemType === selectedFileType;
      return matchCat && matchType;
    });
  }, [items, selectedCategory, selectedFileType]);

  const favorites = useMemo(() => filteredItems.filter((i) => i.isFavorite), [filteredItems]);
  const nonFavorites = useMemo(() => filteredItems.filter((i) => !i.isFavorite), [filteredItems]);

  function handleFilterDropdownChange(val: string) {
    if (val.startsWith("cat:")) {
      setSelectedCategory(val.substring(4));
    } else if (val.startsWith("type:")) {
      setSelectedFileType(val.substring(5));
    }
  }

  function handleCycleLayout() {
    setActiveLayout((prev) => {
      if (prev === "grid") return "split";
      if (prev === "split") return "list";
      return "grid";
    });
  }

  function handleCycleColumns() {
    setActiveColumns((prev) => {
      if (prev === 3) return 4;
      if (prev === 4) return 5;
      if (prev === 5) return 6;
      return 3;
    });
  }

  function renderItemActions(item: VaultItem) {
    const hasAttachments = item.attachments && item.attachments.length > 0;
    const firstAttachment = hasAttachments ? item.attachments[0] : undefined;
    const suggestedApps = firstAttachment ? getSuggestedAppsForFile(firstAttachment.name) : [];

    return (
      <ActionPanel>
        {/* 1. PRIMARY ACTION: Opens inside Raycast */}
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

        {/* 2. SECONDARY: Launch externally */}
        {firstAttachment ? (
          <Action
            title={`Open File in Default App (${path.extname(firstAttachment.name)})`}
            icon={Icon.ArrowNe}
            shortcut={Keyboard.Shortcut.Common.Open}
            onAction={() => handleOpenAttachment(firstAttachment)}
          />
        ) : item.url ? (
          <Action
            title="Open URL in Browser"
            icon={Icon.Globe}
            shortcut={Keyboard.Shortcut.Common.Open}
            onAction={() => handleLaunch(item, false)}
          />
        ) : null}

        {/* 3. Open With Submenu */}
        {firstAttachment ? (
          <ActionPanel.Submenu title="Open with…" icon={Icon.ChevronRight} shortcut={Keyboard.Shortcut.Common.OpenWith}>
            <Action
              title="System 'Open with…' Dialog"
              icon={Icon.Window}
              onAction={() => handleOpenAttachment(firstAttachment, "__system_dialog__")}
            />
            <ActionPanel.Section title={`Suggested Apps for ${firstAttachment.name}`}>
              {suggestedApps.map((app) => (
                <Action
                  key={app.id}
                  title={app.title}
                  icon={Icon.AppWindow}
                  onAction={() => handleOpenAttachment(firstAttachment, app.id)}
                />
              ))}
            </ActionPanel.Section>
            <Action
              title="Browse for .Exe on PC…"
              icon={Icon.MagnifyingGlass}
              onAction={async () => {
                const exe = await browseExecutableOnWindows();
                if (exe) {
                  await handleOpenAttachment(firstAttachment, exe);
                }
              }}
            />
          </ActionPanel.Submenu>
        ) : null}

        {/* 4. Set Default App */}
        {firstAttachment ? (
          <Action.Push
            title="Configure Default App for This File"
            icon={Icon.Gear}
            shortcut={{ modifiers: ["ctrl", "shift"], key: "a" }}
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

        {/* 5. Filter Submenus */}
        <ActionPanel.Section title="Filter & View">
          <ActionPanel.Submenu
            title={`Filter File Type (${selectedFileType})`}
            icon={Icon.Filter}
            shortcut={{ modifiers: ["ctrl"], key: "t" }}
          >
            {FILE_TYPES.map((t) => (
              <Action key={t.id} title={t.title} icon={t.icon} onAction={() => setSelectedFileType(t.id)} />
            ))}
          </ActionPanel.Submenu>

          <ActionPanel.Submenu
            title={`Filter Category (${selectedCategory})`}
            icon={Icon.Tag}
            shortcut={{ modifiers: ["ctrl"], key: "c" }}
          >
            <Action title="All Categories" icon={Icon.Tag} onAction={() => setSelectedCategory("all")} />
            {categories.map((cat) => (
              <Action key={cat} title={cat} icon={Icon.Tag} onAction={() => setSelectedCategory(cat)} />
            ))}
          </ActionPanel.Submenu>

          {(selectedCategory !== "all" || selectedFileType !== "all") && (
            <Action
              title="Clear All Filters"
              icon={Icon.XMarkCircle}
              shortcut={{ modifiers: ["ctrl", "shift"], key: "x" }}
              onAction={() => {
                setSelectedCategory("all");
                setSelectedFileType("all");
              }}
            />
          )}

          <Action
            title={`Switch Layout (${activeLayout.toUpperCase()})`}
            icon={Icon.AppWindowGrid3x3}
            shortcut={{ modifiers: ["ctrl", "shift"], key: "l" }}
            onAction={handleCycleLayout}
          />

          {activeLayout === "grid" && (
            <Action
              title={`Cycle Grid Columns (${activeColumns})`}
              icon={Icon.AppWindowGrid3x3}
              shortcut={Keyboard.Shortcut.Common.Copy}
              onAction={handleCycleColumns}
            />
          )}
        </ActionPanel.Section>

        {/* 6. Management */}
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
              <VaultItemForm initialItem={item} categories={categories} vaultKey={vaultKey} onSave={handleSaveItem} />
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
          <Action.Push
            title="Configure Security Question"
            icon={Icon.Shield}
            target={<VaultSecurityQuestionView vaultKey={vaultKey} />}
          />
          <Action
            title="Lock Vault Now"
            icon={Icon.Lock}
            shortcut={{ modifiers: ["ctrl"], key: "l" }}
            onAction={onLock}
          />
        </ActionPanel.Section>
      </ActionPanel>
    );
  }

  function renderItemPreviewMarkdown(item: VaultItem): string {
    const lines: string[] = [];
    const firstAtt = item.attachments && item.attachments.length > 0 ? item.attachments[0] : undefined;

    if (firstAtt) {
      const cat = getFileCategory(firstAtt.name);
      try {
        const localPath = getDecryptedAttachmentPath(firstAtt, vaultKey);
        if (localPath && fs.existsSync(localPath)) {
          if (cat === "image") {
            lines.push(`![](${localPath})`);
          } else if (cat === "video") {
            const thumb = `${localPath}.thumb.jpg`;
            if (fs.existsSync(thumb)) {
              lines.push(`![](${thumb})`);
            }
          } else if (cat === "pdf") {
            const preview = `${localPath}.preview.jpg`;
            if (fs.existsSync(preview)) {
              lines.push(`![](${preview})`);
            }
          }
        }
      } catch {
        // ignore
      }

      lines.push(`## ${item.title || firstAtt.name}`);
      lines.push(`**File:** \`${firstAtt.name}\` (${(firstAtt.size / 1024).toFixed(1)} KB)`);
      lines.push(`**Category:** ${item.category}`);
    } else {
      lines.push(`## ${item.title || "Encrypted Note"}`);
      lines.push(`**Category:** ${item.category}`);
    }

    if (item.url) {
      lines.push(`**URL:** [${item.url}](${item.url})`);
    }

    if (item.notes && item.notes.trim()) {
      lines.push(`\n---\n\n### 📝 Notes\n${item.notes}`);
    }

    return lines.join("\n\n");
  }

  function getActiveFilterLabel(): string {
    const parts: string[] = [];
    if (selectedCategory !== "all") parts.push(`📁 ${selectedCategory}`);
    if (selectedFileType !== "all") {
      const typeObj = FILE_TYPES.find((t) => t.id === selectedFileType);
      parts.push(`🏷️ ${typeObj?.title || selectedFileType}`);
    }
    return parts.length > 0 ? parts.join(" • ") : "All Items";
  }

  // Common Dropdown Component
  function renderDropdown(DropdownComp: typeof Grid.Dropdown | typeof List.Dropdown) {
    return (
      <DropdownComp
        tooltip={`Filter: ${getActiveFilterLabel()}`}
        value={selectedCategory !== "all" ? `cat:${selectedCategory}` : `type:${selectedFileType}`}
        onChange={handleFilterDropdownChange}
      >
        <DropdownComp.Section title="Categories">
          <DropdownComp.Item title="📁 All Categories" value="cat:all" />
          {categories.map((cat) => (
            <DropdownComp.Item key={`cat:${cat}`} title={`📁 ${cat.toUpperCase()}`} value={`cat:${cat}`} />
          ))}
        </DropdownComp.Section>

        <DropdownComp.Section title="File Types">
          {FILE_TYPES.map((t) => (
            <DropdownComp.Item key={`type:${t.id}`} title={t.title} value={`type:${t.id}`} icon={t.icon} />
          ))}
        </DropdownComp.Section>
      </DropdownComp>
    );
  }

  // 1. SPLIT VIEW (List with Live Preview Pane)
  if (activeLayout === "split") {
    return (
      <List
        isShowingDetail={true}
        isLoading={isLoading}
        searchBarPlaceholder={`Filter in ${getActiveFilterLabel()}...`}
        searchBarAccessory={renderDropdown(List.Dropdown)}
      >
        {filteredItems.length === 0 ? (
          <List.EmptyView
            icon={Icon.Lock}
            title="No Vault Items"
            description="Press Ctrl+N to add an encrypted file, credential, or bookmark."
          />
        ) : (
          filteredItems.map((item) => {
            const firstAtt = item.attachments && item.attachments.length > 0 ? item.attachments[0] : undefined;
            const displayTitle = item.title?.trim() || firstAtt?.name || "Untitled Item";

            return (
              <List.Item
                key={item.id}
                id={item.id}
                title={displayTitle}
                subtitle={item.isFavorite ? "⭐ Favorite" : undefined}
                icon={getItemGridContent(item, vaultKey)}
                actions={renderItemActions(item)}
                detail={
                  <List.Item.Detail
                    markdown={renderItemPreviewMarkdown(item)}
                    metadata={
                      <List.Item.Detail.Metadata>
                        <List.Item.Detail.Metadata.Label title="Title" text={displayTitle} />
                        <List.Item.Detail.Metadata.TagList title="Category">
                          <List.Item.Detail.Metadata.TagList.Item text={item.category} color={Color.Blue} />
                        </List.Item.Detail.Metadata.TagList>
                        {item.url && <List.Item.Detail.Metadata.Link title="Link" target={item.url} text={item.url} />}
                        {firstAtt && (
                          <>
                            <List.Item.Detail.Metadata.Label title="Attachment" text={firstAtt.name} />
                            <List.Item.Detail.Metadata.Label
                              title="Size"
                              text={`${(firstAtt.size / 1024).toFixed(1)} KB`}
                            />
                          </>
                        )}
                        <List.Item.Detail.Metadata.Label
                          title="Modified"
                          text={formatRelativeDateTime(item.createdAt)}
                        />
                      </List.Item.Detail.Metadata>
                    }
                  />
                }
              />
            );
          })
        )}
      </List>
    );
  }

  // 2. COMPACT LIST VIEW
  if (activeLayout === "list") {
    return (
      <List
        isShowingDetail={false}
        isLoading={isLoading}
        searchBarPlaceholder={`Filter in ${getActiveFilterLabel()}...`}
        searchBarAccessory={renderDropdown(List.Dropdown)}
      >
        {filteredItems.length === 0 ? (
          <List.EmptyView
            icon={Icon.Lock}
            title="No Vault Items"
            description="Press Ctrl+N to add an encrypted file, credential, or bookmark."
          />
        ) : (
          filteredItems.map((item) => {
            const firstAtt = item.attachments && item.attachments.length > 0 ? item.attachments[0] : undefined;
            const displayTitle = item.title?.trim() || firstAtt?.name || "Untitled Item";

            return (
              <List.Item
                key={item.id}
                id={item.id}
                title={displayTitle}
                subtitle={item.url ? item.url : firstAtt ? firstAtt.name : undefined}
                icon={getItemGridContent(item, vaultKey)}
                accessories={[
                  item.isFavorite ? { icon: Icon.Star, tooltip: "Favorite" } : {},
                  { tag: item.category, tooltip: "Category" },
                  { text: formatRelativeDateTime(item.createdAt) },
                ]}
                actions={renderItemActions(item)}
              />
            );
          })
        )}
      </List>
    );
  }

  // 3. GRID CARDS VIEW (Default)
  return (
    <Grid
      columns={activeColumns}
      aspectRatio="16/9"
      fit={Grid.Fit.Fill}
      isLoading={isLoading}
      searchBarPlaceholder={`Filter in ${getActiveFilterLabel()}...`}
      searchBarAccessory={renderDropdown(Grid.Dropdown)}
    >
      {filteredItems.length === 0 ? (
        <Grid.EmptyView
          icon={Icon.Lock}
          title="No Vault Items"
          description="Press Ctrl+N to add an encrypted file, credential, or bookmark."
        />
      ) : (
        <>
          {favorites.length > 0 && (
            <Grid.Section title="Favorites">
              {favorites.map((item) => {
                const firstAtt = item.attachments && item.attachments.length > 0 ? item.attachments[0] : undefined;
                const displayTitle = item.title?.trim() || firstAtt?.name || "Untitled Item";
                const keywords = [
                  ...(item.title?.trim() ? [item.title.trim()] : []),
                  ...item.attachments.map((a) => a.name),
                  ...(item.url ? [item.url] : []),
                  item.category,
                ];

                return (
                  <Grid.Item
                    key={item.id}
                    id={item.id}
                    title={displayTitle}
                    subtitle={formatRelativeDateTime(item.createdAt)}
                    keywords={keywords}
                    content={getItemGridContent(item, vaultKey)}
                    actions={renderItemActions(item)}
                  />
                );
              })}
            </Grid.Section>
          )}

          <Grid.Section title={favorites.length > 0 ? "All Items" : undefined}>
            {nonFavorites.map((item) => {
              const firstAtt = item.attachments && item.attachments.length > 0 ? item.attachments[0] : undefined;
              const displayTitle = item.title?.trim() || firstAtt?.name || "Untitled Item";
              const keywords = [
                ...(item.title?.trim() ? [item.title.trim()] : []),
                ...item.attachments.map((a) => a.name),
                ...(item.url ? [item.url] : []),
                item.category,
              ];

              return (
                <Grid.Item
                  key={item.id}
                  id={item.id}
                  title={displayTitle}
                  subtitle={formatRelativeDateTime(item.createdAt)}
                  keywords={keywords}
                  content={getItemGridContent(item, vaultKey)}
                  actions={renderItemActions(item)}
                />
              );
            })}
          </Grid.Section>
        </>
      )}
    </Grid>
  );
}
