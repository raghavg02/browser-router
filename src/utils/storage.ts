import { LocalStorage } from "@raycast/api";
import { CustomProfileData } from "../types";

const CUSTOM_PROFILES_KEY = "custom_browser_profiles";
const FAVORITES_KEY = "favorite_profile_ids";

export async function getCustomProfiles(): Promise<CustomProfileData[]> {
  const data = await LocalStorage.getItem<string>(CUSTOM_PROFILES_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function saveCustomProfile(profile: CustomProfileData): Promise<void> {
  const existing = await getCustomProfiles();
  const filtered = existing.filter((p) => p.id !== profile.id);
  filtered.push(profile);
  await LocalStorage.setItem(CUSTOM_PROFILES_KEY, JSON.stringify(filtered));
}

export async function removeCustomProfile(id: string): Promise<void> {
  const existing = await getCustomProfiles();
  const filtered = existing.filter((p) => p.id !== id);
  await LocalStorage.setItem(CUSTOM_PROFILES_KEY, JSON.stringify(filtered));
}

export async function getFavoriteIds(): Promise<string[]> {
  const data = await LocalStorage.getItem<string>(FAVORITES_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function toggleFavorite(profileId: string): Promise<boolean> {
  const favorites = await getFavoriteIds();
  const index = favorites.indexOf(profileId);
  let isFav = false;
  if (index >= 0) {
    favorites.splice(index, 1);
    isFav = false;
  } else {
    favorites.push(profileId);
    isFav = true;
  }
  await LocalStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  return isFav;
}
