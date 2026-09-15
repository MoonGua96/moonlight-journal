import { useEffect, useRef, useState } from "react";
import {
  getDataDirectory,
  loadState,
  moveDataDirectory,
  saveState,
} from "./repository";
import { initialState, type AppState } from "./types";

export function useAppState() {
  const [state, setState] = useState<AppState>(initialState);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [dataDirectory, setDataDirectory] = useState("");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    Promise.all([loadState(), getDataDirectory()]).then(([value, path]) => {
      setState(value);
      setDataDirectory(path);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    setSaveStatus("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      saveState(state)
        .then(() => setSaveStatus("saved"))
        .catch((error) => {
          console.error(error);
          setSaveStatus("error");
        });
    }, 250);
    return () => window.clearTimeout(timer.current);
  }, [state, ready]);

  const changeDataDirectory = async (path: string) => {
    await moveDataDirectory(path, state);
    setDataDirectory(path);
    setSaveStatus("saved");
  };
  return {
    state,
    setState,
    ready,
    saveStatus,
    dataDirectory,
    changeDataDirectory,
  };
}
