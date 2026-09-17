import {
  ActionPanel,
  Action,
  Icon,
  Image,
  List,
  LaunchProps,
  getPreferenceValues,
  showToast,
  Toast,
  Keyboard,
  openExtensionPreferences,
  LocalStorage,
} from "@raycast/api";
import { useEffect, useState, useMemo } from "react";
import { BrowserProfile } from "./types";
import { detectAllProfiles } from "./utils/browserDetector";
import { buildTargetUrl } from "./utils/urlHelper";
import { launchBrowserProfile } from "./utils/launcher";
import { toggleFavorite, removeCustomProfile } from "./utils/storage";
import { AddCustomProfileForm } from "./components/AddCustomProfileForm";
import { RenameProfileForm } from "./components/RenameProfileForm";
import { VaultUnlockView } from "./components/vault/VaultUnlockView";
import { VaultMainView } from "./components/vault/VaultMainView";
import { FeedbackForm } from "./components/FeedbackForm";
import { UserManualView } from "./components/UserManualView";
import {
  LaunchHistoryItem,
  getLaunchHistory,
  recordLaunch,
  deleteHistoryItem,
  clearAllHistory,
} from "./utils/historyStorage";
import { getDomainSuggestion, fetchLiveSearchSuggestions, filterMatchingHistory } from "./utils/suggestionService";

