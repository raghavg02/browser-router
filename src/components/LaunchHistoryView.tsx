import { useState, useMemo } from "react";
import { List, ActionPanel, Action, Icon, Toast, showToast, useNavigation, Keyboard } from "@raycast/api";
import { BrowserProfile } from "../types";
import { LaunchHistoryItem, deleteHistoryItem, clearAllHistory } from "../utils/historyStorage";

interface LaunchHistoryViewProps {
  initialHistory: LaunchHistoryItem[];
  profiles: BrowserProfile[];
  onSelectQuery: (query: string) => void;
  onLaunch: (profile: BrowserProfile, incognito: boolean, url?: string, query?: string) => Promise<void>;
  onHistoryUpdated: (updated: LaunchHistoryItem[]) => void;
}

export function LaunchHistoryView({
  initialHistory,
  profiles,
  onSelectQuery,
  onLaunch,
  onHistoryUpdated,
}: LaunchHistoryViewProps) {
  const [history, setHistory] = useState<LaunchHistoryItem[]>(initialHistory);
  const [searchText, setSearchText] = useState<string>("");
  const { pop } = useNavigation();

  const defaultProfile = useMemo(() => {
    return profiles.find((p) => p.isFavorite) || profiles[0];
  }, [profiles]);

  const filteredHistory = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (item) =>
        item.query.toLowerCase().includes(q) ||
        item.resolvedUrl.toLowerCase().includes(q) ||
        item.profileDisplayName.toLowerCase().includes(q) ||
        item.browserName.toLowerCase().includes(q),
    );
  }, [history, searchText]);

  function handleUseQuery(query: string) {
    onSelectQuery(query);
    pop();
  }

  async function handleDelete(id: string) {
    const updated = await deleteHistoryItem(id);
    setHistory(updated);
    onHistoryUpdated(updated);
    await showToast({ style: Toast.Style.Success, title: "Removed from History" });
  }

  async function handleClearAll() {
    await clearAllHistory();
    setHistory([]);
    onHistoryUpdated([]);
    await showToast({ style: Toast.Style.Success, title: "All History Cleared" });
    pop();
  }

  return (
    <List
      searchBarPlaceholder="Search past queries, URLs, and profiles..."
      searchText={searchText}
      onSearchTextChange={setSearchText}
      filtering={false}
    >
      <List.EmptyView
        icon={Icon.Clock}
        title={searchText ? "No Matching History" : "No Launch History Yet"}
        description={
          searchText
            ? `No previous launches matched "${searchText}"`
            : "Searches and links you open will be remembered here for easy recall."
        }
      />

      <List.Section title={`Past Launches (${filteredHistory.length})`}>
        {filteredHistory.map((item) => {
          const matchedProfile = profiles.find((p) => p.id === item.profileId) || defaultProfile;
          return (
            <List.Item
              key={item.id}
              id={item.id}
              icon={Icon.Clock}
              title={item.query}
              subtitle={item.resolvedUrl}
              accessories={[
                { text: item.profileDisplayName, icon: Icon.Globe },
                {
                  date: new Date(item.timestamp),
                  tooltip: `Opened on ${new Date(item.timestamp).toLocaleString()}`,
                },
              ]}
              actions={
                <ActionPanel>
                  <ActionPanel.Section>
                    <Action
                      title="Use as Search Query"
                      icon={Icon.Pencil}
                      onAction={() => handleUseQuery(item.query)}
                    />
                    {matchedProfile ? (
                      <Action
                        title="Open in Incognito / InPrivate"
                        icon={Icon.EyeSlash}
                        shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                        onAction={() => onLaunch(matchedProfile, true, item.resolvedUrl, item.query)}
                      />
                    ) : null}
                    {matchedProfile ? (
                      <Action
                        title={`Re-Open in ${matchedProfile.displayName}`}
                        icon={Icon.ArrowRight}
                        shortcut={{ modifiers: ["shift"], key: "enter" }}
                        onAction={() => onLaunch(matchedProfile, false, item.resolvedUrl, item.query)}
                      />
                    ) : null}
                  </ActionPanel.Section>

                  <ActionPanel.Section title="Open in Specific Profile">
                    {profiles.map((p) => (
                      <Action
                        key={`hist_profile_${p.id}`}
                        title={`Open in ${p.displayName}`}
                        onAction={() => onLaunch(p, false, item.resolvedUrl, item.query)}
                      />
                    ))}
                  </ActionPanel.Section>

                  <ActionPanel.Section title="Clipboard">
                    <Action.CopyToClipboard
                      title="Copy Destination URL"
                      content={item.resolvedUrl}
                      shortcut={{ modifiers: ["ctrl"], key: "c" }}
                    />
                    <Action.CopyToClipboard
                      title="Copy Search Query"
                      content={item.query}
                      shortcut={Keyboard.Shortcut.Common.Copy}
                    />
                  </ActionPanel.Section>

                  <ActionPanel.Section title="History Management">
                    <Action
                      title="Remove from History"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      shortcut={{ modifiers: ["ctrl"], key: "backspace" }}
                      onAction={() => handleDelete(item.id)}
                    />
                    <Action
                      title="Clear All History"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      shortcut={{ modifiers: ["ctrl", "shift"], key: "backspace" }}
                      onAction={handleClearAll}
                    />
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}
