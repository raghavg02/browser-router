# Search Router — Final Pre-Publish Roadmap



This document outlines the architecture, specifications, and step-by-step checklist for the **final two features** before moving to the Raycast Store publish phase:

1. **User Manual (First-Run & On-Demand Guide)**

2. **Feedback & Feature Requests Box (Complaints & Suggestions)**



---



## 1. Feature 1: User Manual



### 1.1 First-Run (One-Time) Onboarding Experience

* **Requirement**: When a user freshly installs Search Router and opens it for the very first time, the User Manual appears automatically to introduce them to the extension.

* **Persistence & Logic**:

  * Utilize Raycast's `LocalStorage` API to track user onboarding status (`hasSeenUserManual`).

  * On initial launch (`loadProfiles` in `src/search-router.tsx`), check `await LocalStorage.getItem<boolean>("hasSeenUserManual")`.

  * If `false` or `undefined`, automatically push/render `UserManualView`.

  * When the user clicks **"Got it / Start Searching"** or dismisses the view, set `await LocalStorage.setItem("hasSeenUserManual", true)`.

  * On all subsequent launches, Search Router opens directly into the main search list without interruption.



### 1.2 Permanent Action Panel Access

* **Requirement**: Kept accessible at all times from the main search list.

* **Action Item**:

  * Add a permanent **"View User Manual"** item to the Raycast `ActionPanel` on every profile item.

  * Shortcut: `<kbd>Ctrl</kbd> + <kbd>H</kbd>`.

  * Selecting the action pushes `UserManualView` using Raycast's `Action.Push`.



### 1.3 Privacy & Cleanliness Safeguards (Zero Personal Data)

* **Requirement**: Strictly zero developer or personal user information in the manual or source code.

* **Standards**:

  * **No Personal Paths**: Never include personal directories; use generic placeholders like `C:\Users\username\Documents\file.html`.

  * **No Personal Emails**: Never include real email addresses; use `user@example.com` or `work@company.com`.

  * **Generic Profile Names**: Use examples like `Work`, `Personal`, `School`, `Default`.



### 1.4 User Manual Content Structure

The manual is rendered via Raycast's `<Detail markdown={...} />` component with clear typography, tables, and shortcut badges:

1. **Overview**: What Search Router is and how it routes queries and URLs.

2. **Supported Browsers & Engine Families**:

   * **Chromium (Blink)**: Chrome, Edge, Brave, Vivaldi, Arc, Opera (Auto-detected). Custom support for Thorium, Ungoogled Chromium, Cromite, Yandex, etc.

   * **Gecko (Mozilla)**: Firefox (Auto-detected via `profiles.ini`). Custom support for Zen Browser, LibreWolf, Waterfox, Floorp, Tor Browser.

   * **WebKit & Universal Executables**: Universal support for any `.exe` application on Windows.

   * **Coverage Tier Table**: Tier 1 (Auto-Detect), Tier 2 (Power-User Forks via `Ctrl + N`), Tier 3 (Universal Executables).

3. **Dual-Mode Search System**:

   * *Search Query Mode (Default)*: Type query or direct URL with all profiles visible.

   * *Profile Filter Mode (`Tab` Toggle)*: Filter profiles by name, browser, directory, or email without losing typed query.

4. **Smart URL & Destination Routing**:

   * Queries, direct URLs (`https://`), bare domains (`domain.com`), localhost/ports (`localhost:3000`), local files (`C:\...` -> `file:///`), and internal URLs (`chrome://`, `about:blank`).

5. **Keyboard Shortcuts Cheat-Sheet**:

   * Table of all keybindings (`Enter`, `Ctrl + Enter`, `Tab`, `Ctrl + X`, `Ctrl + F`, `Ctrl + E`, `Ctrl + N`, `Ctrl + H`, etc.).

6. **Profile Management**:

   * Favorites pinning, Nicknames, and Custom Profiles.

7. **Search Engine Preferences**:

   * Selecting default engines or setting custom `%s` URLs.

8. **Feedback Link**: Direct action button to open the Feedback & Feature Request form.



---



## 2. Feature 2: Feedback & Feature Requests Box



### 2.1 Purpose & User Experience

* Gives users a direct, frictionless channel inside Raycast to:

  1. **Report bugs / submit complaints** (e.g. browser detection issues, launch problems).

  2. **Submit feature requests & suggestions** (e.g. new browser requests, keyboard shortcut ideas, search engine presets).

* Accessible anytime from the Action Panel (`Ctrl + Shift + F` or selecting **"Send Feedback / Feature Request"**) and linked from the User Manual footer.



### 2.2 Form Component Design (`FeedbackForm.tsx`)

A clean Raycast `<Form>` with the following fields:

* **Feedback Category** (`Form.Dropdown`):

  * `Bug Report / Complaint`

  * `Feature Request / Suggestion`

  * `General Feedback`

* **Title / Summary** (`Form.TextField`):

  * Placeholder: e.g. "Add auto-detection for Zen Browser" or "Profile picture not updating".

* **Details & Description** (`Form.TextArea`):

  * Placeholder: "Describe the issue or the feature you'd like to see in future updates..."

* **Contact Email (Optional)** (`Form.TextField`):

  * Placeholder: "Optional — if you'd like us to reply back".



### 2.3 Submission & Delivery Architecture

We provide two seamless submission options:

* **Method A: GitHub Issue Pre-Fill (Standard for Open Source Raycast Extensions)**:

  * When submitted, Raycast constructs an encoded GitHub Issue URL:

    `https://github.com/kanha01945/search-router/issues/new?title=[Category]...&body=...`

  * Automatically opens the browser to your repository's issues page with title, body, and labels already filled in!

  * **Benefit**: 100% free, zero backend needed, transparent public tracking for community users.

* **Method B: Webhook / Form Endpoint (Optional Direct In-App)**:

  * If the user doesn't have a GitHub account, a secondary action allows sending the form directly to a free endpoint (like Formspree, Discord webhook, or Google Form) without leaving Raycast.



---



## 3. Step-by-Step Implementation Plan



- [ ] **Step 1: Build `UserManualView.tsx` Component**

  - Complete `<Detail />` component with all sections, browser engine coverage table, dual-mode explanation, and shortcuts cheat-sheet.

  - Action to dismiss ("Start Searching"), open preferences, or open the Feedback form.

  - Zero hardcoded personal information.



- [ ] **Step 2: Add First-Run Onboarding in `src/search-router.tsx`**

  - Check `LocalStorage.getItem("hasSeenUserManual")` on startup.

  - Automatically show User Manual on the first launch of a new install.

  - Save `hasSeenUserManual: true` once dismissed.

  - Add permanent ActionPanel entry ("View User Manual", `Ctrl + H`).



- [ ] **Step 3: Build `FeedbackForm.tsx` Component**

  - Create the native Raycast `<Form>` with Category dropdown (Bug/Complaint vs Feature Request), Title, Details, and optional Email.

  - Implement submission handler (pre-filling GitHub Issue with markdown template).



- [ ] **Step 4: Integrate Feedback Action in `src/search-router.tsx` & `UserManualView.tsx`**

  - Add "Send Feedback / Feature Request" action to the main search list ActionPanel.

  - Add "Send Feedback" action to the User Manual ActionPanel.



- [ ] **Step 5: Pre-Release Audit & Verification**

  - Scan the entire codebase for personal paths (`user`), emails, or leftover test files.

  - Verify `npm run lint` and `npm run build` pass cleanly.

  - Prepare for Raycast Store publication (`README.md`, `CHANGELOG.md`).

