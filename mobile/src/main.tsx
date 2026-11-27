import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { App } from "./App";
import { CrashScreen } from "./components/CrashScreen";
import * as api from "./api";
import { SessionProvider } from "./session";
import { useSystemTheme } from "./theme";
import { ToastProvider } from "./ui/toast";
import "./index.css";

// Development only: lets you try the data layer from the browser console, e.g.  await __api.fieldInstallations.list()
if (import.meta.env.DEV) (window as unknown as { __api: typeof api }).__api = api;

function Root() {
  useSystemTheme();
  return (
    <ToastProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </ToastProvider>
  );
}

// A "data router" (instead of <BrowserRouter>) so screens can warn before the technician leaves unsaved work.
const router = createBrowserRouter([{ path: "*", element: <Root />, errorElement: <CrashScreen /> }]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
