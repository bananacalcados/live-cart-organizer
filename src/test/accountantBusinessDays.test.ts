import { describe, it, expect } from "vitest";
import { businessDayIndex, previousMonth } from "../../supabase/functions/accountant-monthly-package/business-days";

const hol = new Set(["2026-11-02", "2027-01-01", "2026-02-16", "2026-02-17"]);

describe("2º dia útil do contador", () => {
  it("novembro/2026: Finados (seg 02) não conta, 2º dia útil é 04/11", () => {
    expect(businessDayIndex("2026-11-03", hol)).toBe(1);
    expect(businessDayIndex("2026-11-04", hol)).toBe(2);
    expect(businessDayIndex("2026-11-02", hol)).toBeNull();
  });
  it("janeiro/2027: 01 feriado, 2º dia útil é terça 05/01", () => {
    expect(businessDayIndex("2027-01-05", hol)).toBe(2);
  });
  it("sábado não é dia útil", () => {
    expect(businessDayIndex("2026-10-31", hol)).toBeNull();
  });
  it("mês de referência é o anterior", () => {
    expect(previousMonth("2027-01-05")).toBe("2026-12");
    expect(previousMonth("2026-11-04")).toBe("2026-10");
  });
});
