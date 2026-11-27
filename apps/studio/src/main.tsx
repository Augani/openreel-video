import React from "react";
import ReactDOM from "react-dom/client";
import { initLanguage } from "@openreel/i18n";
import { loadDictionary } from "@openreel/i18n/translate";
import { App } from "./App";
import "./index.css";

initLanguage();
void loadDictionary();

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
