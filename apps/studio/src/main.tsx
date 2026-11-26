import React from "react";
import ReactDOM from "react-dom/client";
import { initLanguage } from "@openreel/i18n";
import { App } from "./App";
import "./index.css";

initLanguage();

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
