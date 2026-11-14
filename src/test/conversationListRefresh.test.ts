import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWaMessageBroadcast } from "@/hooks/useWaMessageBroadcast";
import {
  CONVERSATION_LIST_REFRESH_WINDOW_MS,
  shouldRefreshConversationList,
} from "@/lib/chat/conversationListRefresh";

const channelMock = vi.hoisted(() => {
  const handlers = new Map<string, (message: { payload: unknown }) => void>();
  const channel = {
    on: vi.fn((_type: string, filter: { event: string }, callback: (message: { payload: unknown }) => void) => {
      handlers.set(filter.event, callback);
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };
  return { channel, handlers, removeChannel: vi.fn() };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: vi.fn(() => channelMock.channel),
    removeChannel: channelMock.removeChannel,
  },
}));

const message = (overrides: Record<string, unknown> = {}) => ({
  id: "message-1",
  phone: "5598999999999",
  whatsapp_number_id: "number-1",
  direction: "incoming",
  created_at: "2026-11-14T16:00:00Z",
  ...overrides,
});

function emitInsert(payload: Record<string, unknown>) {
  channelMock.handlers.get("wa_msg_insert")?.({ payload });
}

function emitUpdate(payload: Record<string, unknown>) {
  channelMock.handlers.get("wa_msg_update")?.({ payload });
}

describe("atualização da lista de conversas durante disparos", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    channelMock.handlers.clear();
    channelMock.channel.on.mockClear();
    channelMock.channel.subscribe.mockClear();
    channelMock.removeChannel.mockClear();
  });

  it("não agenda recarga para campanha nem para recibo de status", () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useWaMessageBroadcast(refresh, {
      debounceMs: CONVERSATION_LIST_REFRESH_WINDOW_MS,
      filter: shouldRefreshConversationList,
    }));

    act(() => {
      emitInsert(message({ direction: "outgoing", is_mass_dispatch: true }));
      emitInsert(message({ direction: "outgoing", source: "broadcast" }));
      emitUpdate(message({ direction: "outgoing", status: "read" }));
      vi.advanceTimersByTime(10_000);
    });

    expect(refresh).not.toHaveBeenCalled();
    unmount();
  });

  it("agrupa respostas e envios manuais em no máximo uma recarga a cada 4 segundos", () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useWaMessageBroadcast(refresh, {
      debounceMs: CONVERSATION_LIST_REFRESH_WINDOW_MS,
      filter: shouldRefreshConversationList,
    }));

    act(() => {
      emitInsert(message());
      emitInsert(message({ id: "message-2" }));
      emitInsert(message({ id: "message-3", direction: "outgoing", source: "manual" }));
      vi.advanceTimersByTime(3_999);
    });
    expect(refresh).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => {
      for (let i = 0; i < 20; i++) emitInsert(message({ id: `burst-${i}` }));
      vi.advanceTimersByTime(3_999);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    unmount();
  });
});
