import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PetApp from "./PetApp";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(location.search).has("pet") ? <PetApp /> : <App />}
  </React.StrictMode>,
);
