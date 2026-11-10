// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Only this extension's own pages may talk to the worker. The capture content script never
 * sends messages (the worker messages it), so a web page's process, even a compromised one,
 * cannot start captures, spend the user's AI credit or write metadata through us
 * (security review 2026-11-10, F5). There is no externally_connectable, so other extensions
 * and sites cannot reach onMessage at all.
 */
export function isOwnPage(sender: chrome.runtime.MessageSender): boolean {
    return sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(''));
}
