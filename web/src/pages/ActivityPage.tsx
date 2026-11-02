import { ActivityScreen } from "../features/activity";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function ActivityPage() {
  useDocumentTitle("Activity");
  return (
    <div className="page">
      <div className="page-head">
        <h1>Activity</h1>
      </div>
      <ActivityScreen />
    </div>
  );
}
