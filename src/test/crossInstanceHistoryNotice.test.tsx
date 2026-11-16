import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { CrossInstanceHistoryNotice } from "@/components/chat/CrossInstanceHistoryNotice";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

describe("aviso de histórico durante o carregamento da conversa", () => {
  it("mantém a resposta quando o estado de loading muda e permite abrir a outra instância", async () => {
    let resolve!: (value: { data: unknown; error: null }) => void;
    rpc.mockReturnValue(new Promise((r) => { resolve = r; }));
    const onView = vi.fn();
    const props = {
      phone: "5548999384715",
      currentNumberId: "centro",
      currentMessageCount: 1,
      instances: [{ id: "perola", label: "Meta Pérola" }],
      onView,
    };
    const { rerender } = render(<CrossInstanceHistoryNotice {...props} loading={false} />);
    rerender(<CrossInstanceHistoryNotice {...props} loading={true} />);
    resolve({ data: [{ whatsapp_number_id: "perola", message_count: 38 }], error: null });
    await waitFor(() => expect(screen.getByText(/38 mensagens/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Ver" }));
    expect(onView).toHaveBeenCalledWith("perola");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
