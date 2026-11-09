export type ColorTheme = "light" | "dark";

export const colorThemeStorageKey = "gm-manager-color-theme-v1";

export function readColorTheme(): ColorTheme {
  try {
    return window.localStorage.getItem(colorThemeStorageKey) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyColorTheme(theme: ColorTheme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#292a2d" : "#ffffff");
}
