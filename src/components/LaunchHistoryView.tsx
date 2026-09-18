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

type HistoryFilterType = "all" | "websites" | "searches";

function isWebsiteLaunch(item: LaunchHistoryItem): boolean {
  return (
    item.resolvedUrl === item.query ||
    item.resolvedUrl === `https://${item.query}` ||
    item.resolvedUrl === `http://${item.query}` ||
    item.query.startsWith("http://") ||
    item.query.startsWith("https://") ||
    (!item.resolvedUrl.includes("/search") && !item.resolvedUrl.includes("?q="))
  );
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
  const [filterType, setFilterType] = useState<HistoryFilterType>("all");
  const { pop } = useNavigation();

  const defaultProfile = useMemo(() => {
    return profiles.find((p) => p.isFavorite) || profiles[0];
  }, [profiles]);

  const filteredHistory = useMemo(() => {
    let result = history;
    if (filterType === "websites") {
      result = result.filter(isWebsiteLaunch);
    } else if (filterType === "searches") {
      result = result.filter((item) => !isWebsiteLaunch(item));
    }

    const q = searchText.trim().toLowerCase();
    if (!q) return result;
    return result.filter(
      (item) =>
        item.query.toLowerCase().includes(q) ||
        item.resolvedUrl.toLowerCase().includes(q) ||
        item.profileDisplayName.toLowerCase().includes(q) ||
        item.browserName.toLowerCase().includes(q),
    );
  }, [history, filterType, searchText]);

  const groupedHistory = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const thisWeekStart = todayStart - 6 * 24 * 60 * 60 * 1000;

    const groups: {
      today: LaunchHistoryItem[];
      yesterday: LaunchHistoryItem[];
      thisWeek: LaunchHistoryItem[];
      older: LaunchHistoryItem[];
    } = {
      today: [],
      yesterday: [],
      thisWeek: [],
      older: [],
    };

    for (const item of filteredHistory) {
      const t = item.timestamp;
      if (t >= todayStart) {
        groups.today.push(item);
      } else if (t >= yesterdayStart) {
        groups.yesterday.push(item);
      } else if (t >= thisWeekStart) {
        groups.thisWeek.push(item);
      } else {
        groups.older.push(item);
      }
    }

    return groups;
  }, [filteredHistory]);

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

  function renderHistoryItem(item: LaunchHistoryItem) {
    const matchedProfile = profiles.find((p) => p.id === item.profileId) || defaultProfile;
    const isRedundantUrl =
      item.resolvedUrl === item.query ||
      item.resolvedUrl === `https://${item.query}` ||
      item.resolvedUrl === `http://${item.query}` ||
      item.resolvedUrl === `https://${item.query}/` ||
      item.resolvedUrl === `http://${item.query}/`;

    return (
      <List.Item
        key={item.id}
        id={item.id}
        icon={Icon.Clock}
        title={item.query}
        subtitle={isRedundantUrl ? undefined : item.resolvedUrl}
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
              <Action title="Use as Search Query" icon={Icon.Pencil} onAction={() => handleUseQuery(item.query)} />
              {matchedProfile ? (
                <Action
                  title="Open in Incognito / InPrivate"
                  icon={Icon.EyeSlash}
                  shortcut={{ modifiers: ["ctrl"], key: "enter" }}
                  onAction={async () => {
                    pop();
                    await onLaunch(matchedProfile, true, item.resolvedUrl, item.query);
                  }}
                />
              ) : null}
              {matchedProfile ? (
                <Action
                  title={`Re-Open in ${matchedProfile.displayName}`}
                  icon={Icon.ArrowRight}
                  shortcut={{ modifiers: ["shift"], key: "enter" }}
                  onAction={async () => {
                    pop();
                    await onLaunch(matchedProfile, false, item.resolvedUrl, item.query);
                  }}
                />
              ) : null}
            </ActionPanel.Section>

            <ActionPanel.Section title="Open in Specific Profile">
              {profiles.map((p) => (
                <Action
                  key={`hist_profile_${p.id}`}
                  title={`Open in ${p.displayName}`}
                  onAction={async () => {
                    pop();
                    await onLaunch(p, false, item.resolvedUrl, item.query);
                  }}
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
  }

  return (
    <List
      searchBarPlaceholder="Search past queries, URLs, and profiles..."
      searchText={searchText}
      onSearchTextChange={setSearchText}
      filtering={false}
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter History Type"
          storeValue={true}
          onChange={(newValue) => setFilterType(newValue as HistoryFilterType)}
        >
          <List.Dropdown.Item title="All History" value="all" icon={Icon.List} />
          <List.Dropdown.Item title="Websites Only" value="websites" icon={Icon.Globe} />
          <List.Dropdown.Item title="Search Queries Only" value="searches" icon={Icon.MagnifyingGlass} />
        </List.Dropdown>
      }
    >
      <List.EmptyView
        icon={Icon.Clock}
        title={searchText ? "No Matching History" : "Your Launch History Will Appear Here"}
        description={
          searchText
            ? `No previous launches matched "${searchText}"`
            : "Every search query and website you launch is automatically remembered for fast recall.\n\n🛡️ Strict Privacy: Incognito launches are never recorded."
        }
        actions={
          <ActionPanel>
            <Action title="Start Browsing" icon={Icon.ArrowRight} onAction={pop} />
          </ActionPanel>
        }
      />

      {groupedHistory.today.length > 0 ? (
        <List.Section title={`Today (${groupedHistory.today.length})`}>
          {groupedHistory.today.map(renderHistoryItem)}
        </List.Section>
      ) : null}

      {groupedHistory.yesterday.length > 0 ? (
        <List.Section title={`Yesterday (${groupedHistory.yesterday.length})`}>
          {groupedHistory.yesterday.map(renderHistoryItem)}
        </List.Section>
      ) : null}

      {groupedHistory.thisWeek.length > 0 ? (
        <List.Section title={`Earlier this Week (${groupedHistory.thisWeek.length})`}>
          {groupedHistory.thisWeek.map(renderHistoryItem)}
        </List.Section>
      ) : null}

      {groupedHistory.older.length > 0 ? (
        <List.Section title={`Older (${groupedHistory.older.length})`}>
          {groupedHistory.older.map(renderHistoryItem)}
        </List.Section>
      ) : null}
    </List>
  );
}
