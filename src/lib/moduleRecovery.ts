const RELOAD_KEY = "app_module_reload_attempted";
export function isModuleLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading (?:CSS )?chunk|error loading dynamically imported module/i.test(message);
}
export function recoverModuleLoad(error: unknown): boolean {
  if (!isModuleLoadError(error) || !navigator.onLine) return false;
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return false;
    sessionStorage.setItem(RELOAD_KEY, "1");
  } catch { return false; }
  window.location.reload();
  return true;
}
