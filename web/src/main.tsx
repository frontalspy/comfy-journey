import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ApiError } from "./api/client";
import { ToastProvider } from "./components/Toasts";
import { AuthGate } from "./features/auth";
import { VIEWER_KEY } from "./features/auth/hooks/useViewer";
import { CreateFormProvider } from "./features/create/hooks/CreateFormProvider";
import { LightboxProvider } from "./features/lightbox/LightboxProvider";
import "./styles.css";

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      // A session that expired mid-use sends the person back to the sign-in screen.
      if (error instanceof ApiError && error.status === 401) {
        void queryClient.invalidateQueries({ queryKey: VIEWER_KEY });
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failures, error) =>
        failures < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthGate>
            <CreateFormProvider>
              <LightboxProvider>
                <App />
              </LightboxProvider>
            </CreateFormProvider>
          </AuthGate>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
