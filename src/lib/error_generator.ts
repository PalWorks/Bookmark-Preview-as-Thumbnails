
export async function generateErrorImage(error: string, url: string): Promise<string> {
    const width = 600;
    const height = 400;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');

    if (!ctx) throw new Error('Failed to get canvas context');

    // Background
    ctx.fillStyle = '#f8f9fa'; // Light gray like Chrome error page
    ctx.fillRect(0, 0, width, height);

    // Icon (Sad Face / File) - Simplified representation
    ctx.fillStyle = '#9aa0a6';
    ctx.font = '48px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(':(', width / 2, height / 2 - 40);

    // Error Title
    ctx.fillStyle = '#202124';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('This site can\'t be reached', width / 2, height / 2 + 10);

    // Error Details
    ctx.fillStyle = '#5f6368';
    ctx.font = '16px sans-serif';
    ctx.fillText(error || 'ERR_CONNECTION_FAILED', width / 2, height / 2 + 40);

    // URL
    ctx.font = 'italic 14px sans-serif';
    ctx.fillStyle = '#5f6368';
    const maxUrlWidth = width - 40;
    let displayUrl = url;
    if (ctx.measureText(displayUrl).width > maxUrlWidth) {
        displayUrl = displayUrl.substring(0, 50) + '...';
    }
    ctx.fillText(displayUrl, width / 2, height / 2 + 70);

    // Convert to Blob/DataURL
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
    });
}
