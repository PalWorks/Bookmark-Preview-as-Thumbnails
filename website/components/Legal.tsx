// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react';

export const PrivacyPolicy: React.FC = () => (
  <div className="max-w-4xl mx-auto py-24 px-4">
    <h1 className="text-4xl font-bold text-slate-900 mb-8">Privacy Policy</h1>
    <div className="prose prose-slate max-w-none text-slate-600 space-y-6">
      <p>Last updated: 9 November 2026 (version 1.6.0)</p>

      <h3 className="text-xl font-bold text-slate-900">1. Overview</h3>
      <p>Visual Bookmark Manager with Thumbnail Previews ("the Extension") keeps your data on your device. We use no analytics or telemetry and never receive your bookmarks, thumbnails or settings. The only data that can leave your device is described in sections 3 and 4: what you send to a cloud AI provider you turn on yourself, and feedback you choose to send us.</p>

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
      <p>Settings, Submit Feedback opens a form inside the Extension. Nothing is sent until you press Send feedback. Then it goes to our feedback relay (a Cloudflare Worker we run), which emails it to support@palworks.ai through our email provider, Resend. It contains:</p>
      <ul className="list-disc pl-5 space-y-2">
        <li>the topic you picked and the message you typed;</li>
        <li>your email address, only if you typed one, so we can reply;</li>
        <li>unless you untick "Include technical details": the Extension version, browser build and operating system, how many bookmarks and folders you have, and whether you use grid or list view. No bookmark titles, links, folder names or tags.</li>
      </ul>
      <p>The relay stores no message content. To limit abuse it keeps short-lived counters per network, named by a keyed one-way hash of the network address and never the address itself, which expire within 26 hours. We use what you send only to answer you and improve the Extension, and never sell it. To have a message deleted, write to support@palworks.ai.</p>

      <h3 className="text-xl font-bold text-slate-900">5. Permissions</h3>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>bookmarks:</strong> read and organise your bookmarks.</li>
        <li><strong>tabs, activeTab, scripting, webNavigation:</strong> load and capture your bookmarked pages to make thumbnails.</li>
        <li><strong>storage, unlimitedStorage:</strong> keep thumbnails, Trash and settings on your device.</li>
        <li><strong>favicon:</strong> show a site's icon from Chrome's local cache when a bookmark has no thumbnail yet.</li>
        <li><strong>alarms:</strong> run a daily local clean-up that removes Trash items older than 30 days.</li>
        <li><strong>history (optional):</strong> requested only when you turn on the Visits or Last visited column in list view. It reads the visit count and last visit of the bookmarks on screen, on your device, and stores nothing. Turning the columns off gives the permission back.</li>
        <li><strong>Access to all sites:</strong> capture screenshots of any site you have bookmarked and, only if you turn on cloud AI, reach your chosen provider.</li>
      </ul>

      <h3 className="text-xl font-bold text-slate-900">6. Deleting your data</h3>
      <p>Empty Trash to remove deleted items at once, clear your API key in AI Settings, or uninstall the Extension to remove all of its local data.</p>

      <h3 className="text-xl font-bold text-slate-900">7. Contact</h3>
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