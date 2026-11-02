import { SettingsScreen } from "../features/settings";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function SettingsPage() {
  useDocumentTitle("Settings");
  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <SettingsScreen />
    </div>
  );
}
