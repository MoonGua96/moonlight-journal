import { useEffect, useRef, useState } from "react";
import {
  getDataDirectory,
  isLocalUat,
  loadState,
  moveDataDirectory,
  saveState,
} from "./repository";
import { initialState, type AppState } from "./types";
import { promoteDueTodos } from "./todos";

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function useAppState() {
  const [state, setState] = useState<AppState>(initialState);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [dataDirectory, setDataDirectory] = useState("");
  const [isUat, setIsUat] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    Promise.all([loadState(), getDataDirectory(), isLocalUat()]).then(
      ([value, path, localUat]) => {
        setState(value);
        setDataDirectory(path);
        setIsUat(localUat);
        setReady(true);
      },
    );
  }, []);

  useEffect(() => {
    if (!ready) return;
    const promote = () => {
      const date = localDateKey(new Date());
      setState((current) => {
        const todos = promoteDueTodos(current.todos, date);
        return todos === current.todos ? current : { ...current, todos };
      });
    };
    promote();
    const interval = window.setInterval(promote, 60_000);
    return () => window.clearInterval(interval);
  }, [ready]);

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
    isUat,
    changeDataDirectory,
  };
}
