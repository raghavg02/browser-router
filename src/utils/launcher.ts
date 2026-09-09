import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { showToast, Toast, closeMainWindow } from "@raycast/api";
import { BrowserProfile } from "../types";

export async function launchBrowserProfile(
  profile: BrowserProfile,
  targetUrl?: string,
  incognito = false,
): Promise<boolean> {
  try {
    if (!profile.executablePath || !fs.existsSync(profile.executablePath)) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Browser not found",
        message: profile.executablePath ? `File does not exist: ${profile.executablePath}` : "No executable specified",
      });
      return false;
    }

    const exeDir = path.dirname(profile.executablePath);
    const args: string[] = [];

    if (profile.browserId === "firefox") {
      if (incognito) {
        args.push("-private-window");
      }
      if (profile.profileDirectory && profile.profileDirectory !== "default") {
        args.push("-P", `"${profile.profileDirectory}"`);
      }
      if (targetUrl) {
        args.push(`"${targetUrl}"`);
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

      // Profile directory targeting:
      // - For Brave and Vivaldi (single default profile): omitting --profile-directory allows them to
      //   attach directly to the user's active session, restoring all cookies, logins, and open windows.
      // - For Chrome, Edge, and multi-profile browsers: pass --profile-directory="<dir>" with inner quotes
      //   so Windows and Chromium parse profile directory names with spaces (e.g. "Profile 1") correctly.
      const isBraveOrVivaldiSingle =
        (profile.browserId === "brave" || profile.browserId === "vivaldi") &&
        (!profile.profileDirectory || profile.profileDirectory === "Default");

      if (profile.profileDirectory && profile.profileDirectory !== "default-no-arg" && !isBraveOrVivaldiSingle) {
        args.push(`--profile-directory="${profile.profileDirectory}"`);
      }

      if (targetUrl) {
        args.push(`"${targetUrl}"`);
      }
    }

    // Direct process spawn: Never use Raycast's open() on Windows because open(url) ignores
    // the application path and routes to the OS default browser.
    // Use windowsVerbatimArguments: true so Node preserves the exact Chromium switch formatting
    // (--profile-directory="Profile 1" rather than wrapping the switch in outer quotes).
    const child = spawn(profile.executablePath, args, {
      detached: true,
      stdio: "ignore",
      cwd: fs.existsSync(exeDir) ? exeDir : undefined,
      windowsVerbatimArguments: true,
      env: process.env,
    });

    child.on("error", async (err) => {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to launch browser",
        message: err.message,
      });
    });

    child.unref();

    const modeText = incognito ? " (Incognito)" : "";
    await showToast({
      style: Toast.Style.Success,
      title: `Opened in ${profile.displayName}${modeText}`,
      message: targetUrl ? (targetUrl.length > 50 ? targetUrl.substring(0, 47) + "..." : targetUrl) : undefined,
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
