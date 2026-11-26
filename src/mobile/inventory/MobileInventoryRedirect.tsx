import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { readEnv, shouldUseMobileInventory } from "./redirect";

/** Desvia /inventory para /m/estoque em celular de toque; o desktop é renderizado sem mudança. */
export function MobileInventoryRedirect({ children }: { children: ReactNode }) {
  if (shouldUseMobileInventory(readEnv())) return <Navigate to="/m/estoque" replace />;
  return <>{children}</>;
}
