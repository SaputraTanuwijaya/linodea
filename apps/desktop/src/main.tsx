import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyTheme, getStoredTheme } from "./themes";
import { applyLanguage, getStoredLanguage } from "./i18n";

// Apply persisted theme + language before React mounts so the popup never
// flashes in the wrong palette / language on launch.
applyTheme(getStoredTheme());
applyLanguage(getStoredLanguage());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
