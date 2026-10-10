import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import 'tailwindcss/index.css';
import { initializeAttribution } from './lib/attribution.js';

initializeAttribution();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
