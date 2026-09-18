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
  confirmAlert,
} from "@raycast/api";
import { useEffect, useState, useMemo } from "react";
import { BrowserProfile } from "./types";
import { detectAllProfiles } from "./utils/browserDetector";
import { buildTargetUrl } from "./utils/urlHelper";
import { launchBrowserProfile } from "./utils/launcher";
import { toggleFavorite, removeCustomProfile } from "./utils/storage";
import { AddCustomProfileForm } from "./components/AddCustomProfileForm";
import { RenameProfileForm } from "./components/RenameProfileForm";
import { FeedbackForm } from "./components/FeedbackForm";
import { UserManualView } from "./components/UserManualView";
import { LaunchHistoryView } from "./components/LaunchHistoryView";
import {
  LaunchHistoryItem,
  getLaunchHistory,
  recordLaunch,
  deleteHistoryItem,
  clearAllHistory,
  getPreferredProfileId,
  setPreferredProfileId,
} from "./utils/historyStorage";
import { getDomainSuggestion, fetchLiveSearchSuggestions, filterMatchingHistory } from "./utils/suggestionService";

export default function Command(props: LaunchProps<{ arguments: { query?: string }; fallbackText?: string }>) {
  const preferences = getPreferenceValues<Preferences.BrowserRouter>();

  // Determine if query came from Raycast argument or fallback text
  const initialQuery = (props.arguments?.query || props.fallbackText || "").trim();

  // Mode: "query" (default, typing updates search query/URL) or "filter" (typing filters browser list)
  const [mode, setMode] = useState<"query" | "filter">("query");

  // Preserved state for both modes
  const [searchQuery, setSearchQuery] = useState<string>(initialQuery);
  const [filterText, setFilterText] = useState<string>("");

  // Lock suggestions when user explicitly selects a suggestion with Enter
  const [isQueryLocked, setIsQueryLocked] = useState<boolean>(false);
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>(undefined);

  // Incognito intent: true when user selects suggestion with Ctrl + Enter
  const [isIncognitoIntent, setIsIncognitoIntent] = useState<boolean>(false);
  const [preferredProfileId, setPreferredProfileIdState] = useState<string | null>(null);

  function handleSearchTextChange(text: string) {
    if (mode === "query") {
      setSearchQuery(text);
      if (isQueryLocked) {
        setIsQueryLocked(false);
        setIsIncognitoIntent(false);
      }
      setSelectedItemId(undefined);
    } else {
      setFilterText(text);
      setSelectedItemId(undefined);
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

  useEffect(() => {
    async function loadPreferred() {
      const id = await getPreferredProfileId();
      setPreferredProfileIdState(id);
    }
    loadPreferred();
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
    if (preferences.enableLiveSuggestions === false || mode !== "query" || isQueryLocked) return null;
    return getDomainSuggestion(searchQuery);
  }, [searchQuery, mode, preferences.enableLiveSuggestions, isQueryLocked]);

  // Matching past history items
  const matchingHistory = useMemo(() => {
    if (preferences.enableHistory === false || mode !== "query" || isQueryLocked) return [];
    return filterMatchingHistory(history, searchQuery, 2);
  }, [history, searchQuery, mode, preferences.enableHistory, isQueryLocked]);

  // Debounced live search suggestions from Google
  useEffect(() => {
    if (preferences.enableLiveSuggestions === false || mode !== "query" || isQueryLocked) {
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
  }, [searchQuery, mode, preferences.enableLiveSuggestions, isQueryLocked]);

  async function handleLaunch(
    profile: BrowserProfile,
    incognito = false,
    overrideUrl?: string,
    overrideQuery?: string,
  ) {
    const urlToOpen = overrideUrl || targetUrl;
    const queryUsed = overrideQuery || searchQuery;
    const finalIncognito = incognito || isIncognitoIntent;
    await launchBrowserProfile(profile, urlToOpen || undefined, finalIncognito);

    // STRICT PRIVACY GUARANTEE: Never record launches in incognito mode
    if (!finalIncognito && queryUsed.trim()) {
      await recordLaunch(queryUsed, urlToOpen, profile, false);
      const updatedHistory = await getLaunchHistory();
      setHistory(updatedHistory);
    }
    setIsIncognitoIntent(false);
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

  const firstProfileId = useMemo(() => {
    return favorites[0]?.id || allOther[0]?.id || profiles[0]?.id;
  }, [favorites, allOther, profiles]);

  const preferredProfile = useMemo(() => {
    if (!preferredProfileId) return null;
    return profiles.find((p) => p.id === preferredProfileId) || null;
  }, [profiles, preferredProfileId]);

  async function handleSetPreferredProfile(profileId: string) {
    if (preferredProfileId && preferredProfileId !== profileId) {
      const currentProfile = profiles.find((p) => p.id === preferredProfileId);
      const currentName = currentProfile ? currentProfile.displayName : "Another profile";
      const targetProfile = profiles.find((p) => p.id === profileId);
      const targetName = targetProfile ? targetProfile.displayName : "Selected profile";
      const confirmed = await confirmAlert({
        title: "Change Quick-Launch Profile?",
        message: `"${currentName}" is currently your preferred Quick-Launch profile. Do you really want to change it to "${targetName}"?`,
        primaryAction: {
          title: "Change Profile",
        },
        dismissAction: {
          title: "Cancel",
        },
      });
      if (!confirmed) return;
    }

    const nextId = preferredProfileId === profileId ? null : profileId;
    await setPreferredProfileId(nextId);
    setPreferredProfileIdState(nextId);
    await showToast({
      style: Toast.Style.Success,
      title: nextId ? "Set as Quick-Launch Profile" : "Removed Quick-Launch Profile",
    });
  }

  function handleSelectSuggestion(selectedText: string, incognito = false) {
    setSearchQuery(selectedText);
    setIsQueryLocked(true);
    setIsIncognitoIntent(incognito);
    if (firstProfileId) {
      setSelectedItemId(firstProfileId);
    }
  }

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
    setSelectedItemId(undefined);
  }

  function renderProfileItem(profile: BrowserProfile) {
    const icon = getProfileIcon(profile);
    const accessories: List.Item.Accessory[] = [];

    if (preferredProfileId === profile.id) {
      accessories.push({ icon: Icon.Bolt, tooltip: "Preferred Quick-Launch Profile" });
    }
    accessories.push({ text: `Profile: ${profile.profileDirectory}` });

    return (
      <List.Item
        key={profile.id}
        id={profile.id}
        icon={icon}
        title={profile.displayName}
        accessories={accessories}
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              <Action
                title={
                  isIncognitoIntent ? `Open in ${profile.displayName} (Incognito)` : `Open in ${profile.displayName}`
                }
                icon={isIncognitoIntent ? Icon.EyeSlash : Icon.Globe}
                onAction={() => handleLaunch(profile, isIncognitoIntent)}
              />
              <Action
                title="Open in Incognito / InPrivate"
                icon={Icon.EyeSlash}
                shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                onAction={() => handleLaunch(profile, true)}
              />
              {isIncognitoIntent ? (
                <Action
                  title={`Open in ${profile.displayName} (Normal Window)`}
                  icon={Icon.Globe}
                  shortcut={{ modifiers: ["shift"], key: "enter" }}
                  onAction={() => handleLaunch(profile, false)}
                />
              ) : null}
            </ActionPanel.Section>

            <ActionPanel.Section title="Search & Filter Mode">
              <Action
                title={mode === "query" ? "Switch to Profile Filter Mode" : "Switch to Search Query Mode"}
                icon={mode === "query" ? Icon.Filter : Icon.MagnifyingGlass}
                shortcut={{ modifiers: [], key: "tab" }}
                onAction={toggleMode}
              />
              {isIncognitoIntent ? (
                <Action
                  title="Cancel Incognito Mode"
                  icon={Icon.Eye}
                  shortcut={{ modifiers: ["ctrl", "shift"], key: "i" }}
                  onAction={() => setIsIncognitoIntent(false)}
                />
              ) : null}
              {searchQuery ? (
                <Action
                  title="Clear Search Query"
                  icon={Icon.XMarkCircle}
                  shortcut={{ modifiers: ["ctrl", "shift"], key: "x" }}
                  onAction={() => {
                    setSearchQuery("");
                    setIsQueryLocked(false);
                    setIsIncognitoIntent(false);
                    setSelectedItemId(undefined);
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
                title={preferredProfileId === profile.id ? "Remove as Preferred Profile" : "Set as Preferred Profile"}
                icon={Icon.Bolt}
                shortcut={{ modifiers: ["ctrl", "shift"], key: "p" }}
                onAction={() => handleSetPreferredProfile(profile.id)}
              />
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

            <ActionPanel.Section title="History">
              <Action.Push
                title="View All Launch History…"
                icon={Icon.Clock}
                shortcut={{ modifiers: ["ctrl", "shift"], key: "h" }}
                target={
                  <LaunchHistoryView
                    initialHistory={history}
                    profiles={profiles}
                    onSelectQuery={(q) => handleSelectSuggestion(q, false)}
                    onLaunch={handleLaunch}
                    onHistoryUpdated={setHistory}
                  />
                }
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
        id={`recent_${item.id}`}
        icon={Icon.Clock}
        title={item.query}
        subtitle={item.resolvedUrl}
        accessories={[
          { text: "Enter to use query", icon: Icon.Pencil },
          { text: item.profileDisplayName, icon: Icon.Globe },
          { date: new Date(item.timestamp), tooltip: `Last opened: ${new Date(item.timestamp).toLocaleString()}` },
        ]}
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              <Action
                title="Use as Search Query"
                icon={Icon.Pencil}
                onAction={() => handleSelectSuggestion(item.query, false)}
              />
              {matchedProfile ? (
                <Action
                  title="Open in Incognito / InPrivate"
                  icon={Icon.EyeSlash}
                  shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                  onAction={() => handleLaunch(matchedProfile, true, item.resolvedUrl, item.query)}
                />
              ) : null}
              {matchedProfile ? (
                <Action
                  title={`Re-Open in ${matchedProfile.displayName}`}
                  icon={Icon.ArrowRight}
                  shortcut={{ modifiers: ["shift"], key: "enter" }}
                  onAction={() => handleLaunch(matchedProfile, false, item.resolvedUrl, item.query)}
                />
              ) : null}
            </ActionPanel.Section>

            <ActionPanel.Section title="Search & Filter Mode">
              <Action
                title={mode === "query" ? "Switch to Profile Filter Mode" : "Switch to Search Query Mode"}
                icon={mode === "query" ? Icon.Filter : Icon.MagnifyingGlass}
                shortcut={{ modifiers: [], key: "tab" }}
                onAction={toggleMode}
              />
            </ActionPanel.Section>

            <ActionPanel.Section title="History">
              <Action.Push
                title="View All Launch History…"
                icon={Icon.Clock}
                shortcut={{ modifiers: ["ctrl", "shift"], key: "h" }}
                target={
                  <LaunchHistoryView
                    initialHistory={history}
                    profiles={profiles}
                    onSelectQuery={(q) => handleSelectSuggestion(q, false)}
                    onLaunch={handleLaunch}
                    onHistoryUpdated={setHistory}
                  />
                }
              />
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
        id={`domain_${domain}`}
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
                onAction={() => handleSelectSuggestion(domain, false)}
              />
              <Action
                title="Select for Incognito Launch"
                icon={Icon.EyeSlash}
                shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                onAction={() => handleSelectSuggestion(domain, true)}
              />
              {preferences.quickLaunchShortcutEnabled !== false ? (
                preferredProfile ? (
                  <Action
                    title={`Quick-Launch in ${preferredProfile.displayName}`}
                    icon={Icon.Bolt}
                    shortcut={{ modifiers: ["shift"], key: "enter" }}
                    onAction={() => handleLaunch(preferredProfile, false, url, domain)}
                  />
                ) : (
                  <Action
                    title="Quick-Launch (Set Preferred Profile First…)"
                    icon={Icon.Bolt}
                    shortcut={{ modifiers: ["shift"], key: "enter" }}
                    onAction={async () => {
                      await showToast({
                        style: Toast.Style.Failure,
                        title: "No Preferred Profile Set",
                        message: "Highlight any profile below and press Ctrl+Shift+P to set it as Quick-Launch.",
                      });
                    }}
                  />
                )
              ) : null}
            </ActionPanel.Section>

            <ActionPanel.Section title="Search & Filter Mode">
              <Action
                title={mode === "query" ? "Switch to Profile Filter Mode" : "Switch to Search Query Mode"}
                icon={mode === "query" ? Icon.Filter : Icon.MagnifyingGlass}
                shortcut={{ modifiers: [], key: "tab" }}
                onAction={toggleMode}
              />
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

            <ActionPanel.Section title="History">
              <Action.Push
                title="View All Launch History…"
                icon={Icon.Clock}
                shortcut={{ modifiers: ["ctrl", "shift"], key: "h" }}
                target={
                  <LaunchHistoryView
                    initialHistory={history}
                    profiles={profiles}
                    onSelectQuery={(q) => handleSelectSuggestion(q, false)}
                    onLaunch={handleLaunch}
                    onHistoryUpdated={setHistory}
                  />
                }
              />
            </ActionPanel.Section>
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
        id={`suggest_${suggestion}`}
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
                onAction={() => handleSelectSuggestion(suggestion, false)}
              />
              <Action
                title="Select for Incognito Launch"
                icon={Icon.EyeSlash}
                shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                onAction={() => handleSelectSuggestion(suggestion, true)}
              />
              {preferences.quickLaunchShortcutEnabled !== false ? (
                preferredProfile ? (
                  <Action
                    title={`Quick-Launch in ${preferredProfile.displayName}`}
                    icon={Icon.Bolt}
                    shortcut={{ modifiers: ["shift"], key: "enter" }}
                    onAction={() => handleLaunch(preferredProfile, false, url, suggestion)}
                  />
                ) : (
                  <Action
                    title="Quick-Launch (Set Preferred Profile First…)"
                    icon={Icon.Bolt}
                    shortcut={{ modifiers: ["shift"], key: "enter" }}
                    onAction={async () => {
                      await showToast({
                        style: Toast.Style.Failure,
                        title: "No Preferred Profile Set",
                        message: "Highlight any profile below and press Ctrl+Shift+P to set it as Quick-Launch.",
                      });
                    }}
                  />
                )
              ) : null}
            </ActionPanel.Section>

            <ActionPanel.Section title="Search & Filter Mode">
              <Action
                title={mode === "query" ? "Switch to Profile Filter Mode" : "Switch to Search Query Mode"}
                icon={mode === "query" ? Icon.Filter : Icon.MagnifyingGlass}
                shortcut={{ modifiers: [], key: "tab" }}
                onAction={toggleMode}
              />
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

            <ActionPanel.Section title="History">
              <Action.Push
                title="View All Launch History…"
                icon={Icon.Clock}
                shortcut={{ modifiers: ["ctrl", "shift"], key: "h" }}
                target={
                  <LaunchHistoryView
                    initialHistory={history}
                    profiles={profiles}
                    onSelectQuery={(q) => handleSelectSuggestion(q, false)}
                    onLaunch={handleLaunch}
                    onHistoryUpdated={setHistory}
                  />
                }
              />
            </ActionPanel.Section>
          </ActionPanel>
        }
      />
    );
  }

  function renderMatchingHistoryItem(item: LaunchHistoryItem) {
    return (
      <List.Item
        key={`match_hist_${item.id}`}
        id={`match_hist_${item.id}`}
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
                onAction={() => handleSelectSuggestion(item.query, false)}
              />
              <Action
                title="Select for Incognito Launch"
                icon={Icon.EyeSlash}
                shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                onAction={() => handleSelectSuggestion(item.query, true)}
              />
              {preferences.quickLaunchShortcutEnabled !== false ? (
                preferredProfile ? (
                  <Action
                    title={`Quick-Launch in ${preferredProfile.displayName}`}
                    icon={Icon.Bolt}
                    shortcut={{ modifiers: ["shift"], key: "enter" }}
                    onAction={() => handleLaunch(preferredProfile, false, item.resolvedUrl, item.query)}
                  />
                ) : (
                  <Action
                    title="Quick-Launch (Set Preferred Profile First…)"
                    icon={Icon.Bolt}
                    shortcut={{ modifiers: ["shift"], key: "enter" }}
                    onAction={async () => {
                      await showToast({
                        style: Toast.Style.Failure,
                        title: "No Preferred Profile Set",
                        message: "Highlight any profile below and press Ctrl+Shift+P to set it as Quick-Launch.",
                      });
                    }}
                  />
                )
              ) : null}
            </ActionPanel.Section>

            <ActionPanel.Section title="Search & Filter Mode">
              <Action
                title={mode === "query" ? "Switch to Profile Filter Mode" : "Switch to Search Query Mode"}
                icon={mode === "query" ? Icon.Filter : Icon.MagnifyingGlass}
                shortcut={{ modifiers: [], key: "tab" }}
                onAction={toggleMode}
              />
            </ActionPanel.Section>

            <ActionPanel.Section title="History Management">
              <Action.Push
                title="View All Launch History…"
                icon={Icon.Clock}
                shortcut={{ modifiers: ["ctrl", "shift"], key: "h" }}
                target={
                  <LaunchHistoryView
                    initialHistory={history}
                    profiles={profiles}
                    onSelectQuery={(q) => handleSelectSuggestion(q, false)}
                    onLaunch={handleLaunch}
                    onHistoryUpdated={setHistory}
                  />
                }
              />
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
      ? isIncognitoIntent
        ? targetUrl
          ? `Incognito Destination: ${targetUrl}`
          : "Browsers & Profiles (Incognito Mode)"
        : targetUrl
          ? `Destination: ${targetUrl}`
          : "Browsers & Profiles"
      : searchQuery.trim()
        ? `Routing query: "${searchQuery}"`
        : "Filter Profiles";

  // Dynamic placeholder text
  const placeholderText =
    mode === "query"
      ? isIncognitoIntent
        ? "Incognito Mode: Select profile to launch in Incognito..."
        : "Search query or URL... (Press Tab to filter profiles)"
      : "Filter browser profiles by name... (Press Tab for search mode)";

  if (hasSeenManual === false) {
    return <UserManualView isFirstRun={true} onDismissFirstRun={handleDismissFirstRun} />;
  }

  const hasSuggestions =
    (preferences.enableLiveSuggestions !== false || preferences.enableHistory !== false) &&
    !isQueryLocked &&
    mode === "query" &&
    searchQuery.trim().length >= 2 &&
    ((preferences.enableLiveSuggestions !== false && (!!domainMatch || liveSuggestions.length > 0)) ||
      (preferences.enableHistory !== false && matchingHistory.length > 0));

  const hasRecents =
    preferences.enableHistory !== false && mode === "query" && !searchQuery.trim() && history.length > 0;

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder={placeholderText}
      filtering={false}
      searchText={mode === "query" ? searchQuery : filterText}
      onSearchTextChange={handleSearchTextChange}
      selectedItemId={selectedItemId}
      onSelectionChange={(id) => setSelectedItemId(id ?? undefined)}
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
        <List.Section title="Recent Launches">
          {history.slice(0, 4).map(renderRecentHistoryItem)}
          {history.length > 4 ? (
            <List.Item
              id="view_all_history_item"
              icon={Icon.Clock}
              title="View All Launch History…"
              subtitle={`${history.length} past searches and links saved`}
              accessories={[{ text: "Open History Manager", icon: Icon.ArrowRight }]}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="View All Launch History…"
                    icon={Icon.Clock}
                    target={
                      <LaunchHistoryView
                        initialHistory={history}
                        profiles={profiles}
                        onSelectQuery={(q) => handleSelectSuggestion(q, false)}
                        onLaunch={handleLaunch}
                        onHistoryUpdated={setHistory}
                      />
                    }
                  />
                  <ActionPanel.Section title="Search & Filter Mode">
                    <Action
                      title={mode === "query" ? "Switch to Profile Filter Mode" : "Switch to Search Query Mode"}
                      icon={mode === "query" ? Icon.Filter : Icon.MagnifyingGlass}
                      shortcut={{ modifiers: [], key: "tab" }}
                      onAction={toggleMode}
                    />
                  </ActionPanel.Section>
                  <ActionPanel.Section title="History Management">
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
          ) : null}
        </List.Section>
      ) : null}

      {/* FAVORITES (Always clean & primary) */}
      {favorites.length > 0 ? <List.Section title="Favorites">{favorites.map(renderProfileItem)}</List.Section> : null}

      {/* ALL OTHER PROFILES */}
      <List.Section title={sectionTitle}>{allOther.map(renderProfileItem)}</List.Section>
    </List>
  );
}
