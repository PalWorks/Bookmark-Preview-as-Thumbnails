# Bookmarks Thumbnails

**Bookmarks Thumbnails** is a Chrome extension that transforms your standard bookmarks into a visually appealing, Safari-style grid of thumbnails. It provides a modern and intuitive way to browse and manage your saved sites.

## Features

- **Visual Previews**: Automatically generates thumbnail previews for your bookmarks.
- **Grid Layout**: Displays bookmarks in a responsive, easy-to-scan grid.
- **Folder Navigation**: Navigate through your bookmark folders seamlessly.
- **Search**: Quickly find bookmarks by title or URL.
- **Drag & Drop**: Reorder bookmarks and move them between folders (Planned/In-Progress).
- **Dark Mode**: Supports system dark mode preference.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Styling**: Vanilla CSS (with some utility classes)
- **Icons**: Lucide React
- **Extension API**: Chrome Extension Manifest V3
- **Testing**: Vitest, React Testing Library

## Installation

### From Source

1. Clone the repository:

    ```bash
    git clone https://github.com/yourusername/bookmarks-thumbnails.git
    cd bookmarks-thumbnails
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. Build the extension:

    ```bash
    npm run build
    ```

4. Load into Chrome:
    - Open Chrome and navigate to `chrome://extensions`.
    - Enable "Developer mode" in the top right corner.
    - Click "Load unpacked".
    - Select the `dist` directory created in the previous step.

## Usage

1. Click the extension icon in the Chrome toolbar.
2. Grant necessary permissions if prompted (e.g., reading bookmarks).
3. Browse your bookmarks in the new visual grid.
4. Click on a thumbnail to open the site.

## Website

The project includes a companion website located in the `website` directory.

### Running the Website Locally

1. Navigate to the website directory:

    ```bash
    cd website
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. Start the development server:

    ```bash
    npm run dev
    ```

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository.
2. Create a new branch (`git checkout -b feature/amazing-feature`).
3. Make your changes.
4. Commit your changes (`git commit -m 'Add some amazing feature'`).
5. Push to the branch (`git push origin feature/amazing-feature`).
6. Open a Pull Request.

## License

Distributed under the AGPL-3.0 License. See `LICENSE` for more information.
