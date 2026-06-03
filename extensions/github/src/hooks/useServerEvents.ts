import { useEffect, useRef } from "react";
import type { ServerEvent } from "../types";

type ServerEventsOptions = {
  clientId: string;
  instanceId: string | null;
  onConnectionError: () => void;
  onEvent: (event: ServerEvent) => void;
  onInvalidEvent: () => void;
};

export function useServerEvents({
  clientId,
  instanceId,
  onConnectionError,
  onEvent,
  onInvalidEvent,
}: ServerEventsOptions): void {
  const handlersRef = useRef({
    onConnectionError,
    onEvent,
    onInvalidEvent,
  });

  handlersRef.current = {
    onConnectionError,
    onEvent,
    onInvalidEvent,
  };

  useEffect(() => {
    if (!instanceId) {
      return;
    }

    let active = true;
    const events = new EventSource(
      `/events?instanceId=${encodeURIComponent(instanceId)}&clientId=${encodeURIComponent(clientId)}`,
    );

    events.onmessage = (event) => {
      if (!active) {
        return;
      }

      let payload;
      try {
        payload = JSON.parse(event.data) as ServerEvent;
      } catch {
        handlersRef.current.onInvalidEvent();
        return;
      }

      handlersRef.current.onEvent(payload);
    };
    events.onerror = () => {
      if (active) {
        handlersRef.current.onConnectionError();
      }
    };

    return () => {
      active = false;
      events.close();
    };
  }, [clientId, instanceId]);
}
