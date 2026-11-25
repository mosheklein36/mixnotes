import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

import("./App")
  .then(({ App }) =>
    root.render(
      <React.StrictMode>
        <HashRouter>
          <App />
        </HashRouter>
      </React.StrictMode>,
    ),
  )
  .catch((e: unknown) =>
    root.render(<div className="center muted">MixNotes failed to start: {e instanceof Error ? e.message : String(e)}</div>),
  );
