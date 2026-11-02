import { CreateScreen } from "../features/create";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function CreatePage() {
  useDocumentTitle();
  return <CreateScreen />;
}
