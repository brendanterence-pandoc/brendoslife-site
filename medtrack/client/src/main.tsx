import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerWorker } from "./lib/push";

if (!window.location.hash) {
  window.location.hash = "#/";
}

registerWorker();

createRoot(document.getElementById("root")!).render(<App />);
