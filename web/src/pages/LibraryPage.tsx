import { LibraryScreen } from "../features/library";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function LibraryPage() {
  useDocumentTitle("Library");
  return (
    <div className="page">
      <div className="page-head">
        <h1>Library</h1>
      </div>
      <LibraryScreen />
    </div>
  );
}
