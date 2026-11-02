import { useCallback, useState } from "react";
import { readStored, removeStored, writeStored } from "../../../storage";

export type ThemeChoice = "system" | "dark" | "light";
const KEY = "comfy.theme";

function readChoice(): ThemeChoice {
  return (
    readStored<ThemeChoice>(KEY, (raw) => (raw === "dark" || raw === "light" ? raw : undefined)) ??
    "system"
  );
}

function applyTheme(choice: ThemeChoice): void {
  if (choice === "system") {
    delete document.documentElement.dataset.theme;
    removeStored(KEY);
    return;
  }
  document.documentElement.dataset.theme = choice;
  writeStored(KEY, choice);
}

export function useTheme(): { theme: ThemeChoice; setTheme: (choice: ThemeChoice) => void } {
  const [theme, setThemeState] = useState<ThemeChoice>(readChoice);
  const setTheme = useCallback((choice: ThemeChoice) => {
    applyTheme(choice);
    setThemeState(choice);
  }, []);
  return { theme, setTheme };
}
