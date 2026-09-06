import {
  ActionPanel,
  Action,
  Icon,
  Image,
  List,
  LaunchProps,
  getPreferenceValues,
  Color,
  showToast,
  Toast,
  Keyboard,
  openExtensionPreferences,
} from "@raycast/api";
import { useEffect, useState, useMemo } from "react";
import { BrowserProfile, ExtensionPreferences } from "./types";
import { detectAllProfiles } from "./utils/browserDetector";
import { buildTargetUrl, isLikelyUrl } from "./utils/urlHelper";
import { launchBrowserProfile } from "./utils/launcher";
import { toggleFavorite, removeCustomProfile } from "./utils/storage";
import { AddCustomProfileForm } from "./components/AddCustomProfileForm";
import { RenameProfileForm } from "./components/RenameProfileForm";

export default function Command(props: LaunchProps<{ arguments: { query?: string }; fallbackText?: string }>) {
  const preferences = getPreferenceValues<ExtensionPreferences>();

  // Determine if query came from Raycast argument or fallback text
  const initialLockedQuery = (props.arguments.query || props.fallbackText || "").trim();
  const [lockedQuery, setLockedQuery] = useState<string>(initialLockedQuery);

  // For when user opens without arguments and types directly into the List
  const [liveQuery, setLiveQuery] = useState<string>("");

  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  async function loadProfiles() {
    setIsLoading(true);
    try {
      const detected = await detectAllProfiles();
      setProfiles(detected);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to detect browsers",
        message,
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadProfiles();
  }, []);

  const effectiveQuery = lockedQuery || liveQuery;

  const targetUrl = useMemo(() => {
    if (!effectiveQuery.trim()) return "";
    return buildTargetUrl(effectiveQuery, preferences.defaultSearchEngine || "google", preferences.customSearchUrl);
  }, [effectiveQuery, preferences.defaultSearchEngine, preferences.customSearchUrl]);

  async function handleLaunch(profile: BrowserProfile) {
    await launchBrowserProfile(profile, targetUrl || undefined);
  }

  async function handleToggleFavorite(profileId: string) {
    const isFav = await toggleFavorite(profileId);
    setProfiles((prev) => prev.map((p) => (p.id === profileId ? { ...p, isFavorite: isFav } : p)));
    await showToast({
      style: Toast.Style.Success,
      title: isFav ? "Added to Favorites" : "Removed from Favorites",
    });
  }

  async function handleDeleteCustom(profileId: string) {
    await removeCustomProfile(profileId);
    setProfiles((prev) => prev.filter((p) => p.id !== profileId));
    await showToast({
      style: Toast.Style.Success,
      title: "Custom Profile Removed",
    });
  }

  const favorites = useMemo(() => profiles.filter((p) => p.isFavorite), [profiles]);
  const allOther = useMemo(() => profiles.filter((p) => !p.isFavorite), [profiles]);

  function getProfileIcon(profile: BrowserProfile): Image.ImageLike {
    if (profile.avatarPath) {
      return { source: profile.avatarPath, mask: Image.Mask.Circle };
    }
    if (profile.iconPath) {
      return { source: profile.iconPath };
    }
    return { source: profile.fallbackIcon };
  }

  function getSubtitle(profile: BrowserProfile): string {
    if (effectiveQuery.trim()) {
      if (isLikelyUrl(effectiveQuery)) {
        return `Open ${effectiveQuery}`;
      }
      return `Search: "${effectiveQuery}"`;
    }
    return profile.email || "Open new tab";
  }

  function renderProfileItem(profile: BrowserProfile) {
    const icon = getProfileIcon(profile);
    const subtitle = getSubtitle(profile);

    const accessories: List.Item.Accessory[] = [];

    if (profile.isFavorite) {
      accessories.push({
        icon: { source: Icon.Star, tintColor: Color.Yellow },
        tooltip: "Favorite Profile",
      });
    }

    if (profile.email) {
      accessories.push({
        text: profile.email,
        tooltip: `Account: ${profile.email}`,
      });
    } else if (profile.profileDirectory && profile.profileDirectory !== "Default") {
      accessories.push({
        tag: { value: profile.profileDirectory, color: Color.SecondaryText },
      });
    }

    if (profile.isCustom) {
      accessories.push({
        tag: { value: "Custom", color: Color.Blue },
      });
    }

    return (
      <List.Item
        key={profile.id}
        icon={icon}
        title={profile.displayName}
        subtitle={subtitle}
        accessories={accessories}
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              <Action
                title={`Open in ${profile.displayName}`}
                icon={Icon.Globe}
                onAction={() => handleLaunch(profile)}
              />
              <Action
                title={profile.isFavorite ? "Remove from Favorites" : "Mark as Favorite"}
                icon={Icon.Star}
                shortcut={{ modifiers: ["ctrl"], key: "f" }}
                onAction={() => handleToggleFavorite(profile.id)}
              />
            </ActionPanel.Section>

            <ActionPanel.Section title="Query & URL">
              {targetUrl ? (
                <Action.CopyToClipboard
                  title="Copy Destination URL"
                  content={targetUrl}
                  shortcut={{ modifiers: ["ctrl"], key: "c" }}
                />
              ) : null}

              {lockedQuery ? (
                <Action
                  title="Clear Query (Switch to Filter Mode)"
                  icon={Icon.XMarkCircle}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={() => setLockedQuery("")}
                />
              ) : null}
            </ActionPanel.Section>

            <ActionPanel.Section title="Customize Profile">
              <Action.Push
                title="Rename Display Name…"
                icon={Icon.Pencil}
                shortcut={Keyboard.Shortcut.Common.Edit}
                target={<RenameProfileForm profile={profile} onRenamed={loadProfiles} />}
              />
              <Action.Push
                title="Add Custom Profile…"
                icon={Icon.Plus}
                shortcut={Keyboard.Shortcut.Common.New}
                target={<AddCustomProfileForm onProfileAdded={loadProfiles} />}
              />
              {profile.isCustom ? (
                <Action
                  title="Delete Custom Profile"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["ctrl"], key: "backspace" }}
                  onAction={() => handleDeleteCustom(profile.id)}
                />
              ) : null}
            </ActionPanel.Section>

            <ActionPanel.Section>
              <Action
                title="Refresh Browsers & Profiles"
                icon={Icon.ArrowClockwise}
                shortcut={Keyboard.Shortcut.Common.Refresh}
                onAction={loadProfiles}
              />
              <Action
                title="Open Extension Preferences"
                icon={Icon.Gear}
                shortcut={{ modifiers: ["ctrl"], key: "," }}
                onAction={openExtensionPreferences}
              />
            </ActionPanel.Section>
          </ActionPanel>
        }
      />
    );
  }

  const isFilterMode = Boolean(lockedQuery);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder={
        isFilterMode ? `Filter profiles (Query: "${lockedQuery}")` : "Type URL or search query, then select a profile…"
      }
      filtering={isFilterMode}
      searchText={isFilterMode ? undefined : liveQuery}
      onSearchTextChange={isFilterMode ? undefined : setLiveQuery}
    >
      <List.EmptyView
        icon={Icon.MagnifyingGlass}
        title="No Matching Profiles"
        description="Try a different filter or add a custom profile."
        actions={
          <ActionPanel>
            <Action.Push
              title="Add Custom Profile…"
              icon={Icon.Plus}
              target={<AddCustomProfileForm onProfileAdded={loadProfiles} />}
            />
            <Action title="Refresh Browsers & Profiles" icon={Icon.ArrowClockwise} onAction={loadProfiles} />
          </ActionPanel>
        }
      />

      {favorites.length > 0 ? <List.Section title="Favorites">{favorites.map(renderProfileItem)}</List.Section> : null}

      <List.Section title={favorites.length > 0 ? "All Browsers & Profiles" : "Browsers & Profiles"}>
        {allOther.map(renderProfileItem)}
      </List.Section>

      <List.Section title="Manage">
        <List.Item
          id="add_custom_profile_item"
          title="Add Custom Browser / Profile Folder…"
          subtitle="Add any unlisted browser or specific profile path"
          icon={Icon.PlusCircle}
          actions={
            <ActionPanel>
              <Action.Push
                title="Add Custom Profile…"
                icon={Icon.Plus}
                target={<AddCustomProfileForm onProfileAdded={loadProfiles} />}
              />
            </ActionPanel>
          }
        />
      </List.Section>
    </List>
  );
}
