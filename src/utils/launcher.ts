import { spawn } from "child_process";
import { showToast, Toast, closeMainWindow } from "@raycast/api";
import { BrowserProfile } from "../types";

export async function launchBrowserProfile(
  profile: BrowserProfile,
  targetUrl?: string,
  incognito = false,
): Promise<boolean> {
  try {
    const args: string[] = [];

    if (profile.browserId === "firefox") {
      if (incognito) {
        args.push("-private-window");
      }
      args.push("-P", profile.profileDirectory);
      if (targetUrl) {
        args.push(targetUrl);
      }
    } else {
      // Chromium browsers (Chrome, Edge, Brave, Vivaldi, Arc, Opera, etc.)
      if (incognito) {
        if (profile.browserId === "edge") {
          args.push("--inprivate");
        } else {
          args.push("--incognito");
        }
      }
      if (profile.profileDirectory && profile.profileDirectory !== "default-no-arg") {
        args.push(`--profile-directory=${profile.profileDirectory}`);
      }
      if (targetUrl) {
        args.push(targetUrl);
      }
    }

    const child = spawn(profile.executablePath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });

    child.unref();

    const modeText = incognito ? " (Incognito)" : "";
    await showToast({
      style: Toast.Style.Success,
      title: `Opened in ${profile.displayName}${modeText}`,
      message: targetUrl ? (targetUrl.length > 50 ? targetUrl.substring(0, 47) + "…" : targetUrl) : undefined,
    });

    await closeMainWindow();
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await showToast({
      style: Toast.Style.Failure,
      title: "Failed to launch browser",
      message,
    });
    return false;
  }
}
