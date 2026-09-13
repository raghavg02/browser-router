import { useState, useEffect, useMemo } from "react";
import path from "path";
import fs from "fs";
import {
  Grid,
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  Keyboard,
  confirmAlert,
  Alert,
  getPreferenceValues,
} from "@raycast/api";
import { VaultItem, VaultAttachment } from "../../types/vault";
import { BrowserProfile } from "../../types";
import {
  getVaultItems,
  saveVaultItems,
  openAttachment,
  cleanTempVaultFiles,
  getVaultMetadata,
  updateVaultCategories,
  updateAttachmentCustomApp,
  DEFAULT_CATEGORIES,
  getVaultFilesDir,
} from "../../utils/vaultStorage";
import {
  getItemGridContent,
  getSuggestedAppsForFile,
  getFileCategory,
  extractVideoThumbnailAsync,
} from "../../utils/vaultAppHelper";
import { detectInstalledProfiles } from "../../utils/browserDetector";
import { launchBrowserProfile } from "../../utils/launcher";
import { VaultItemForm } from "./VaultItemForm";
import { VaultItemDetailView } from "./VaultItemDetailView";
import { VaultSecurityQuestionView } from "./VaultSecurityQuestionView";

interface VaultMainViewProps {
  vaultKey: Buffer;
  onLock: () => void;
}

interface VaultPreferences {
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

function formatRelativeDateTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  const timeStr = new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `Today, ${timeStr}`;
  if (diffDays === 1) return `Yesterday, ${timeStr}`;
  return `${new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" })}, ${timeStr}`;
}

function renderItemPreviewMarkdown(item: VaultItem): string {
  const lines: string[] = [];
  const firstAtt = item.attachments && item.attachments.length > 0 ? item.attachments[0] : undefined;

  lines.push(`# ${item.title?.trim() || firstAtt?.name || "Untitled Vault Item"}`);
  lines.push("");

  if (item.url) {
    lines.push(`**Link:** [${item.url}](${item.url})`);
    lines.push("");
  }

  if (item.category) {
    lines.push(`**Category:** \`${item.category}\``);
    lines.push("");
  }

  if (firstAtt) {
    lines.push(`**Attachment:** ${firstAtt.name} (${(firstAtt.size / 1024).toFixed(1)} KB)`);
    lines.push("");
  }

  if (item.notes) {
    lines.push("### Secret Notes");
    lines.push(item.notes);
    lines.push("");
  }

  lines.push("---");
  lines.push(`*Created: ${new Date(item.createdAt).toLocaleString()}*`);

  return lines.join("\n");
}

