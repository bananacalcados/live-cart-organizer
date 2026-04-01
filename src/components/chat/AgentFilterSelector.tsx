import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Users } from "lucide-react";

interface Agent {
  user_id: string;
  display_name: string;
}

interface AgentFilterSelectorProps {
  value: string | null;
  onValueChange: (userId: string | null) => void;
  className?: string;
}

export function AgentFilterSelector({ value, onValueChange, className }: AgentFilterSelectorProps) {
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("user_id, display_name")
        .eq("is_active", true)
        .order("display_name");
      if (data) setAgents(data);
    };
    load();
  }, []);

  if (agents.length === 0) return null;

  return (
    <Select
      value={value || "all"}
      onValueChange={(v) => onValueChange(v === "all" ? null : v)}
    >
      <SelectTrigger className={className}>
        <Users className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
        <SelectValue placeholder="Todos os atendentes" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos os atendentes</SelectItem>
        {agents.map((a) => (
          <SelectItem key={a.user_id} value={a.user_id}>
            {a.display_name || "Sem nome"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
