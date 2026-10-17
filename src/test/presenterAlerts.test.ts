import { describe, expect, it } from "vitest";
import { isPresenterMessage } from "@/lib/presenterAlerts";

describe("presenter notifications", () => {
  it("keeps messages explicitly sent by the team", () => {
    expect(isPresenterMessage({ alert_type: "team_message" })).toBe(true);
  });

  it.each(["new_order_unpaid", "awaiting_confirmation", "missing_whatsapp", "show_product_again", "customer_issue", "returning_desistente", "general"])("suppresses automatic %s notifications", (alert_type) => {
    expect(isPresenterMessage({ alert_type })).toBe(false);
  });
});