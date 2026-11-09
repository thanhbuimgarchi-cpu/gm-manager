import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import StartupSplash from "../app/StartupSplash";
import { applyColorTheme, readColorTheme } from "../app/color-theme";
import "../app/globals.css";
import "../app/pwa.css";
import "../app/interface.css";
import "../app/theme.css";

applyColorTheme(readColorTheme());
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StartupSplash><Home /></StartupSplash>
  </StrictMode>,
);
