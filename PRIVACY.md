# Privacy Policy for BookmarksThumbnails

**Last Updated:** [Date]

## Data Collection and Usage

BookmarksThumbnails is designed with privacy as a core principle.

1.  **Local Storage:** All data captured by this extension (bookmark thumbnails and metadata) is stored locally on your device using IndexedDB and `chrome.storage.local`.
2.  **No Server Uploads:** This extension does not transmit any data to external servers. It operates entirely offline (except for loading the pages you visit to capture thumbnails).
3.  **File System Access:** If you choose to use the "Save to Disk" feature, the extension will write thumbnail files to the directory you explicitly select. It does not access any other files on your system.

## Permissions

-   **tabs / activeTab:** Required to capture the visible tab area to create thumbnails.
-   **storage:** Required to store thumbnail metadata and settings locally.
-   **downloads:** Required to export your thumbnails.

## Data Deletion

You can delete all stored data by:
1.  Uninstalling the extension.
2.  Using the "Delete" option within the extension (if implemented).
3.  Clearing your browser's "Hosted App Data".

## Contact

[Your Contact Information or Link to Repo Issues]
