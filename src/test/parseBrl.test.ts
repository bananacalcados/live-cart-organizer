import {test,expect} from "vitest";import {parseBrlAmount} from "@/lib/refundRules";
test("p",()=>{expect(parseBrlAmount("R$ 359,99")).toBe(359.99);expect(parseBrlAmount("359.99")).toBe(359.99);expect(parseBrlAmount("1.359,99")).toBe(1359.99);});
