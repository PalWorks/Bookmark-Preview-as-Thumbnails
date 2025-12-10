import html2canvas from 'html2canvas';

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'CAPTURE_TAB') {
        captureTab()
            .then((dataUrl) => {
                sendResponse({ success: true, dataUrl });
            })
            .catch((error) => {
                console.error('Capture failed:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep the message channel open for async response
    }
});

async function captureTab(): Promise<string> {
    const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        logging: false,
        height: window.innerHeight,
        width: window.innerWidth,
        windowHeight: window.innerHeight,
        windowWidth: window.innerWidth,
    });

    return canvas.toDataURL('image/webp', 0.8);
}