export function VaultMainView({ vaultKey, onLock }: VaultMainViewProps) {
  const prefs = getPreferenceValues<VaultPreferences>();
  const initialCols = [3, 4, 5, 6].includes(Number(prefs.vaultGridColumns)) ? Number(prefs.vaultGridColumns) : 4;

  const [activeLayout, setActiveLayout] = useState<"grid" | "split" | "list">(prefs.vaultLayout || "grid");
  const [activeColumns, setActiveColumns] = useState<number>(initialCols);

  const [items, setItems] = useState<VaultItem[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedFileType, setSelectedFileType] = useState<string>("all");
  const [dropdownValue, setDropdownValue] = useState<string>("reset:all");

  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [, setThumbnailVersion] = useState(0);

  useEffect(() => {
    return () => {
      cleanTempVaultFiles();
    };
  }, []);

  useEffect(() => {
    loadVaultData();
  }, []);

  // Background thumbnail generation: Non-blocking, runs safely without freezing UI
  useEffect(() => {
    let isMounted = true;
    async function runBackgroundThumbnails() {
      let hasNewThumbnails = false;
      for (const item of items) {
        if (!isMounted) break;
        const firstAtt = item.attachments && item.attachments.length > 0 ? item.attachments[0] : undefined;
        if (firstAtt && getFileCategory(firstAtt.name) === "video") {
          const persistentThumb = path.join(getVaultFilesDir(), `${firstAtt.id}.thumb.jpg`);
          if (!fs.existsSync(persistentThumb)) {
            const res = await extractVideoThumbnailAsync(firstAtt, vaultKey);
            if (res) {
              hasNewThumbnails = true;
            }
          }
        }
      }
      if (isMounted && hasNewThumbnails) {
        setThumbnailVersion((v) => v + 1);
      }
    }

    if (items.length > 0) {
      runBackgroundThumbnails();
    }

    return () => {
      isMounted = false;
    };
  }, [items, vaultKey]);

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

  // Dual simultaneous filtering: Category + File Type work together at the same time
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

  function handleDropdownChange(val: string) {
    setDropdownValue(val);
    if (val === "reset:all") {
      setSelectedCategory("all");
      setSelectedFileType("all");
    } else if (val.startsWith("cat:")) {
      const cat = val.substring(4);
      setSelectedCategory(cat);
      // Keeps active selectedFileType intact!
    } else if (val.startsWith("type:")) {
      const type = val.substring(5);
      setSelectedFileType(type);
      // Keeps active selectedCategory intact!
    }
  }

  function getActiveFilterLabel(): string {
    const parts: string[] = [];
    if (selectedCategory !== "all") {
      parts.push(`Category: ${selectedCategory.toUpperCase()}`);
    }
    if (selectedFileType !== "all") {
      const t = FILE_TYPES.find((f) => f.id === selectedFileType);
      parts.push(`Type: ${t ? t.title : selectedFileType}`);
    }
    if (parts.length === 0) return "All Items";
    return parts.join(" • ");
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

        {/* 2. EXTERNAL LAUNCH */}
        {item.url && (
          <ActionPanel.Section title="Launch Link">
            <Action
              title="Open in Default Profile"
              icon={Icon.Globe}
              shortcut={{ modifiers: ["ctrl"], key: "return" }}
              onAction={() => handleLaunch(item, false)}
            />
            <Action
              title="Open in Private Window"
              icon={Icon.EyeSlash}
              shortcut={{ modifiers: ["ctrl", "shift"], key: "return" }}
              onAction={() => handleLaunch(item, true)}
            />
          </ActionPanel.Section>
        )}

        {/* 3. ATTACHMENT OPEN WITH */}
        {firstAttachment && (
          <ActionPanel.Section title="Open Attachment">
            <Action
              title={`Open in ${firstAttachment.customAppPath ? path.basename(firstAttachment.customAppPath) : "Windows Default"}`}
              icon={Icon.ArrowRight}
              shortcut={{ modifiers: ["ctrl"], key: "return" }}
              onAction={() => handleOpenAttachment(firstAttachment)}
            />

            <ActionPanel.Submenu title="Open with Specific App…" icon={Icon.AppWindow}>
              {suggestedApps.map((app) => (
                <Action
                  key={app.id}
                  title={app.title}
                  icon={Icon.Window}
                  onAction={() => handleOpenAttachment(firstAttachment, app.id)}
                />
              ))}
              <Action
                title="Choose with Windows Dialog…"
                icon={Icon.Gear}
                onAction={() => handleOpenAttachment(firstAttachment, "__system_dialog__")}
              />
            </ActionPanel.Submenu>

            <ActionPanel.Submenu title="Set Default App for File…" icon={Icon.Pencil}>
              <Action
                title="Use Windows System Default"
                icon={Icon.Undo}
                onAction={() => handleSetCustomApp(item.id, firstAttachment.id, undefined)}
              />
              {suggestedApps.map((app) => (
                <Action
                  key={app.id}
                  title={app.title}
                  icon={Icon.Window}
                  onAction={() => handleSetCustomApp(item.id, firstAttachment.id, app.id)}
                />
              ))}
            </ActionPanel.Submenu>
          </ActionPanel.Section>
        )}

        {/* 4. ITEM MANAGEMENT */}
        <ActionPanel.Section title="Manage Item">
          <Action.Push
            title="Add New Vault Item"
            icon={Icon.Plus}
            shortcut={Keyboard.Shortcut.Common.New}
            target={<VaultItemForm categories={categories} vaultKey={vaultKey} onSave={handleSaveItem} />}
          />
          <Action.Push
            title="Edit Vault Item"
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
        </ActionPanel.Section>

        {/* 5. DUAL SIMULTANEOUS FILTERING SUBMENUS */}
        <ActionPanel.Section title="Filter Vault Items">
          <ActionPanel.Submenu title={`Category: ${selectedCategory.toUpperCase()}`} icon={Icon.Folder}>
            <Action
              title="All Categories"
              icon={selectedCategory === "all" ? Icon.Checkmark : undefined}
              onAction={() => {
                setSelectedCategory("all");
                setDropdownValue("cat:all");
              }}
            />
            {categories.map((c) => (
              <Action
                key={c}
                title={c.toUpperCase()}
                icon={selectedCategory.toLowerCase() === c.toLowerCase() ? Icon.Checkmark : undefined}
                onAction={() => {
                  setSelectedCategory(c);
                  setDropdownValue(`cat:${c}`);
                }}
              />
            ))}
          </ActionPanel.Submenu>

          <ActionPanel.Submenu
            title={`File Type: ${FILE_TYPES.find((t) => t.id === selectedFileType)?.title || "All Types"}`}
            icon={Icon.Filter}
          >
            {FILE_TYPES.map((t) => (
              <Action
                key={t.id}
                title={t.title}
                icon={selectedFileType === t.id ? Icon.Checkmark : undefined}
                onAction={() => {
                  setSelectedFileType(t.id);
                  setDropdownValue(`type:${t.id}`);
                }}
              />
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
                setDropdownValue("reset:all");
              }}
            />
          )}
        </ActionPanel.Section>

        {/* 6. LAYOUT SWITCHING */}
        <ActionPanel.Section title="Layout & Appearance">
          <ActionPanel.Submenu
            title={`Layout Style: ${activeLayout === "grid" ? "Grid Cards" : activeLayout === "split" ? "Two-Pane Split" : "Compact List"}`}
            icon={Icon.AppWindowGrid3x3}
          >
            <Action
              title="Grid Cards Layout"
              icon={activeLayout === "grid" ? Icon.Checkmark : Icon.AppWindowGrid3x3}
              onAction={() => setActiveLayout("grid")}
            />
            <Action
              title="Two-Pane Split View"
              icon={activeLayout === "split" ? Icon.Checkmark : Icon.Sidebar}
              onAction={() => setActiveLayout("split")}
            />
            <Action
              title="Compact List View"
              icon={activeLayout === "list" ? Icon.Checkmark : Icon.List}
              onAction={() => setActiveLayout("list")}
            />
          </ActionPanel.Submenu>

          {activeLayout === "grid" && (
            <ActionPanel.Submenu title={`Grid Columns: ${activeColumns} Cards/Row`} icon={Icon.Maximize}>
              {[3, 4, 5, 6].map((cols) => (
                <Action
                  key={cols}
                  title={`${cols} Columns ${cols === 3 ? "(Relaxed)" : cols === 4 ? "(Standard)" : cols === 5 ? "(Compact)" : "(Dense)"}`}
                  icon={activeColumns === cols ? Icon.Checkmark : undefined}
                  onAction={() => setActiveColumns(cols)}
                />
              ))}
            </ActionPanel.Submenu>
          )}
        </ActionPanel.Section>

        {/* 7. SECURITY */}
        <ActionPanel.Section title="Vault Security">
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

  // Common Dropdown Component
  function renderDropdown(DropdownComp: typeof Grid.Dropdown | typeof List.Dropdown) {
    return (
      <DropdownComp
        tooltip={`Active Filter: ${getActiveFilterLabel()}`}
        value={dropdownValue}
        onChange={handleDropdownChange}
      >
        <DropdownComp.Section title="Quick Filter">
          <DropdownComp.Item title="🌟 All Items (Reset Filters)" value="reset:all" icon={Icon.Layers} />
        </DropdownComp.Section>

        <DropdownComp.Section title="Filter by Category">
          <DropdownComp.Item title="📁 All Categories" value="cat:all" icon={Icon.Folder} />
          {categories.map((cat) => (
            <DropdownComp.Item
              key={`cat:${cat}`}
              title={`📁 ${cat.toUpperCase()}${selectedCategory.toLowerCase() === cat.toLowerCase() ? " ✓" : ""}`}
              value={`cat:${cat}`}
            />
          ))}
        </DropdownComp.Section>

        <DropdownComp.Section title="Filter by File / Item Type">
          <DropdownComp.Item title="✨ All Types" value="type:all" icon={Icon.Filter} />
          {FILE_TYPES.filter((t) => t.id !== "all").map((t) => (
            <DropdownComp.Item
              key={`type:${t.id}`}
              title={`${t.title}${selectedFileType === t.id ? " ✓" : ""}`}
              value={`type:${t.id}`}
              icon={t.icon}
            />
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
                subtitle={item.isFavorite ? "★ Favorite" : undefined}
                icon={getItemGridContent(item)}
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
                icon={getItemGridContent(item)}
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
                    content={getItemGridContent(item)}
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
                  content={getItemGridContent(item)}
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