export default function Command(props: LaunchProps<{ arguments: { query?: string }; fallbackText?: string }>) {
  const preferences = getPreferenceValues<Preferences & { enableSuggestions?: boolean }>();

  // Determine if query came from Raycast argument or fallback text
  const initialQuery = (props.arguments?.query || props.fallbackText || "").trim();

  // Mode: "query" (default, typing updates search query/URL) or "filter" (typing filters browser list)
  const [mode, setMode] = useState<"query" | "filter">("query");

  // Preserved state for both modes
  const [searchQuery, setSearchQuery] = useState<string>(initialQuery);
  const [filterText, setFilterText] = useState<string>("");

  // Lock suggestions when user explicitly selects a suggestion with Enter
  const [isQueryLocked, setIsQueryLocked] = useState<boolean>(false);
  const [lockedQuery, setLockedQuery] = useState<string>("");

  function handleSelectSuggestion(selectedText: string) {
    setSearchQuery(selectedText);
    setLockedQuery(selectedText);
    setIsQueryLocked(true);
  }

  function handleSearchTextChange(text: string) {
    if (mode === "query") {
      setSearchQuery(text);
      if (isQueryLocked && text !== lockedQuery) {
        setIsQueryLocked(false);
      }
    } else {
      setFilterText(text);
    }
  }

  const [hasSeenManual, setHasSeenManual] = useState<boolean | null>(null);
  const [history, setHistory] = useState<LaunchHistoryItem[]>([]);
  const [liveSuggestions, setLiveSuggestions] = useState<string[]>([]);

  useEffect(() => {
    async function checkFirstRun() {
      const seen = await LocalStorage.getItem<boolean>("hasSeenUserManual");
      setHasSeenManual(!!seen);
    }
    checkFirstRun();
  }, []);

  useEffect(() => {
    async function loadHistory() {
      const saved = await getLaunchHistory();
      setHistory(saved);
    }
    loadHistory();
  }, []);

  async function handleDismissFirstRun() {
    await LocalStorage.setItem("hasSeenUserManual", true);
    setHasSeenManual(true);
  }

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

  const targetUrl = useMemo(() => {
    if (!searchQuery.trim()) return "";
    return buildTargetUrl(searchQuery, preferences.defaultSearchEngine || "google", preferences.customSearchUrl);
  }, [searchQuery, preferences.defaultSearchEngine, preferences.customSearchUrl]);

  // Default / favorite profile used as primary target for suggestions
  const defaultProfile = useMemo(() => {
    return profiles.find((p) => p.isFavorite) || profiles[0];
  }, [profiles]);

  // Domain autocomplete (e.g. "gith" -> "github.com")
  const domainMatch = useMemo(() => {
    if (preferences.enableSuggestions === false || mode !== "query" || isQueryLocked) return null;
    return getDomainSuggestion(searchQuery);
  }, [searchQuery, mode, preferences.enableSuggestions, isQueryLocked]);

  // Matching past history items
  const matchingHistory = useMemo(() => {
    if (preferences.enableSuggestions === false || mode !== "query" || isQueryLocked) return [];
    return filterMatchingHistory(history, searchQuery, 2);
  }, [history, searchQuery, mode, preferences.enableSuggestions, isQueryLocked]);

  // Debounced live search suggestions from Google
  useEffect(() => {
    if (preferences.enableSuggestions === false || mode !== "query" || isQueryLocked) {
      setLiveSuggestions([]);
      return;
    }

    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setLiveSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(async () => {
      try {
        const results = await fetchLiveSearchSuggestions(trimmed, controller.signal);
        setLiveSuggestions(results);
      } catch {
        setLiveSuggestions([]);
      }
    }, 180);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [searchQuery, mode, preferences.enableSuggestions, isQueryLocked]);

  async function handleLaunch(
    profile: BrowserProfile,
    incognito = false,
    overrideUrl?: string,
    overrideQuery?: string,
  ) {
    const urlToOpen = overrideUrl || targetUrl;
    const queryUsed = overrideQuery || searchQuery;
    await launchBrowserProfile(profile, urlToOpen || undefined, incognito);

    // STRICT PRIVACY GUARANTEE: Never record launches in incognito mode
    if (!incognito && queryUsed.trim()) {
      await recordLaunch(queryUsed, urlToOpen, profile, false);
      const updatedHistory = await getLaunchHistory();
      setHistory(updatedHistory);
    }
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

  // Filter profiles when in "filter" mode, or show all when in "query" mode
  const displayedProfiles = useMemo(() => {
    if (mode !== "filter" || !filterText.trim()) {
      return profiles;
    }
    const q = filterText.toLowerCase().trim();
    return profiles.filter((p) => {
      const matchDisplay = p.displayName.toLowerCase().includes(q);
      const matchBrowser = p.browserName.toLowerCase().includes(q);
      const matchProfile = p.profileName.toLowerCase().includes(q);
      const matchDir = p.profileDirectory.toLowerCase().includes(q);
      const matchEmail = p.email ? p.email.toLowerCase().includes(q) : false;
      return matchDisplay || matchBrowser || matchProfile || matchDir || matchEmail;
    });
  }, [profiles, mode, filterText]);

  const favorites = useMemo(() => displayedProfiles.filter((p) => p.isFavorite), [displayedProfiles]);
  const allOther = useMemo(() => displayedProfiles.filter((p) => !p.isFavorite), [displayedProfiles]);

  function getProfileIcon(profile: BrowserProfile): Image.ImageLike {
    if (profile.avatarPath) {
      return { source: profile.avatarPath };
    }
    if (profile.iconPath) {
      return { source: profile.iconPath };
    }
    return { source: profile.fallbackIcon };
  }

  function toggleMode() {
    setMode((prev) => (prev === "query" ? "filter" : "query"));
  }

  function renderProfileItem(profile: BrowserProfile) {
    const icon = getProfileIcon(profile);
    const accessories: List.Item.Accessory[] = [
      {
        text: `Profile: ${profile.profileDirectory}`,
      },
    ];

    return (
      <List.Item
        key={profile.id}
        icon={icon}
        title={profile.displayName}
        accessories={accessories}
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              <Action
                title={`Open in ${profile.displayName}`}
                icon={Icon.Globe}
                onAction={() => handleLaunch(profile, false)}
              />
              <Action
                title="Open in Incognito / InPrivate"
                icon={Icon.EyeSlash}
                shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                onAction={() => handleLaunch(profile, true)}
              />
            </ActionPanel.Section>

            <ActionPanel.Section title="Search & Filter Mode">
              <Action
                title={mode === "query" ? "Switch to Profile Filter Mode" : "Switch to Search Query Mode"}
                icon={mode === "query" ? Icon.Filter : Icon.MagnifyingGlass}
                shortcut={{ modifiers: [], key: "tab" }}
                onAction={toggleMode}
              />
              {searchQuery ? (
                <Action
                  title="Clear Search Query"
                  icon={Icon.XMarkCircle}
                  shortcut={{ modifiers: ["ctrl", "shift"], key: "x" }}
                  onAction={() => {
                    setSearchQuery("");
                    setIsQueryLocked(false);
                    setLockedQuery("");
                  }}
                />
              ) : null}
              {targetUrl ? (
                <Action.CopyToClipboard
                  title="Copy Destination URL"
                  content={targetUrl}
                  shortcut={{ modifiers: ["ctrl"], key: "c" }}
                />
              ) : null}
            </ActionPanel.Section>

            <ActionPanel.Section title="Customize Profile">
              <Action
                title={profile.isFavorite ? "Remove from Favorites" : "Mark as Favorite"}
                icon={Icon.Star}
                shortcut={{ modifiers: ["ctrl"], key: "f" }}
                onAction={() => handleToggleFavorite(profile.id)}
              />
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

            <ActionPanel.Section title="Security & Vault">
              <Action.Push
                title="Open Encrypted Vault…"
                icon={Icon.Lock}
                shortcut={{ modifiers: ["ctrl", "shift"], key: "v" }}
                target={<VaultBridge />}
              />
            </ActionPanel.Section>

            <ActionPanel.Section title="Help & Feedback">
              <Action.Push
                title="User Manual & Guide"
                icon={Icon.Book}
                shortcut={{ modifiers: ["ctrl"], key: "h" }}
                target={<UserManualView />}
              />
              <Action.Push
                title="Send Feedback / Feature Request"
                icon={Icon.Envelope}
                shortcut={{ modifiers: ["ctrl", "shift"], key: "f" }}
                target={<FeedbackForm />}
              />
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

  function renderRecentHistoryItem(item: LaunchHistoryItem) {
    const matchedProfile = profiles.find((p) => p.id === item.profileId) || defaultProfile;
    return (
      <List.Item
        key={`recent_${item.id}`}
        icon={Icon.Clock}
        title={item.query}
        subtitle={item.resolvedUrl}
        accessories={[
          { text: item.profileDisplayName, icon: Icon.Globe },
          { date: new Date(item.timestamp), tooltip: `Last opened: ${new Date(item.timestamp).toLocaleString()}` },
        ]}
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              <Action
                title={`Re-Open in ${matchedProfile ? matchedProfile.displayName : item.profileDisplayName}`}
                icon={Icon.ArrowRight}
                onAction={() => matchedProfile && handleLaunch(matchedProfile, false, item.resolvedUrl, item.query)}
              />
              <Action
                title="Open in Incognito / InPrivate"
                icon={Icon.EyeSlash}
                shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                onAction={() => matchedProfile && handleLaunch(matchedProfile, true, item.resolvedUrl, item.query)}
              />
              <Action
                title="Use as Search Query"
                icon={Icon.Pencil}
                shortcut={Keyboard.Shortcut.Common.Edit}
                onAction={() => handleSelectSuggestion(item.query)}
              />
              <Action
                title={mode === "query" ? "Switch to Profile Filter Mode" : "Switch to Search Query Mode"}
                icon={mode === "query" ? Icon.Filter : Icon.MagnifyingGlass}
                shortcut={{ modifiers: [], key: "tab" }}
                onAction={toggleMode}
              />
            </ActionPanel.Section>

            <ActionPanel.Section title="History Management">
              <Action
                title="Remove from History"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={{ modifiers: ["ctrl"], key: "backspace" }}
                onAction={async () => {
                  const updated = await deleteHistoryItem(item.id);
                  setHistory(updated);
                  await showToast({ style: Toast.Style.Success, title: "Removed from History" });
                }}
              />
              <Action
                title="Clear All History"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                onAction={async () => {
                  await clearAllHistory();
                  setHistory([]);
                  await showToast({ style: Toast.Style.Success, title: "History Cleared" });
                }}
              />
            </ActionPanel.Section>
          </ActionPanel>
        }
      />
    );
  }

  function renderDomainMatchItem(domain: string) {
    const url = `https://${domain}`;
    return (
      <List.Item
        key={`domain_${domain}`}
        icon={Icon.Link}
        title={domain}
        subtitle="Direct Domain"
        accessories={[{ text: "Enter to select", icon: Icon.ArrowRight }]}
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              <Action
                title="Select Suggestion"
                icon={Icon.ArrowRight}
                onAction={() => handleSelectSuggestion(domain)}
              />
              <Action
                title={mode === "query" ? "Switch to Profile Filter Mode" : "Switch to Search Query Mode"}
                icon={mode === "query" ? Icon.Filter : Icon.MagnifyingGlass}
                shortcut={{ modifiers: [], key: "tab" }}
                onAction={toggleMode}
              />
              {defaultProfile ? (
                <Action
                  title="Open in Incognito / InPrivate"
                  icon={Icon.EyeSlash}
                  shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                  onAction={() => handleLaunch(defaultProfile, true, url, domain)}
                />
              ) : null}
            </ActionPanel.Section>
            {defaultProfile ? (
              <ActionPanel.Section title="Open in Specific Profile">
                {profiles.map((p) => (
                  <Action
                    key={`domain_profile_${p.id}`}
                    title={`Open in ${p.displayName}`}
                    icon={getProfileIcon(p)}
                    onAction={() => handleLaunch(p, false, url, domain)}
                  />
                ))}
              </ActionPanel.Section>
            ) : null}
          </ActionPanel>
        }
      />
    );
  }

  function renderLiveSuggestionItem(suggestion: string) {
    const url = buildTargetUrl(suggestion, preferences.defaultSearchEngine || "google", preferences.customSearchUrl);
    return (
      <List.Item
        key={`suggest_${suggestion}`}
        icon={Icon.MagnifyingGlass}
        title={suggestion}
        subtitle="Search Suggestion"
        accessories={[{ text: "Enter to select", icon: Icon.ArrowRight }]}
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              <Action
                title="Select Suggestion"
                icon={Icon.ArrowRight}
                onAction={() => handleSelectSuggestion(suggestion)}
              />
              <Action
                title={mode === "query" ? "Switch to Profile Filter Mode" : "Switch to Search Query Mode"}
                icon={mode === "query" ? Icon.Filter : Icon.MagnifyingGlass}
                shortcut={{ modifiers: [], key: "tab" }}
                onAction={toggleMode}
              />
              {defaultProfile ? (
                <Action
                  title="Search in Incognito / InPrivate"
                  icon={Icon.EyeSlash}
                  shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                  onAction={() => handleLaunch(defaultProfile, true, url, suggestion)}
                />
              ) : null}
            </ActionPanel.Section>
            {defaultProfile ? (
              <ActionPanel.Section title="Search in Specific Profile">
                {profiles.map((p) => (
                  <Action
                    key={`suggest_profile_${p.id}`}
                    title={`Search in ${p.displayName}`}
                    icon={getProfileIcon(p)}
                    onAction={() => handleLaunch(p, false, url, suggestion)}
                  />
                ))}
              </ActionPanel.Section>
            ) : null}
          </ActionPanel>
        }
      />
    );
  }

  function renderMatchingHistoryItem(item: LaunchHistoryItem) {
    const matchedProfile = profiles.find((p) => p.id === item.profileId) || defaultProfile;
    return (
      <List.Item
        key={`match_hist_${item.id}`}
        icon={Icon.Clock}
        title={item.query}
        subtitle="Previous Launch"
        accessories={[{ text: item.profileDisplayName }, { text: "Enter to select", icon: Icon.ArrowRight }]}
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              <Action
                title="Select Suggestion"
                icon={Icon.ArrowRight}
                onAction={() => handleSelectSuggestion(item.query)}
              />
              <Action
                title={mode === "query" ? "Switch to Profile Filter Mode" : "Switch to Search Query Mode"}
                icon={mode === "query" ? Icon.Filter : Icon.MagnifyingGlass}
                shortcut={{ modifiers: [], key: "tab" }}
                onAction={toggleMode}
              />
              {matchedProfile ? (
                <Action
                  title="Open in Incognito / InPrivate"
                  icon={Icon.EyeSlash}
                  shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                  onAction={() => handleLaunch(matchedProfile, true, item.resolvedUrl, item.query)}
                />
              ) : null}
            </ActionPanel.Section>
            <ActionPanel.Section title="History Management">
              <Action
                title="Remove from History"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={{ modifiers: ["ctrl"], key: "backspace" }}
                onAction={async () => {
                  const updated = await deleteHistoryItem(item.id);
                  setHistory(updated);
                  await showToast({ style: Toast.Style.Success, title: "Removed from History" });
                }}
              />
            </ActionPanel.Section>
          </ActionPanel>
        }
      />
    );
  }

  // Section title for non-favorite profiles
  const sectionTitle =
    mode === "query"
      ? targetUrl
        ? `Destination: ${targetUrl}`
        : "Browsers & Profiles"
      : searchQuery.trim()
        ? `Routing query: "${searchQuery}"`
        : "Filter Profiles";

  // Dynamic placeholder text
  const placeholderText =
    mode === "query"
      ? "Search query or URL... (Press Tab to filter profiles)"
      : "Filter browser profiles by name... (Press Tab for search mode)";

  if (hasSeenManual === false) {
    return <UserManualView isFirstRun={true} onDismissFirstRun={handleDismissFirstRun} />;
  }

  const hasSuggestions =
    preferences.enableSuggestions !== false &&
    !isQueryLocked &&
    mode === "query" &&
    searchQuery.trim().length >= 2 &&
    (!!domainMatch || matchingHistory.length > 0 || liveSuggestions.length > 0);

  const hasRecents =
    preferences.enableSuggestions !== false && mode === "query" && !searchQuery.trim() && history.length > 0;

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder={placeholderText}
      filtering={false}
      searchText={mode === "query" ? searchQuery : filterText}
      onSearchTextChange={handleSearchTextChange}
      searchBarAccessory={
        <List.Dropdown tooltip="Mode" value={mode} onChange={(val) => setMode(val as "query" | "filter")}>
          <List.Dropdown.Item value="query" title="Search" icon={Icon.MagnifyingGlass} />
          <List.Dropdown.Item value="filter" title="Filter" icon={Icon.Filter} />
        </List.Dropdown>
      }
    >
      <List.EmptyView
        icon={Icon.MagnifyingGlass}
        title="No Matching Profiles"
        description={
          mode === "filter"
            ? `No profile matches "${filterText}". Press Tab to return to search query.`
            : "No browser profiles detected. Add a custom profile below."
        }
        actions={
          <ActionPanel>
            <Action
              title="Switch to Search Query Mode"
              icon={Icon.MagnifyingGlass}
              shortcut={{ modifiers: [], key: "tab" }}
              onAction={() => setMode("query")}
            />
            <Action.Push
              title="Add Custom Profile…"
              icon={Icon.Plus}
              target={<AddCustomProfileForm onProfileAdded={loadProfiles} />}
            />
            <Action title="Refresh Browsers & Profiles" icon={Icon.ArrowClockwise} onAction={loadProfiles} />
            <Action.Push
              title="Send Feedback / Feature Request"
              icon={Icon.Envelope}
              shortcut={{ modifiers: ["ctrl", "shift"], key: "f" }}
              target={<FeedbackForm />}
            />
          </ActionPanel>
        }
      />

      {/* SUGGESTIONS & AUTOCOMPLETE (Only when typing in query mode) */}
      {hasSuggestions ? (
        <List.Section title="Suggestions & Autocomplete">
          {domainMatch ? renderDomainMatchItem(domainMatch) : null}
          {matchingHistory.map(renderMatchingHistoryItem)}
          {liveSuggestions.map(renderLiveSuggestionItem)}
        </List.Section>
      ) : null}

      {/* RECENT LAUNCHES (When search bar is empty) */}
      {hasRecents ? (
        <List.Section title="Recent Launches">{history.slice(0, 4).map(renderRecentHistoryItem)}</List.Section>
      ) : null}

      {/* FAVORITES (Always clean & primary) */}
      {favorites.length > 0 ? <List.Section title="Favorites">{favorites.map(renderProfileItem)}</List.Section> : null}

      {/* ALL OTHER PROFILES */}
      <List.Section title={sectionTitle}>{allOther.map(renderProfileItem)}</List.Section>
    </List>
  );
}

function VaultBridge() {
  const [vaultKey, setVaultKey] = useState<Buffer | null>(null);

  if (!vaultKey) {
    return <VaultUnlockView onUnlocked={(key) => setVaultKey(key)} />;
  }

  return <VaultMainView vaultKey={vaultKey} onLock={() => setVaultKey(null)} />;
}
