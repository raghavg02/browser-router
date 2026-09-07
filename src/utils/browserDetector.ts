import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { BrowserProfile } from "../types";
import { getCustomProfiles, getFavoriteIds, getProfileNicknames } from "./storage";
import { ensureAvatarBadgedIcon, getAssetsDir } from "./iconBadgeHelper";

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
    // Ignore read errors
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

function getExtractedAssetIcon(browserId: string, exePath?: string): string | undefined {
  try {
    const known = ["chrome", "edge", "brave", "vivaldi"];
    if (known.includes(browserId)) {
      return `extracted/${browserId}.png`;
    }
    const assetsDir = getAssetsDir();
    const extractedDir = path.join(assetsDir, "extracted");
    const extractedFile = path.join(extractedDir, `${browserId}.png`);

    if (fs.existsSync(extractedFile)) {
      return `extracted/${browserId}.png`;
    }

    if (exePath && fs.existsSync(exePath)) {
      const diskLogo = findLogoInAppDir(exePath);
      if (diskLogo && fs.existsSync(diskLogo)) {
        if (!fs.existsSync(extractedDir)) {
          fs.mkdirSync(extractedDir, { recursive: true });
        }
        fs.copyFileSync(diskLogo, extractedFile);
        return `extracted/${browserId}.png`;
      }
    }
  } catch {
    // Ignore extraction errors
  }
  return undefined;
}

function findExe(candidates: string[]): string | undefined {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      return c;
    }
  }
  return undefined;
}

function getRegistryInstalledBrowsers(): Map<string, string> {
  const browserMap = new Map<string, string>();
  if (process.platform !== "win32") return browserMap;

  const regQueries = [
    'reg query "HKLM\\Software\\Clients\\StartMenuInternet" /s',
    'reg query "HKCU\\Software\\Clients\\StartMenuInternet" /s',
    'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Clients\\StartMenuInternet" /s',
  ];

  for (const query of regQueries) {
    try {
      const output = execSync(query, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1500 });
      const lines = output.split("\n");
      let currentBrowserKey = "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("HKEY_")) {
          const match = trimmed.match(/StartMenuInternet\\([^\\]+)/i);
          if (match) {
            currentBrowserKey = match[1].toLowerCase();
          }
        } else if (trimmed.includes("REG_SZ") && currentBrowserKey) {
          const parts = trimmed.split("REG_SZ");
          if (parts.length > 1) {
            let exePath = parts[1].trim();
            if (exePath.startsWith('"') && exePath.includes('"', 1)) {
              exePath = exePath.substring(1, exePath.indexOf('"', 1));
            } else if (exePath.includes(" ")) {
              exePath = exePath.split(" ")[0];
            }
            if (exePath.toLowerCase().endsWith(".exe") && fs.existsSync(exePath)) {
              if (currentBrowserKey.includes("chrome") && !browserMap.has("chrome")) {
                browserMap.set("chrome", exePath);
              } else if (currentBrowserKey.includes("edge") || currentBrowserKey.includes("msedge")) {
                if (!browserMap.has("edge")) browserMap.set("edge", exePath);
              } else if (currentBrowserKey.includes("brave") && !browserMap.has("brave")) {
                browserMap.set("brave", exePath);
              } else if (currentBrowserKey.includes("vivaldi") && !browserMap.has("vivaldi")) {
                browserMap.set("vivaldi", exePath);
              } else if (currentBrowserKey.includes("firefox") && !browserMap.has("firefox")) {
                browserMap.set("firefox", exePath);
              } else if (currentBrowserKey.includes("arc") && !browserMap.has("arc")) {
                browserMap.set("arc", exePath);
              } else if (currentBrowserKey.includes("opera") && !browserMap.has("opera")) {
                browserMap.set("opera", exePath);
              }
            }
          }
        }
      }
    } catch {
      // Ignore registry query failures
    }
  }

  return browserMap;
}

export async function detectInstalledProfiles(): Promise<BrowserProfile[]> {
  const localAppData = process.env.LOCALAPPDATA || "";
  const appData = process.env.APPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  const registryBrowsers = getRegistryInstalledBrowsers();
  const nicknames = await getProfileNicknames();
  const profiles: BrowserProfile[] = [];

  const chromiumConfigs: ChromiumBrowserDef[] = [
    {
      id: "chrome",
      name: "Google Chrome",
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
    if (!exe) continue;

    const extractedIcon = getExtractedAssetIcon(config.id, exe);
    const logoIcon = extractedIcon || findLogoInAppDir(exe);
    const localStatePath = path.join(config.userDir, "Local State");

    const detectedForBrowser: BrowserProfile[] = [];

    if (fs.existsSync(localStatePath)) {
      try {
        const rawJson = fs.readFileSync(localStatePath, "utf8");
        const parsed = JSON.parse(rawJson);
        const infoCache = (parsed?.profile?.info_cache || {}) as Record<string, ChromiumProfileInfo>;

        for (const [profileDir, info] of Object.entries(infoCache)) {
          const profilePath = path.join(config.userDir, profileDir);
          const possiblePics = [
            path.join(profilePath, "Google Profile Picture.png"),
            path.join(profilePath, "Edge Profile Picture.png"),
            path.join(profilePath, "Custom Profile Picture.png"),
          ];
          const diskPic = possiblePics.find((pic) => fs.existsSync(pic));
          const safeProfileId = `${config.id}_${profileDir.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

          // If disk avatar exists, generate/use the badged icon (main browser logo + top-right avatar notification badge)
          // If no custom avatar exists, leave avatarPath undefined so it falls back to native browser logo (logoIcon)
          const avatarPath = diskPic ? ensureAvatarBadgedIcon(config.id, safeProfileId, diskPic) : undefined;

          const rawName = info.name || profileDir;
          const profileId = `${config.id}_${profileDir}`;
          const customName = nicknames[profileId];

          detectedForBrowser.push({
            id: profileId,
            browserId: config.id,
            browserName: config.name,
            profileName: rawName,
            displayName: customName || `${config.name} — ${rawName}`,
            profileDirectory: profileDir,
            executablePath: exe,
            iconPath: logoIcon,
            avatarPath,
            fallbackIcon: config.fallbackIcon,
            email: info.user_name || undefined,
          });
        }
      } catch (err: unknown) {
        console.error(`Failed to read Local State for ${config.name}:`, err);
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
    const ffLogo = getExtractedAssetIcon("firefox", firefoxExe) || findLogoInAppDir(firefoxExe);
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
    const logoIcon =
      getExtractedAssetIcon(cp.browserId || "custom", cp.executablePath) || findLogoInAppDir(cp.executablePath);
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

  return profiles;
}

export async function detectAllProfiles(): Promise<BrowserProfile[]> {
  return detectInstalledProfiles();
}
