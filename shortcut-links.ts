const SHORTCUT_APP_HOST = "app.shortcut.com";
const SHORTCUT_STORY_PATH = /^\/[^/]+\/story\/(\d+)(?:\/|$)/i;

export function shortcutStoryIdFromUrl(value: string): number | null {
  try {
    const url = new URL(value, "https://bb.local");
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.hostname.toLowerCase() !== SHORTCUT_APP_HOST) return null;

    const match = url.pathname.match(SHORTCUT_STORY_PATH);
    if (!match) return null;

    const id = Number(match[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function shortcutStoryPluginPath(pluginId: string, storyId: number): string {
  return `/plugins/${encodeURIComponent(pluginId)}/stories/${storyId}`;
}
