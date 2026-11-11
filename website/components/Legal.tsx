// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react';

export const PrivacyPolicy: React.FC = () => (
  <div className="max-w-4xl mx-auto py-24 px-4">
    <h1 className="text-4xl font-bold text-slate-900 mb-8">Privacy Policy</h1>
    <div className="prose prose-slate max-w-none text-slate-600 space-y-6">
      <p>Last updated: 11 November 2026 (version 1.8.0)</p>

      <h3 className="text-xl font-bold text-slate-900">1. Overview</h3>
      <p>Visual Bookmark Manager with Thumbnail Previews ("the Extension") keeps your data on your device. We never receive your bookmarks, thumbnails or settings. From version 1.8.0 the Extension sends anonymous usage statistics, which you can turn off (section 4a). The other data that can leave your device is described in sections 3 to 5: what you send to a cloud AI provider you turn on yourself (including Ask AI), feedback you choose to send us, and bookmarks you choose to share with Claude, ChatGPT, another AI or a coding agent. If you turn on the Claude and ChatGPT connector, that data passes through a relay we run, which stores none of it.</p>

      <h3 className="text-xl font-bold text-slate-900">2. What the Extension stores on your device</h3>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>Thumbnails and metadata:</strong> screenshots of your bookmarked pages with their titles, status and timestamps, in Chrome's local extension storage.</li>
        <li><strong>Settings:</strong> your preferences (theme, capture delay and similar) in Chrome's sync storage, which Chrome syncs only across your own signed-in devices.</li>
        <li><strong>Optional disk folder:</strong> if you connect a folder, thumbnails are also written to the folder you chose. No other files are accessed.</li>
        <li><strong>Trash:</strong> when a bookmark or folder is deleted, a copy of its titles, links, folder location and dates is kept locally for 30 days so you can restore it. This includes deletes made outside the Extension while Chrome is open on this computer; you can turn that off in the Trash view. Emptying Trash, or the 30 days passing, removes the copy.</li>
        <li><strong>Your organisation:</strong> tags, ratings, folder colours, folders hidden from search, and when you last opened a bookmark from the Extension. These are included in backups you export.</li>
        <li><strong>Site icons:</strong> read from Chrome's own local favicon cache. No request goes to the site or to us.</li>
        <li><strong>AI API key (optional):</strong> stored locally and obfuscated at rest, sent only to the provider you entered it for, and never included in backups or settings exports.</li>
      </ul>

      <h3 className="text-xl font-bold text-slate-900">3. Optional AI features (what can leave your device)</h3>
      <p>Auto-Tag and Smart Search are optional. By default they use Chrome's built-in Gemini Nano, which runs on your device and sends nothing anywhere. Duplicate Finder never uses AI and always runs on your device.</p>
      <p>If you choose a cloud provider (for example OpenAI, Anthropic, Google Gemini, Groq or Mistral) or a local server (Ollama, LM Studio), the Extension sends to that provider only, under your own API key:</p>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>Auto-Tag:</strong> each bookmark's title, domain and URL path.</li>
        <li><strong>Smart Search:</strong> the titles and URLs of bookmarks in the folder you search, plus your query.</li>
      </ul>
      <p>No page contents, browsing history or cookies are sent. The provider handles that data under its own privacy policy. We never receive, store or sell it.</p>

      <h3 className="text-xl font-bold text-slate-900">4. Feedback you send (optional, from version 1.6.0)</h3>
      <p>Settings, Submit Feedback opens a form inside the Extension. Nothing is sent until you press Send feedback. Then it goes to our feedback relay (a Cloudflare Worker we run at bookmarks-feedback.palworks.ai; 1.6.0 and 1.7.0 reach the same Worker at its workers.dev address), which emails it to support@palworks.ai through our email provider, Resend. It contains:</p>
      <ul className="list-disc pl-5 space-y-2">
        <li>the topic you picked and the message you typed;</li>
        <li>your email address, only if you typed one, so we can reply;</li>
        <li>unless you untick "Include technical details": the Extension version, browser build and operating system, how many bookmarks and folders you have, and whether you use grid or list view. No bookmark titles, links, folder names or tags.</li>
      </ul>
      <p>The relay stores no message content. To limit abuse it keeps short-lived counters per network, named by a keyed one-way hash of the network address and never the address itself, which expire within 26 hours. We use what you send only to answer you and improve the Extension, and never sell it. To have a message deleted, write to support@palworks.ai.</p>

      <h3 className="text-xl font-bold text-slate-900">4a. Usage statistics (on by default from version 1.8.0; you can turn them off)</h3>
      <p>To learn which features people use, the Extension sends anonymous usage statistics to our relay at bookmarks-feedback.palworks.ai, which passes them to Google Analytics and PostHog. Turn them off at any time in Settings, Share Usage Statistics; nothing more is sent after that, and nothing is ever sent from an Incognito window.</p>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>Sent:</strong> a random install id made by the Extension (not linked to your Google account or email), a session number, the Extension version, which features you use (for example previews generated, with the number in a range; a message sent to Ask AI, with the provider type; a change undone; the connector turned on), and your country. Your IP address is not passed on.</li>
        <li><strong>Never sent:</strong> links, page or bookmark titles, folder names, tags, search text, Ask AI messages or replies, API keys, or anything from the pages you visit. The relay drops anything other than numbers, on/off values and short words.</li>
        <li>The relay stores nothing. Google Analytics and PostHog keep the statistics under their own policies. We use them only to improve the Extension and never sell them. To have the statistics for your install id deleted, write to support@palworks.ai.</li>
      </ul>

      <h3 className="text-xl font-bold text-slate-900">5. Ask AI, Claude and ChatGPT, and coding agents (optional, from version 1.7.0)</h3>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>Ask AI:</strong> your chats are kept on your device only (up to 50) until you delete them; they are never synced, backed up or sent to us. When you send a message in Ask AI, the Extension sends your message, the folder you have open in the side panel (unless you turn that off), and what the AI asks to read (bookmark and folder titles, links, folder paths, tags, ratings and last-opened times, from every folder except those hidden from search) to the provider you chose in AI Settings only, under your own key. The panel names that provider and model. We never receive it.</li>
        <li><strong>Claude and ChatGPT:</strong> if you turn on "Let Claude and ChatGPT organise my bookmarks", the Extension keeps a connection to our relay (a Cloudflare Worker we run at bookmarks-connector.palworks.ai; 1.7.0 reaches the same Worker at its workers.dev address) while Chrome is open. When you ask Claude or ChatGPT about your bookmarks, the request and your browser's answer (titles, links, folder paths, tags and ratings from the folders you chose) pass through the relay. The relay stores none of it and does not log it; it keeps only a one-way hash of your link's secret, one-time sign-in codes for at most 2 minutes, and short-lived counters named by a keyed one-way hash of the network address. Anthropic and OpenAI handle what they receive under their own policies. You choose the folders and whether the app may read only, suggest changes for you to review, or change with Undo; removing a connection or switching off stops it.</li>
        <li><strong>Changes an AI makes</strong> apply at once unless you chose review first, and you can undo them with one click. Removed bookmarks go to the Extension's Trash.</li>
        <li><strong>Copy and paste:</strong> you tick the folders to share (none are ticked at first). The Extension builds a text of their titles, links, tags and ratings that you copy or save, and you choose which AI receives it; that AI's provider handles it under its own policy. You can remove the part of links after "?". Folders hidden from search are never included. The Extension itself sends nothing.</li>
        <li><strong>Coding agents:</strong> if you turn on Connect coding agents (menu, AI Tools, Connect Claude or ChatGPT, Coding agents on this computer; in 1.7.0 the Connect Claude or ChatGPT page is in the menu itself), Chrome asks for the optional permission to communicate with a helper program on your computer. Agents you pair with a 6-digit code shown only in the Extension can read just the folders you tick for them, and may pass what they read to the AI service they use. You choose whether each may read only, suggest changes for you to review, or change with Undo.</li>
        <li>Change sets and the record that lets you undo them stay on your device for 30 days and are not included in backups, and neither are your connections or the connector address.</li>
      </ul>

      <h3 className="text-xl font-bold text-slate-900">6. Permissions</h3>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>bookmarks:</strong> read and organise your bookmarks.</li>
        <li><strong>tabs, activeTab, scripting, webNavigation:</strong> load and capture your bookmarked pages to make thumbnails.</li>
        <li><strong>storage, unlimitedStorage:</strong> keep thumbnails, Trash and settings on your device.</li>
        <li><strong>favicon:</strong> show a site's icon from Chrome's local cache when a bookmark has no thumbnail yet.</li>
        <li><strong>alarms:</strong> run a daily local clean-up that removes Trash items older than 30 days.</li>
        <li><strong>history (optional):</strong> requested only when you turn on the Visits or Last visited column in list view. It reads the visit count and last visit of the bookmarks on screen, on your device, and stores nothing. Turning the columns off gives the permission back.</li>
        <li><strong>nativeMessaging (optional):</strong> requested only when you turn on Connect coding agents, to talk to the helper program you installed. Turning the switch off gives it back.</li>
        <li><strong>Access to all sites:</strong> capture screenshots of any site you have bookmarked and, only if you turn on cloud AI or use Ask AI, reach your chosen provider. The Claude and ChatGPT connector needs no extra permission.</li>
      </ul>

      <h3 className="text-xl font-bold text-slate-900">7. Deleting your data</h3>
      <p>Empty Trash to remove deleted items at once, clear your API key in Provider Settings (AI Tools; AI Settings in 1.7.0 and earlier), or uninstall the Extension to remove all of its local data.</p>

      <h3 className="text-xl font-bold text-slate-900">8. Contact</h3>
      <p>Questions: support@palworks.ai, or open an issue at github.com/PalWorks/Bookmark-Preview-as-Thumbnails.</p>
    </div>
  </div>
);

