import { WorkflowsScreen } from "../features/workflows";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function WorkflowsPage() {
  useDocumentTitle("Workflows");
  return (
    <div className="page">
      <div className="page-head">
        <h1>Workflows</h1>
      </div>
      <WorkflowsScreen />
    </div>
  );
}
