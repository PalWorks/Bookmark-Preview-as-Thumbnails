# Chrome Web Store Privacy Details

Use the following information to fill out the "Privacy" tab in the Developer Dashboard.

## 1. Single Purpose

**Description:**
> To provide a visual preview of bookmarks as thumbnails, making it easier for users to recognize and organize their saved pages.

## 2. Permission Justifications

| Permission | Justification |
| :--- | :--- |
| **storage** | Required to store the generated thumbnail images and user preferences locally on the device. |
| **tabs** | Required to access the current tab's content to capture a screenshot for the thumbnail preview. |
| **activeTab** | Required to capture the visible area of the currently active tab when the user manually triggers a preview generation. |
| **downloads** | Required to allow users to export their backup data (thumbnails and settings) as a JSON file. |
| **bookmarks** | Required to read the user's bookmarks to display them in the extension's interface and associate thumbnails with specific bookmark URLs. |
| **scripting** | Required to inject content scripts into background tabs to capture their visible area, as standard capture methods only work for the active tab. |
| **management** | Required to provide the "Uninstall Extension" functionality directly from the extension's settings interface. |
| **unlimitedStorage** | Required to store a large number of thumbnail images locally without hitting the standard storage quota limits. |
| **webNavigation** | Required to detect when a page has finished loading during the batch capture process to ensure the thumbnail captures the fully rendered page. |
| **Host Permissions**<br>(`<all_urls>`) | Required to capture screenshots of any website the user has bookmarked, regardless of the domain. |

## 3. Remote Code

**Are you using remote code?**
> **NO**
> *(Note: Your screenshot showed "Yes", but your extension does NOT use remote code. Please select "No" to avoid rejection.)*

## 4. Data Usage

**What user data do you plan to collect?**
Select the following:

- [x] **Website content** (Because you capture screenshots of pages)

**Certifications:**

- [x] **I do not sell or transfer user data to third parties...**
- [x] **I do not use or transfer user data for purposes that are unrelated...**
- [x] **I do not use or transfer user data to determine creditworthiness...**

## 5. Privacy Policy

**Privacy Policy URL:**
> `https://palworks.github.io/Bookmark-Preview-as-Thumbnails/#privacy`
