import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import * as api from "./api";
import { SessionProvider } from "./session";
import { useSystemTheme } from "./theme";
import "./index.css";

// Development only: lets you try the data layer from the browser console, e.g.  await __api.fieldInstallations.list()
if (import.meta.env.DEV) (window as unknown as { __api: typeof api }).__api = api;

function Root() {
  useSystemTheme();
  return (
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
