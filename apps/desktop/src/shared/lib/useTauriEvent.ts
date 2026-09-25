import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

import { isTauriRuntime } from "./runtime";

/**
 * Subscribe to a Tauri event for the component's lifetime.
 *
 * The latest `handler` is always the one called, so callers need not memoize
 * it. `listen` resolves asynchronously; if the component unmounts first, the
 * subscription is released as soon as it arrives rather than leaking.
 */
export function useTauriEvent<T>(event: string, handler: (payload: T) => void): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let active = true;
    let unlisten: UnlistenFn | undefined;

    void listen<T>(event, (e) => {
      if (active) handlerRef.current(e.payload);
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, [event]);
}
