import { POSWhatsApp } from "@/components/pos/POSWhatsApp";

/**
 * WhatsApp module for Expedition - reuses POSWhatsApp with a default store context.
 * Uses "expedition" as a virtual storeId so CRM/catalog features work without a physical store.
 */
export function ExpeditionWhatsApp() {
  return (
    <div className="h-[calc(100vh-280px)] min-h-[500px] rounded-lg overflow-hidden border border-border">
      <POSWhatsApp storeId="expedition" />
    </div>
  );
}
