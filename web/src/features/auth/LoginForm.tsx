import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { comfyApi } from "../../api/comfyApi";
import { APP_NAME } from "../../brand";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { writeStored } from "../../storage";
import { VIEWER_KEY } from "./hooks/useViewer";

export const SESSION_FLAG = "comfy.signedIn";

export function LoginForm() {
  useDocumentTitle("Sign in");
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await comfyApi.login(token.trim());
      writeStored(SESSION_FLAG, true);
      await queryClient.invalidateQueries({ queryKey: VIEWER_KEY });
    } catch {
      setError("That token was not accepted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center-screen">
      <form className="login stack" onSubmit={handleSubmit}>
        <h1>{APP_NAME}</h1>
        <p className="muted">This server asks you to sign in.</p>
        <div className="field">
          <label className="field-label" htmlFor="login-token">
            Access token
          </label>
          <input
            id="login-token"
            className="input"
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
        </div>
        {error ? (
          <p role="alert" className="badge badge-bad">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={busy || token.trim() === ""}>
          Sign in
        </button>
      </form>
    </main>
  );
}
