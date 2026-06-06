import { useState } from "react";
import { POSCustomersList } from "./POSCustomersList";
import { POSCustomer360 } from "./POSCustomer360";
import { List, Search } from "lucide-react";

interface Props {
  storeId: string;
  initialQuery?: string;
}

export function POSCustomersHub({ storeId, initialQuery }: Props) {
  const [tab, setTab] = useState<"list" | "profile">(initialQuery ? "profile" : "list");
  const [profileQuery, setProfileQuery] = useState<string | undefined>(initialQuery);

  const openProfile = (query: string) => {
    setProfileQuery(query);
    setTab("profile");
  };

  return (
    <div className="flex-1 flex flex-col bg-pos-black text-pos-white overflow-hidden">
      <div className="flex gap-1 p-2 border-b border-pos-white/10 shrink-0">
        <button
          onClick={() => setTab("list")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            tab === "list" ? "bg-pos-orange text-white" : "text-pos-white/60 hover:bg-pos-white/10"
          }`}
        >
          <List className="h-4 w-4" /> Lista
        </button>
        <button
          onClick={() => setTab("profile")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            tab === "profile" ? "bg-pos-orange text-white" : "text-pos-white/60 hover:bg-pos-white/10"
          }`}
        >
          <Search className="h-4 w-4" /> Perfil 360°
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {tab === "list" ? (
          <POSCustomersList onOpenProfile={openProfile} />
        ) : (
          <POSCustomer360 key={profileQuery} storeId={storeId} initialQuery={profileQuery} />
        )}
      </div>
    </div>
  );
}
