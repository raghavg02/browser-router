import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { BrowserProfile } from "../types";
import { getCustomProfiles, getFavoriteIds, getProfileNicknames } from "./storage";

interface ChromiumBrowserDef {
  id: string;
  name: string;
  userDir: string;
  fallbackIcon: string;
  exeCandidates: string[];
}

interface ChromiumProfileInfo {
  name?: string;
  gaia_given_name?: string;
  gaia_name?: string;
  user_name?: string;
}

function logDebug(msg: string) {
  try {
    const logFile = "C:\\Users\\ragha\\.config\\raycast\\extensions\\search-router\\detect-debug.log";
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`, "utf8");
  } catch {
    // Ignore logging failures
  }
}

function findLogoInAppDir(exePath: string): string | undefined {
  if (!exePath || !fs.existsSync(exePath)) return undefined;
  const appDir = path.dirname(exePath);

  const searchDirs = [appDir];
  try {
    const entries = fs.readdirSync(appDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        searchDirs.push(path.join(appDir, entry.name));
      }
    }
  } catch {
    // Ignore directory read errors
  }

  for (const dir of searchDirs) {
    const candidates = [
      path.join(dir, "VisualElements", "Logo.png"),
      path.join(dir, "VisualElements", "SmallLogo.png"),
      path.join(dir, "VisualElements", "CopilotStable", "Square44x44Logo.scale-100.png"),
      path.join(dir, "VisualElements", "CopilotDev", "Square44x44Logo.scale-100.png"),
      path.join(dir, "Logo.png"),
      path.join(dir, "SmallLogo.png"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }
  }
  return undefined;
}

function findExe(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function cleanRegistryCmd(cmd: string): string {
  const match = cmd.match(/^"?([^"]+?\.exe)"?/i);
  return match ? match[1] : cmd.replace(/"/g, "").trim();
}

function getBrowsersFromRegistry(): Map<string, string> {
  const map = new Map<string, string>();
  const keys = ["HKLM\\Software\\Clients\\StartMenuInternet", "HKCU\\Software\\Clients\\StartMenuInternet"];

  for (const regKey of keys) {
    try {
      const output = execSync(`reg query "${regKey}" /s`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });

      const lines = output.split("\r\n");
      let currentSubkey = "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("HKEY_")) {
          currentSubkey = trimmed;
        } else if (trimmed.includes("REG_SZ") && currentSubkey.toLowerCase().includes("shell\\open\\command")) {
          const parts = trimmed.split("REG_SZ");
          if (parts.length > 1) {
            const rawExe = parts[1].trim();
            const cleaned = cleanRegistryCmd(rawExe);
            if (fs.existsSync(cleaned)) {
              const lowerKey = currentSubkey.toLowerCase();
              if (lowerKey.includes("chrome")) map.set("chrome", cleaned);
              else if (lowerKey.includes("edge")) map.set("edge", cleaned);
              else if (lowerKey.includes("brave")) map.set("brave", cleaned);
              else if (lowerKey.includes("vivaldi")) map.set("vivaldi", cleaned);
              else if (lowerKey.includes("firefox")) map.set("firefox", cleaned);
              else if (lowerKey.includes("arc")) map.set("arc", cleaned);
              else if (lowerKey.includes("opera")) map.set("opera", cleaned);
            }
          }
        }
      }
    } catch {
      // Ignore registry query failures
    }
  }

  return map;
}

function cleanProfileName(rawName: string, info: ChromiumProfileInfo, dirName: string): string {
  let name = (rawName || "").trim();

  // If generic Person 1 or Default, check if signed in Google / MS account name exists
  if (!name || name === "Person 1" || name === "Default") {
    if (info.gaia_given_name && info.gaia_given_name.trim()) {
      name = info.gaia_given_name.trim();
    } else if (info.gaia_name && info.gaia_name.trim()) {
      name = info.gaia_name.trim();
    } else {
      name = "Default";
    }
  }

  // Friendly names for college domains and common typo fixes
  if (name.toLowerCase().includes("rkgit.edu.in") || name.toLowerCase() === "rkgit") {
    name = "College";
  } else if (name.toLowerCase() === "bussiness") {
    name = "Business";
  }

  return name || dirName;
}

export async function detectAllProfiles(): Promise<BrowserProfile[]> {
  logDebug("Starting detectAllProfiles...");

  // Primary and fallback roots for AppData
  const possibleLocalAppDatas = [
    process.env.LOCALAPPDATA,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local") : "",
    "C:\\Users\\ragha\\AppData\\Local",
  ].filter(Boolean) as string[];

  const possibleAppDatas = [
    process.env.APPDATA,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Roaming") : "",
    "C:\\Users\\ragha\\AppData\\Roaming",
  ].filter(Boolean) as string[];

  const localAppData = possibleLocalAppDatas.find((p) => fs.existsSync(p)) || "C:\\Users\\ragha\\AppData\\Local";
  const appData = possibleAppDatas.find((p) => fs.existsSync(p)) || "C:\\Users\\ragha\\AppData\\Roaming";

  logDebug(`Resolved localAppData=${localAppData}`);

  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  const registryBrowsers = getBrowsersFromRegistry();
  const nicknames = await getProfileNicknames();
  const profiles: BrowserProfile[] = [];

  const chromiumConfigs: ChromiumBrowserDef[] = [
    {
      id: "chrome",
      name: "Chrome",
      userDir: path.join(localAppData, "Google", "Chrome", "User Data"),
      fallbackIcon: "browsers/chrome.svg",
      exeCandidates: [
        registryBrowsers.get("chrome") || "",
        path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      ].filter(Boolean),
    },
    {
      id: "edge",
      name: "Edge",
      userDir: path.join(localAppData, "Microsoft", "Edge", "User Data"),
      fallbackIcon: "browsers/edge.svg",
      exeCandidates: [
        registryBrowsers.get("edge") || "",
        path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      ].filter(Boolean),
    },
    {
      id: "brave",
      name: "Brave",
      userDir: path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data"),
      fallbackIcon: "browsers/brave.svg",
      exeCandidates: [
        registryBrowsers.get("brave") || "",
        path.join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        path.join(programFilesX86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        path.join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      ].filter(Boolean),
    },
    {
      id: "vivaldi",
      name: "Vivaldi",
      userDir: path.join(localAppData, "Vivaldi", "User Data"),
      fallbackIcon: "browsers/vivaldi.svg",
      exeCandidates: [
        registryBrowsers.get("vivaldi") || "",
        path.join(localAppData, "Vivaldi", "Application", "vivaldi.exe"),
        path.join(programFiles, "Vivaldi", "Application", "vivaldi.exe"),
      ].filter(Boolean),
    },
    {
      id: "arc",
      name: "Arc",
      userDir: path.join(localAppData, "Arc", "User Data"),
      fallbackIcon: "browsers/arc.svg",
      exeCandidates: [
        registryBrowsers.get("arc") || "",
        path.join(localAppData, "Arc", "Application", "Arc.exe"),
        path.join(localAppData, "Microsoft", "WindowsApps", "Arc.exe"),
      ].filter(Boolean),
    },
    {
      id: "opera",
      name: "Opera",
      userDir: path.join(appData, "Opera Software", "Opera Stable"),
      fallbackIcon: "browsers/opera.svg",
      exeCandidates: [
        registryBrowsers.get("opera") || "",
        path.join(localAppData, "Programs", "Opera", "launcher.exe"),
        path.join(programFiles, "Opera", "launcher.exe"),
      ].filter(Boolean),
    },
  ];

  for (const config of chromiumConfigs) {
    const exe = findExe(config.exeCandidates);
    if (!exe) {
      logDebug(`Exe not found for ${config.name}`);
      continue;
    }

    const logoIcon = findLogoInAppDir(exe);
    const localStatePath = path.join(config.userDir, "Local State");

    const detectedForBrowser: BrowserProfile[] = [];
    const localStateExists = fs.existsSync(localStatePath);

    logDebug(`Browser ${config.name}: localState=${localStatePath} exists=${localStateExists}`);

    if (localStateExists) {
      try {
        const rawJson = fs.readFileSync(localStatePath, "utf8");
        const parsed = JSON.parse(rawJson);
        const infoCache = (parsed?.profile?.info_cache || {}) as Record<string, ChromiumProfileInfo>;

        const keys = Object.keys(infoCache);
        logDebug(`  ${config.name} found ${keys.length} profile entries in info_cache: ${keys.join(", ")}`);

        for (const [profileDir, info] of Object.entries(infoCache)) {
          const profilePath = path.join(config.userDir, profileDir);
          let avatarPath: string | undefined;

          const possiblePics = [
            path.join(profilePath, "Google Profile Picture.png"),
            path.join(profilePath, "Edge Profile Picture.png"),
            path.join(profilePath, "Custom Profile Picture.png"),
          ];
          for (const pic of possiblePics) {
            if (fs.existsSync(pic)) {
              avatarPath = pic;
              break;
            }
          }

          const rawName = info.name || info.gaia_given_name || info.gaia_name || profileDir;
          const profileName = cleanProfileName(rawName, info, profileDir);
          const profileId = `${config.id}_${profileDir}`;
          const customName = nicknames[profileId];

          detectedForBrowser.push({
            id: profileId,
            browserId: config.id,
            browserName: config.name,
            profileName,
            displayName: customName || `${config.name} — ${profileName}`,
            profileDirectory: profileDir,
            executablePath: exe,
            iconPath: logoIcon,
            avatarPath,
            fallbackIcon: config.fallbackIcon,
            email: info.user_name || undefined,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logDebug(`  Error reading ${config.name}: ${msg}`);
      }
    }

    if (detectedForBrowser.length === 0) {
      const profileId = `${config.id}_Default`;
      const customName = nicknames[profileId];
      detectedForBrowser.push({
        id: profileId,
        browserId: config.id,
        browserName: config.name,
        profileName: "Default",
        displayName: customName || `${config.name} — Default`,
        profileDirectory: "Default",
        executablePath: exe,
        iconPath: logoIcon,
        fallbackIcon: config.fallbackIcon,
      });
    }

    profiles.push(...detectedForBrowser);
  }

  // Detect Mozilla Firefox profiles
  const firefoxExe = findExe(
    [
      registryBrowsers.get("firefox") || "",
      path.join(programFiles, "Mozilla Firefox", "firefox.exe"),
      path.join(programFilesX86, "Mozilla Firefox", "firefox.exe"),
    ].filter(Boolean),
  );

  if (firefoxExe) {
    const ffLogo = findLogoInAppDir(firefoxExe);
    const iniPath = path.join(appData, "Mozilla", "Firefox", "profiles.ini");
    let ffProfilesFound = 0;

    if (fs.existsSync(iniPath)) {
      try {
        const iniContent = fs.readFileSync(iniPath, "utf8");
        const sections = iniContent.split(/\[Profile\d+\]/);
        for (let i = 1; i < sections.length; i++) {
          const section = sections[i];
          const nameMatch = section.match(/Name=([^\r\n]+)/);
          const pathMatch = section.match(/Path=([^\r\n]+)/);
          if (nameMatch) {
            const profileName = nameMatch[1].trim();
            const profilePath = pathMatch ? pathMatch[1].trim() : profileName;
            ffProfilesFound++;
            const profileId = `firefox_${profileName}`;
            const customName = nicknames[profileId];

            profiles.push({
              id: profileId,
              browserId: "firefox",
              browserName: "Firefox",
              profileName,
              displayName: customName || `Firefox — ${profileName}`,
              profileDirectory: profilePath,
              executablePath: firefoxExe,
              iconPath: ffLogo,
              fallbackIcon: "browsers/firefox.svg",
            });
          }
        }
      } catch (err: unknown) {
        console.error("Failed to parse Firefox profiles.ini:", err);
      }
    }

    if (ffProfilesFound === 0) {
      const profileId = "firefox_default";
      const customName = nicknames[profileId];
      profiles.push({
        id: profileId,
        browserId: "firefox",
        browserName: "Firefox",
        profileName: "Default",
        displayName: customName || "Firefox — Default",
        profileDirectory: "default",
        executablePath: firefoxExe,
        iconPath: ffLogo,
        fallbackIcon: "browsers/firefox.svg",
      });
    }
  }

  // Merge Custom Profiles
  const customProfiles = await getCustomProfiles();
  for (const cp of customProfiles) {
    const logoIcon = findLogoInAppDir(cp.executablePath);
    const customName = nicknames[cp.id];
    profiles.push({
      id: cp.id,
      browserId: cp.browserId || "custom",
      browserName: cp.browserName,
      profileName: cp.profileName,
      displayName: customName || `${cp.browserName} — ${cp.profileName}`,
      profileDirectory: cp.profileDirectory,
      executablePath: cp.executablePath,
      iconPath: logoIcon,
      fallbackIcon: "browsers/browser-default.svg",
      isCustom: true,
    });
  }

  // Mark Favorites
  const favIds = await getFavoriteIds();
  for (const p of profiles) {
    p.isFavorite = favIds.includes(p.id);
  }

  logDebug(`Finished detectAllProfiles: found ${profiles.length} profiles total`);
  return profiles;
}
