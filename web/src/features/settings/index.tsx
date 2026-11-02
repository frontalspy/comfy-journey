import { useQueryClient } from "@tanstack/react-query";
import { comfyApi } from "../../api/comfyApi";
import { readStored, removeStored } from "../../storage";
import { SESSION_FLAG, useViewer } from "../auth";
import { useSaveSettings, useSettings } from "./hooks/useSettings";
import { type ThemeChoice, useTheme } from "./hooks/useTheme";

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

export function SettingsScreen() {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const save = useSaveSettings();
  const viewer = useViewer();
  const queryClient = useQueryClient();
  const signedInHere = readStored(SESSION_FLAG, (raw) => raw === true) === true;

  async function signOut(): Promise<void> {
    await comfyApi.logout().catch(() => undefined);
    removeStored(SESSION_FLAG);
    queryClient.clear();
    window.location.assign("/");
  }

  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <section className="card" aria-labelledby="appearance">
        <h2 id="appearance" style={{ fontSize: 16 }}>
          Appearance
        </h2>
        <fieldset className="seg" aria-label="Theme" style={{ alignSelf: "flex-start" }}>
          {THEMES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-pressed={theme === choice.value}
              onClick={() => setTheme(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </fieldset>
      </section>

      <section className="card" aria-labelledby="content">
        <h2 id="content" style={{ fontSize: 16 }}>
          Content
        </h2>
        <label className="switch">
          <span>
            <span className="field-label">Show NSFW workflows and results</span>
            <span className="field-hint" style={{ display: "block" }}>
              Hidden by default. Applies to your library and the workflow list.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={settings.data?.nsfwVisible ?? false}
            aria-checked={settings.data?.nsfwVisible ?? false}
            disabled={settings.isPending || save.isPending}
            onChange={(event) => save.mutate({ nsfwVisible: event.target.checked })}
          />
        </label>
      </section>

      <section className="card" aria-labelledby="account">
        <h2 id="account" style={{ fontSize: 16 }}>
          Account
        </h2>
        <p className="muted">Signed in as {viewer.data?.id ?? "unknown"}</p>
        {signedInHere ? (
          <button
            type="button"
            className="btn"
            style={{ alignSelf: "flex-start" }}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        ) : null}
      </section>
    </div>
  );
}
