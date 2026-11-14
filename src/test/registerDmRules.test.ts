import { describe, expect, it } from "vitest";
import { registerDmDecision, followupFAllowed } from "../../supabase/functions/_shared/register-dm-rules";

describe("Direct de cadastro da live com follow-up global ligado", () => {
  it("pedido de comentário sem cadastro é enviado, não pulado", () => {
    expect(registerDmDecision({ stage: "incomplete_order", is_paid: false, registered_at: null }, true)).toBe("send");
  });
  it("cliente já cadastrada é pulada", () => {
    expect(registerDmDecision({ stage: "awaiting_confirmation", registered_at: "2026-11-14T16:00:00Z" }, true)).toBe("skip_registered");
  });
  it("pedido pago ou cancelado não recebe", () => {
    expect(registerDmDecision({ stage: "paid", is_paid: true }, true)).toBe("fail_closed_order");
    expect(registerDmDecision({ stage: "cancelled" }, true)).toBe("fail_closed_order");
  });
  it("tipo F não é criado quando o aviso de cadastro já saiu ou está na fila", () => {
    expect(followupFAllowed(["sent"])).toBe(false);
    expect(followupFAllowed(["pending"])).toBe(false);
    expect(followupFAllowed(["skipped"])).toBe(true);
  });
});
