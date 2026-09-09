import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { showToast, Toast, closeMainWindow } from "@raycast/api";
import { BrowserProfile } from "../types";

function getWindowsShellHelperPath(): string {
  const vbsPath = path.join(os.tmpdir(), "search_router_launch.vbs");
  if (!fs.existsSync(vbsPath)) {
    fs.writeFileSync(
      vbsPath,
      'Set s=CreateObject("Shell.Application")\n' +
        'args=""\n' +
        'cwd=""\n' +
        "If WScript.Arguments.Count > 1 Then\n" +
        "  args = WScript.Arguments(1)\n" +
        "End If\n" +
        "If WScript.Arguments.Count > 2 Then\n" +
        "  cwd = WScript.Arguments(2)\n" +
        "End If\n" +
        's.ShellExecute WScript.Arguments(0), args, cwd, "open", 1\n',
      "utf8",
    );
  }
  return vbsPath;
}

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
    const argsParts: string[] = [];

    if (profile.browserId === "firefox") {
      if (incognito) {
        argsParts.push("-private-window");
      }
      if (profile.profileDirectory && profile.profileDirectory !== "default") {
        argsParts.push("-P", `"${profile.profileDirectory}"`);
      }
      if (targetUrl) {
        argsParts.push(`"${targetUrl}"`);
      }
    } else {
      // Chromium browsers (Chrome, Edge, Brave, Vivaldi, Arc, Opera, etc.)
      if (incognito) {
        if (profile.browserId === "edge") {
          argsParts.push("--inprivate");
        } else {
          argsParts.push("--incognito");
        }
      }

      if (profile.profileDirectory && profile.profileDirectory !== "default-no-arg") {
        if (profile.profileDirectory.includes(" ")) {
          argsParts.push(`--profile-directory="${profile.profileDirectory}"`);
        } else {
          argsParts.push(`--profile-directory=${profile.profileDirectory}`);
        }
      }

      if (targetUrl) {
        argsParts.push(`"${targetUrl}"`);
      }
    }

    if (process.platform === "win32") {
      // On Windows, Raycast runs as an MSIX packaged app (WindowsApps).
      // Child processes spawned directly via Node inside an MSIX container inherit the MSIX
      // package identity, which causes Windows to virtualize %LOCALAPPDATA% into %LOCALAPPDATA%\\Temp
      // and restricts DPAPI encryption keys. This caused cold-started browsers (Brave and Vivaldi)
      // to open into an unauthenticated, isolated "Temp" profile instead of the real user profile.
      //
      // Calling Windows Desktop Shell (Shell.Application.ShellExecute via wscript) delegates the launch
      // to explorer.exe (the Windows interactive desktop shell). This launches the browser as a true
      // top-level desktop process in the active desktop session with full access to the real %LOCALAPPDATA%
      // and all authenticated logins, sessions, and cookies.
      const helperPath = getWindowsShellHelperPath();
      const argsString = argsParts.join(" ");

      const child = spawn("wscript.exe", [helperPath, profile.executablePath, argsString, exeDir || ""], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });

      child.on("error", async (err) => {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to launch browser",
          message: err.message,
        });
      });

      child.unref();
    } else {
      // macOS / Linux standard spawn
      const child = spawn(profile.executablePath, argsParts, {
        detached: true,
        stdio: "ignore",
        cwd: fs.existsSync(exeDir) ? exeDir : undefined,
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
