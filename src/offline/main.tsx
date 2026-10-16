import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./offline.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// The service worker keeps the app itself available with no connection.
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/offline-sw.js", { scope: "/" });
  });
