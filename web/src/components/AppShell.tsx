import { NavLink, Outlet } from "react-router-dom";
import { APP_NAME } from "../brand";
import { useJobEvents } from "../features/jobs/hooks/useJobEvents";
import { Icon, type IconName } from "./Icon";

const PRIMARY: { to: string; label: string; icon: IconName }[] = [
  { to: "/", label: "Create", icon: "create" },
  { to: "/library", label: "Library", icon: "library" },
  { to: "/activity", label: "Activity", icon: "activity" },
  { to: "/workflows", label: "Workflows", icon: "workflows" },
];

function RailLink({ to, label, icon }: { to: string; label: string; icon: IconName }) {
  return (
    <NavLink to={to} end={to === "/"} className="rail-link">
      <Icon name={icon} />
      <span>{label}</span>
    </NavLink>
  );
}

/** The slim icon rail (a bottom bar on phones) around every screen. */
export function AppShell() {
  useJobEvents();
  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <span className="rail-brand" aria-hidden="true">
          {APP_NAME.slice(0, 1)}
        </span>
        {PRIMARY.map((link) => (
          <RailLink key={link.to} {...link} />
        ))}
        <span className="rail-spacer" />
        <RailLink to="/settings" label="Settings" icon="settings" />
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