export const TermsAndConditions: React.FC = () => (
  <div className="max-w-4xl mx-auto py-24 px-4">
    <h1 className="text-4xl font-bold text-slate-900 mb-8">Terms & Conditions</h1>
    <div className="prose prose-slate max-w-none text-slate-600 space-y-6">
      <p>By installing and using the Bookmarks as Thumbnails extension, you agree to the following terms:</p>

      <h3 className="text-xl font-bold text-slate-900">1. Usage License</h3>
      <p>This software is dual-licensed:</p>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>Open source:</strong> You may use, change and share this software under the GNU Affero General Public License, version 3 only (AGPL-3.0). The AGPL allows any use, including commercial use, provided you meet its conditions, such as publishing the source code of versions you distribute or offer over a network.</li>
        <li><strong>Commercial:</strong> To use this software without the AGPL obligations, for example in a closed-source product, a paid commercial license is available. See COMMERCIAL-LICENSE.md in the GitHub repository.</li>
      </ul>

      <h3 className="text-xl font-bold text-slate-900">2. Disclaimer of Warranty</h3>
      <p>The Extension is provided "AS IS" without warranty of any kind. We make no guarantees that the software will be error-free, uninterrupted, or compatible with all systems. We are not responsible for any data loss associated with the use of this software (though we provide backup tools to mitigate this risk).</p>

      <h3 className="text-xl font-bold text-slate-900">3. Changes to Terms</h3>
      <p>We reserve the right to modify these terms at any time. Significant changes will be communicated via our changelog.</p>
    </div>
  </div>
);

export const GetInTouch: React.FC = () => (
  <div className="max-w-2xl mx-auto py-24 px-4 text-center">
    <h1 className="text-4xl font-bold text-slate-900 mb-6">Get in Touch</h1>
    <p className="text-lg text-slate-600 mb-10">
      Have a feature request, found a bug, or just want to say hi? We'd love to hear from you.
    </p>

    <div className="bg-slate-50 p-8 rounded-2xl border border-slate-200">
      <p className="font-medium text-slate-900 mb-2">Support Email</p>
      <a href="mailto:support@palworks.ai" className="text-2xl font-bold text-brand-600 hover:text-brand-700 transition-colors">
        support@palworks.ai
      </a>

      <div className="my-8 h-px bg-slate-200 w-full" />

      <p className="font-medium text-slate-900 mb-2">Social</p>
      <div className="flex justify-center gap-4">
        <a href="#" className="text-slate-500 hover:text-brand-600">Twitter / X</a>
        <span className="text-slate-300">•</span>
        <a href="#" className="text-slate-500 hover:text-brand-600">GitHub Issues</a>
      </div>
    </div>
  </div>
);