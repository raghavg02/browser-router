import { Detail, ActionPanel, Action, Icon, openExtensionPreferences } from "@raycast/api";
import { FeedbackForm } from "./FeedbackForm";

export const USER_MANUAL_MARKDOWN = `# 🧭 Search Router — Complete User Manual & Guide

Welcome to **Search Router**! Search Router gives you instant, keyboard-driven control over routing web searches and URLs to any browser and profile installed on Windows.

---

## ⚡ Quick Start: Dual-Mode Architecture

Search Router features a **Dual-Mode** input system designed for zero friction:

### 1. 🔍 Search Query Mode (Default)
* Type your search query (e.g. \`react hooks tutorial\`) or a direct URL (\`github.com\`, \`localhost:3000\`).
* **All browser profiles stay visible** so you never lose sight of your destinations while typing.
* Press **\`Enter\`** on any profile to immediately launch into that profile.

### 2. 🎯 Profile Filter Mode
* Press **\`Tab\`** to toggle into Profile Filter Mode.
* Your typed search query is **safely preserved** in memory!
* In this mode, typing filters the profile list in real-time by:
  * **Browser name** (\`chrome\`, \`edge\`, \`brave\`, \`vivaldi\`, \`firefox\`)
  * **Profile name** (\`Personal\`, \`Work\`, \`Default\`)
  * **Directory name** (\`Default\`, \`Profile 1\`, \`Profile 2\`)
  * **Account email** (\`work@company.com\`, \`personal@example.com\`)
* Press **\`Tab\`** again to switch back to Search Query Mode.

---

## 🌐 URL & Destination Routing

Search Router automatically detects and parses whatever you type:

| Input Type | Example | How Search Router Handles It |
| :--- | :--- | :--- |
| **Search Query** | \`best ergonomic mechanical keyboard\` | Encodes query and routes to your configured search engine |
| **Standard URL** | \`https://news.ycombinator.com\` | Opens destination directly without searching |
| **Bare Domain** | \`github.com/trending\` | Automatically prepends \`https://\` and opens |
| **Localhost & Ports** | \`localhost:3000\`, \`127.0.0.1:8080\` | Automatically prepends \`http://\` and opens local dev servers |
| **Windows File Path** | \`C:\\Users\\Username\\Documents\\page.html\` | Automatically converts to \`file:///\` URI and opens local document |
| **Internal Browser Pages** | \`chrome://extensions\`, \`edge://settings\` | Handled cleanly; falls back to a clean tab if restricted externally |

---

## ⌨️ Keyboard Shortcuts Cheat-Sheet

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| **\`Enter\`** | **Open in Profile** | Opens query or URL in the selected browser profile |
| **\`Ctrl + Enter\`** | **Open Incognito** | Launches selected profile in Incognito (Chrome/Brave) or InPrivate (Edge) |
| **\`Tab\`** | **Toggle Search / Filter** | Switches between Search Query Mode and Profile Filter Mode |
| **\`Ctrl + F\`** | **Toggle Favorite** | Pins or unpins the profile to the top "Favorites" section |
| **\`Ctrl + E\`** | **Rename Profile** | Sets a custom friendly nickname (e.g. *"Work - Research"*) |
| **\`Ctrl + N\`** | **Add Custom Profile** | Registers a portable browser or custom profile path |
| **\`Ctrl + H\`** | **User Manual** | Opens this comprehensive guide and shortcuts reference |
| **\`Ctrl + Shift + F\`** | **Send Feedback** | Opens the built-in Bug Report & Feature Request box |
| **\`Ctrl + Shift + X\`** | **Clear Query** | Quickly resets the active search query |
| **\`Ctrl + C\`** | **Copy Target URL** | Copies the generated search or destination URL to clipboard |
| **\`Ctrl + R\`** | **Refresh Profiles** | Re-scans Windows system for newly added browser profiles |
| **\`Ctrl + ,\`** | **Preferences** | Opens extension settings (Default Search Engine, Custom URL) |

---

## ⭐ Profile Management & Customization

### 📌 Pinning Favorites
Keep your daily drivers at the top:
* Highlight any profile and press **\`Ctrl + F\`** to pin it to **Favorites**.
* Press **\`Ctrl + F\`** again to unpin.

### ✏️ Custom Profile Nicknames
* Highlight a profile and press **\`Ctrl + E\`** (or choose *Rename Display Name* from actions).
* Type a custom display name (e.g. *"Work Workspace"* or *"Streaming Edge"*).
* Clear the text field and submit to revert to the default detected name.

### ➕ Adding Custom & Portable Browsers
If you use a portable browser, Canary/Beta build, or custom install folder:
* Press **\`Ctrl + N\`** (or choose *Add Custom Profile*).
* Provide the browser name, profile display name, and executable path (\`.exe\`).
* Custom profiles can be removed anytime with **\`Ctrl + Backspace\`**.

---

## ⚙️ Search Engine Preferences

Change your default search engine anytime in Extension Preferences (**\`Ctrl + ,\`**):
* **Google** (Default)
* **DuckDuckGo**
* **Bing**
* **Brave Search**
* **Perplexity AI**
* **Ecosia**
* **Custom Search Engine** (Enter custom URL with \`%s\`, e.g. \`https://kagi.com/search?q=%s\`)

---

## 🛡️ Authentic Profile Persistence on Windows

Unlike basic URL openers that launch temporary guest sessions, Search Router features **deep Windows profile detection**:
* Detects genuine user data directories for **Chrome, Microsoft Edge, Brave, Vivaldi, and Chromium**.
* Preserves all logins, cookies, extensions, and bookmarks across sessions.
* Seamlessly coordinates with already running browser windows without duplicate processes.

---

## 💬 Community & Direct Feedback

Found a bug or have an idea for a feature?
* Press **\`Ctrl + Shift + F\`** anywhere in Search Router.
* Submit a report directly to the development team via our automated relay.
`;

interface UserManualViewProps {
  onDismissFirstRun?: () => void;
  isFirstRun?: boolean;
}

export function UserManualView({ onDismissFirstRun, isFirstRun = false }: UserManualViewProps) {
  return (
    <Detail
      markdown={USER_MANUAL_MARKDOWN}
      actions={
        <ActionPanel>
          {isFirstRun && onDismissFirstRun ? (
            <Action
              title="Get Started (Go to Search Router)"
              icon={Icon.Checkmark}
              onAction={onDismissFirstRun}
            />
          ) : null}
          <Action.Push
            title="Send Feedback / Feature Request"
            icon={Icon.Envelope}
            shortcut={{ modifiers: ["ctrl", "shift"], key: "f" }}
            target={<FeedbackForm />}
          />
          <Action
            title="Open Extension Preferences"
            icon={Icon.Gear}
            shortcut={{ modifiers: ["ctrl"], key: "," }}
            onAction={openExtensionPreferences}
          />
          <Action.CopyToClipboard
            title="Copy User Manual"
            content={USER_MANUAL_MARKDOWN}
            shortcut={{ modifiers: ["ctrl"], key: "c" }}
          />
        </ActionPanel>
      }
    />
  );
}
