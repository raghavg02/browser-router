import { LocalStorage } from "@raycast/api";
import { BrowserProfile } from "../types";

const HISTORY_STORAGE_KEY = "browser_router_launch_history";
const MAX_HISTORY_ITEMS = 50;

export interface LaunchHistoryItem {
  id: string;
  query: string;
  resolvedUrl: string;
  profileId: string;
  profileDisplayName: string;
  browserName: string;
  timestamp: number;
  launchCount: number;
}

/**
 * Loads all saved launch history from LocalStorage, sorted by most recent.
 */
export async function getLaunchHistory(): Promise<LaunchHistoryItem[]> {
  try {
    const raw = await LocalStorage.getItem<string>(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: LaunchHistoryItem[] = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("[browser-router] Failed to read launch history", error);
    return [];
  }
}

/**
 * Records a launch into local history.
 *
 * PRIVACY GUARANTEE:
 * If incognito is true, this function exits IMMEDIATELY without writing anything.
 */
export async function recordLaunch(
  query: string,
  resolvedUrl: string,
  profile: BrowserProfile,
  incognito: boolean,
): Promise<void> {
  // STRICT PRIVACY: Never record incognito / InPrivate browsing
  if (incognito) return;

  const trimmedQuery = query.trim();
  if (!trimmedQuery) return;

  try {
    const history = await getLaunchHistory();
    const normalizedKey = trimmedQuery.toLowerCase();

    // Check if an entry with the exact same query and profile already exists
    const existingIndex = history.findIndex(
      (item) => item.query.toLowerCase() === normalizedKey && item.profileId === profile.id,
    );

    let updated: LaunchHistoryItem[];

    if (existingIndex >= 0) {
      const existing = history[existingIndex];
      const updatedItem: LaunchHistoryItem = {
        ...existing,
        query: trimmedQuery,
        resolvedUrl,
        profileDisplayName: profile.displayName,
        browserName: profile.browserName,
        timestamp: Date.now(),
        launchCount: (existing.launchCount || 1) + 1,
      };
      // Move to front
      updated = [updatedItem, ...history.filter((_, idx) => idx !== existingIndex)];
    } else {
      const newItem: LaunchHistoryItem = {
        id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        query: trimmedQuery,
        resolvedUrl,
        profileId: profile.id,
        profileDisplayName: profile.displayName,
        browserName: profile.browserName,
        timestamp: Date.now(),
        launchCount: 1,
      };
      updated = [newItem, ...history];
    }

    // Cap at MAX_HISTORY_ITEMS
    if (updated.length > MAX_HISTORY_ITEMS) {
      updated = updated.slice(0, MAX_HISTORY_ITEMS);
    }

    await LocalStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("[browser-router] Failed to record launch history", error);
  }
}

/**
 * Removes a single history item by ID.
 */
export async function deleteHistoryItem(id: string): Promise<LaunchHistoryItem[]> {
  try {
    const history = await getLaunchHistory();
    const filtered = history.filter((item) => item.id !== id);
    await LocalStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(filtered));
    return filtered;
  } catch (error) {
    console.error("[browser-router] Failed to delete history item", error);
    return [];
  }
}

/**
 * Clears all launch history.
 */
export async function clearAllHistory(): Promise<void> {
  try {
    await LocalStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch (error) {
    console.error("[browser-router] Failed to clear history", error);
  }
}
