import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";

import "./App.css";
import App from "./App";
import { AlertPage } from "@/pages/alert";
import { ConfirmPage } from "@/pages/confirm";
import { TimerPage } from "@/pages/timer";
import { applyLanguage, getStoredLanguage } from "@/features/language";
import { applyTheme, getStoredTheme } from "@/features/theme";
import { isTauriRuntime } from "@/shared/lib";

// Apply persisted theme + language before React mounts so neither window
// flashes in the wrong palette / language on launch.
applyTheme(getStoredTheme());
applyLanguage(getStoredLanguage());

// One bundle serves every window; route by window label. The "alert" window
// (Rust-shown at fire time) renders the notification card, the "timer" window
// renders the `/countdown` countdown; everything else is the main popup.
const windowLabel = isTauriRuntime() ? getCurrentWindow().label : "main";
const Root =
  windowLabel === "alert"
    ? AlertPage
    : windowLabel === "timer"
      ? TimerPage
      : windowLabel === "confirm"
        ? ConfirmPage
        : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
