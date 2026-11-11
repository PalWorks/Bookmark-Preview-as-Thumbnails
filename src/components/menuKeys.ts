// SPDX-License-Identifier: AGPL-3.0-only
//
// Keyboard support for the top bar's menus (Settings, Filter, Sort), the same keys as the
// context menu: Arrow Up and Down move between items, Home and End jump, Escape closes and
// returns focus to the button that opened the menu.

const ITEMS = '[role^="menuitem"]:not([disabled])';

/** Focus the checked item, else the first one, when a menu opens. */
export function focusMenu(menu: HTMLElement | null): void {
    if (!menu) return;
    const checked = menu.querySelector<HTMLElement>(`${ITEMS}[aria-checked="true"][role="menuitemradio"]`);
    (checked ?? menu.querySelector<HTMLElement>(ITEMS))?.focus({ preventScroll: true });
}

/** onKeyDown for a menu container. Returns true when it handled the key. */
export function menuKeyDown(e: React.KeyboardEvent<HTMLElement>, close: () => void, trigger: HTMLElement | null | undefined): boolean {
    // Fields inside a menu (the capture delay slider) keep their own arrow keys.
    const t = e.target as HTMLElement;
    if (e.altKey || e.ctrlKey || e.metaKey) return false;
    if (e.key !== 'Escape' && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return false;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (n: number) => items[(n + items.length) % items.length]?.focus();
    switch (e.key) {
        case 'ArrowDown': e.preventDefault(); focusAt(i + 1); return true;
        case 'ArrowUp': e.preventDefault(); focusAt(i < 0 ? items.length - 1 : i - 1); return true;
        case 'Home': e.preventDefault(); focusAt(0); return true;
        case 'End': e.preventDefault(); focusAt(items.length - 1); return true;
        case 'Escape':
            e.preventDefault();
            e.stopPropagation();
            close();
            trigger?.focus();
            return true;
    }
    return false;
}
