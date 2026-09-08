import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { showToast, Toast, closeMainWindow, open } from "@raycast/api";
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

    const isBraveOrVivaldi = profile.browserId === "brave" || profile.browserId === "vivaldi";
    const isSingleDefaultProfile = isBraveOrVivaldi && (profile.profileDirectory === "Default" || !profile.profileDirectory);

    if (isSingleDefaultProfile && !incognito) {
      try {
        if (targetUrl) {
          await open(targetUrl, profile.executablePath);
        } else {
          await open(profile.executablePath);
        }
      } catch {
        const args = targetUrl ? [targetUrl] : [];
        const exeDir = path.dirname(profile.executablePath);
        const child = spawn(profile.executablePath, args, {
          detached: true,
          stdio: "ignore",
          cwd: fs.existsSync(exeDir) ? exeDir : undefined,
        });
        child.unref();
      }
    } else {
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

      const exeDir = path.dirname(profile.executablePath);
      const child = spawn(profile.executablePath, args, {
        detached: true,
        stdio: "ignore",
        cwd: fs.existsSync(exeDir) ? exeDir : undefined,
      });

      child.on("error", async (err) => {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to launch browser",
          message: err.message,
        });
      });

      child.unref();
    }

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
