const PAGE_TAB_PREFIX = '__page__:';

export const SETTINGS_TAB_PATH = `${PAGE_TAB_PREFIX}settings`;

export function isPageTabPath(path: string | undefined | null): boolean {
  if (!path) return false;
  return path.startsWith(PAGE_TAB_PREFIX);
}

export function isSettingsTabPath(path: string | undefined | null): boolean {
  return path === SETTINGS_TAB_PATH;
}
