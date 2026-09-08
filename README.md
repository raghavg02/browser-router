# Search Router

Route search queries and URLs directly to your preferred browser and profile on Windows.

Raycast typically defaults to opening links and searches in your system's default browser. **Search Router** solves this by automatically discovering all installed Windows browsers and their individual user profiles, letting you choose exactly where your query or URL should open.

---

## Features

- 🔍 **Smart URL vs. Query Routing:** Automatically distinguishes between URLs (e.g., `github.com`, `localhost:3000`, `https://...`) and search terms. URLs are opened directly in the address bar, while search queries are formatted with your configured search engine.
- 👥 **Deep Profile Auto-Detection:** Automatically scans and detects user profiles for:
  - **Google Chrome** (including custom profile names, accounts, and profile pictures)
  - **Microsoft Edge**
  - **Brave Browser**
  - **Vivaldi**
  - **Arc for Windows**
  - **Mozilla Firefox**
  - **Opera & Opera GX**
- ⚡ **Fallback Command Ready:** Set Search Router as a Raycast Fallback Command to instantly route queries when root search has no matches.
- ⌨️ **Argument Flow:** Type `search router` in Raycast root search, press `Tab`, type your query, and press `Enter` to jump straight to your profile list.
- 🎨 **Real Windows Browser Logos & Profile Avatars:** Extracts native high-resolution browser logos and Google Profile pictures directly from your disk, with vector SVG fallbacks.
- ⭐ **Favorites & Pinning:** Pin your most frequently used profiles to the top (`Ctrl+F`).
- 📁 **Custom Profile & Folder Support:** Easily add portable or custom profile directories if your browser setup is non-standard.
- ⚙️ **Configurable Search Engines:** Choose between Google, DuckDuckGo, Bing, Brave Search, Perplexity, Ecosia, or specify your own custom search URL template.

---

## How to Use

### Method 1: Root Search with Argument
1. Open Raycast and type `search router`.
2. Press `Tab` to focus the search argument.
3. Type your search query or URL (e.g., `github.com` or `react hooks guide`).
4. Press `Enter` to open the profile picker.
5. Choose your desired browser & profile:
   - Type the name of the browser or profile (e.g., `Work`, `Chrome`, `Brave`) and press `Enter`.
   - Use the **Up/Down** arrow keys and press `Enter`.
   - Click on the item from the list.

### Method 2: Raycast Fallback Command
1. In Raycast, go to **Settings > Extensions > Search Router**.
2. Add **Search Router** to your **Fallback Commands** (or click the settings gear next to "Fallback Commands" in root search).
3. Type any search query or URL into Raycast root search.
4. Select **Search Router** from the fallback results.
5. Pick your browser profile and press `Enter`.

### Method 3: Direct Launch
Open **Search Router** directly. Type your query into the search bar, then click or press `Enter` on any profile to launch it. If left blank, it simply opens that browser profile to a new tab.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Enter` | Open in selected Browser & Profile |
| `Ctrl + F` | Toggle Favorite (pins to top) |
| `Ctrl + C` | Copy generated destination URL |
| `Ctrl + N` | Add Custom Profile / Folder |
| `Ctrl + R` | Refresh browser & profile list |
| `Ctrl + ,` | Open Extension Preferences |

---

## Preferences

- **Default Search Engine:** Select your preferred engine (Google, DuckDuckGo, Bing, Brave, Perplexity, Ecosia, or Custom).
- **Custom Search URL:** Specify a custom search URL containing `%s` (e.g., `https://kagi.com/search?q=%s`).

---

## License

MIT
