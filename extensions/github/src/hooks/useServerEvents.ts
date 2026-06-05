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
    let events: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelayMs = 250;

    const connect = () => {
      if (!active) {
        return;
      }
      const source = new EventSource(
        `/events?instanceId=${encodeURIComponent(instanceId)}&clientId=${encodeURIComponent(clientId)}`,
      );
      events = source;

      source.onopen = () => {
        reconnectDelayMs = 250;
      };

      source.onmessage = (event) => {
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

      source.onerror = () => {
        if (!active) {
          return;
        }
        handlersRef.current.onConnectionError();
        // EventSource only auto-reconnects on transient transport errors; a
        // non-2xx server response puts the stream into CLOSED with no further
        // attempts. Reconnect with backoff so an upstream blip cannot
        // permanently silence presence and content events for this canvas.
        if (source.readyState === EventSource.CLOSED) {
          source.close();
          if (events === source) {
            events = null;
          }
          reconnectTimer = setTimeout(connect, reconnectDelayMs);
          reconnectDelayMs = Math.min(reconnectDelayMs * 2, 5000);
        }
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      events?.close();
    };
  }, [clientId, instanceId]);
}
