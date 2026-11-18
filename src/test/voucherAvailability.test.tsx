// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { OrderVoucherBox } from "@/components/events/OrderVoucherBox";
import { SelfServiceVoucherBox } from "@/components/live/SelfServiceVoucherBox";
import type { DbOrder } from "@/types/database";
import type { AvailableVoucher } from "@/lib/vouchers";

const voucher: AvailableVoucher = {
  id: "v1", codigo: "VC-TESTE", saldo: 40, validade: null, status: "usado",
  applied_amount: 40, reserved_order_id: "order-1", reserved_sale_id: null, is_available: false,
};

beforeEach(() => rpc.mockReset());
afterEach(cleanup);

describe("voucher depois do uso", () => {
  it("a ficha paga mostra o voucher usado e não oferece novo uso nem remoção", async () => {
    rpc.mockResolvedValue({ data: [voucher], error: null });
    render(<OrderVoucherBox order={{ id: "order-1", is_paid: true, paid_externally: false, voucher_id: "v1", voucher_amount: 40 } as DbOrder} />);
    expect(await screen.findByText("Usado neste pedido")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abater" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remover" })).not.toBeInTheDocument();
  });

  it("um voucher usado em outro pedido não aparece como disponível no carrinho", () => {
    const { container } = render(<SelfServiceVoucherBox vouchers={[voucher]} appliedId={null} appliedAmount={0} busy={null} onApply={vi.fn()} onRemove={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("um voucher ainda reservado neste carrinho pode ser removido antes do pagamento", () => {
    render(<SelfServiceVoucherBox vouchers={[{ ...voucher, status: "ativo", is_available: true }]} appliedId="v1" appliedAmount={40} busy={null} onApply={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Remover" })).toBeInTheDocument();
    expect(screen.getByText("R$ 40,00")).toBeInTheDocument();
  });
});
