// SPDX-License-Identifier: AGPL-3.0-only
// html2canvas-pro: a maintained fork of html2canvas (same API) that understands modern CSS
// colour functions such as color(), oklch() and lab(), which html2canvas 1.4 rejects.
import html2canvas from 'html2canvas-pro';

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'CAPTURE_TAB') {
        captureTab()
            .then((dataUrl) => {
                sendResponse({ success: true, dataUrl });
            })
            .catch((error) => {
                // Expected on some sites; the worker falls back to a screenshot. A warning,
                // not an error, so the extension's Errors page shows only real faults.
                console.warn('Capture failed:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep the message channel open for async response
    }
});

async function captureTab(): Promise<string> {
    const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: false, // false prevents security errors on cross-origin images
        logging: false,
        height: window.innerHeight,
        width: window.innerWidth,
        windowHeight: window.innerHeight,
        windowWidth: window.innerWidth,
        // The page is copied into a hidden frame; its scripts must not come along.
        // Chrome blocks them anyway (extension CSP) and logs each block as an error.
        ignoreElements: (el) => el.tagName === 'SCRIPT' || el.tagName === 'NOSCRIPT',
    });
    return canvas.toDataURL('image/webp', 0.8);
}
