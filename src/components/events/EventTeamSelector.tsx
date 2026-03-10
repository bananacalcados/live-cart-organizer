import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { TeamMember } from "./EventTeamManager";
import { Mic, UserCheck } from "lucide-react";

interface EventTeamSelectorProps {
  eventId: string;
  onChange?: (memberIds: string[]) => void;
}

export function EventTeamSelector({ eventId, onChange }: EventTeamSelectorProps) {
  const [allMembers, setAllMembers] = useState<TeamMember[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [{ data: members }, { data: assignments }] = await Promise.all([
        supabase.from("event_team_members").select("*").eq("is_active", true).order("name"),
        supabase.from("event_team_assignments").select("team_member_id").eq("event_id", eventId),
      ]);
      setAllMembers((members as unknown as TeamMember[]) || []);
      const ids = new Set((assignments || []).map((a: any) => a.team_member_id));
      setSelectedIds(ids);
      setLoading(false);
    };
    if (eventId) load();
  }, [eventId]);

  const toggleMember = async (memberId: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(memberId)) {
      newSet.delete(memberId);
      await supabase.from("event_team_assignments").delete()
        .eq("event_id", eventId).eq("team_member_id", memberId);
    } else {
      newSet.add(memberId);
      await supabase.from("event_team_assignments").insert({
        event_id: eventId, team_member_id: memberId,
      });
    }
    setSelectedIds(newSet);
    onChange?.(Array.from(newSet));
  };

  if (loading) return <p className="text-xs text-muted-foreground">Carregando equipe...</p>;
  if (allMembers.length === 0) return <p className="text-xs text-muted-foreground">Nenhum membro cadastrado. Vá em Equipe para cadastrar.</p>;

  const apresentadoras = allMembers.filter((m) => m.role === "apresentadora");
  const vendedoras = allMembers.filter((m) => m.role === "vendedora");

  return (
    <div className="space-y-3">
      <Label className="text-sm font-semibold">Equipe do Evento</Label>
      
      {apresentadoras.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
            <Mic className="h-3 w-3" /> Apresentadoras
          </p>
          <div className="space-y-1">
            {apresentadoras.map((m) => (
              <MemberCheckbox key={m.id} member={m} checked={selectedIds.has(m.id)} onToggle={toggleMember} />
            ))}
          </div>
        </div>
      )}

      {vendedoras.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
            <UserCheck className="h-3 w-3" /> Vendedoras
          </p>
          <div className="space-y-1">
            {vendedoras.map((m) => (
              <MemberCheckbox key={m.id} member={m} checked={selectedIds.has(m.id)} onToggle={toggleMember} />
            ))}
          </div>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {allMembers.filter((m) => selectedIds.has(m.id)).map((m) => (
            <Badge key={m.id} variant="secondary" className="text-xs gap-1">
              {m.role === "apresentadora" ? "🎤" : "🛒"} {m.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function MemberCheckbox({ member, checked, onToggle }: { member: TeamMember; checked: boolean; onToggle: (id: string) => void }) {
  return (
    <label className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted/50 cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={() => onToggle(member.id)} />
      <Avatar className="h-6 w-6">
        <AvatarImage src={member.photo_url || undefined} />
        <AvatarFallback className="text-[10px] bg-accent/20 text-accent font-bold">
          {member.name.substring(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="text-sm">{member.name}</span>
    </label>
  );
}

// Compact display for dashboard header
export function EventTeamDisplay({ eventId }: { eventId: string }) {
  const [members, setMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data: assignments } = await supabase
        .from("event_team_assignments")
        .select("team_member_id")
        .eq("event_id", eventId);
      
      if (!assignments || assignments.length === 0) return;
      const ids = assignments.map((a: any) => a.team_member_id);

      const { data: mems } = await supabase
        .from("event_team_members")
        .select("*")
        .in("id", ids);
      
      setMembers((mems as unknown as TeamMember[]) || []);
    };
    if (eventId) load();
  }, [eventId]);

  if (members.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {members.map((m) => (
        <div key={m.id} className="relative group">
          <Avatar className="h-7 w-7 border-2 border-background">
            <AvatarImage src={m.photo_url || undefined} />
            <AvatarFallback className="text-[9px] bg-accent/20 text-accent font-bold">
              {m.name.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 bg-popover text-popover-foreground text-[10px] rounded shadow-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
            {m.role === "apresentadora" ? "🎤" : "🛒"} {m.name}
          </div>
        </div>
      ))}
    </div>
  );
}
