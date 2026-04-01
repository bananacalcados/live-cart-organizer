import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Assignment {
  phone: string;
  whatsapp_number_id: string | null;
  assigned_to: string;
}

/**
 * Manages conversation assignments and admin visibility.
 * - Admins/moderators see all conversations
 * - Regular users see only conversations assigned to them (or unassigned)
 */
export function useConversationAssignments() {
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [viewAsUserId, setViewAsUserId] = useState<string | null>(null);

  // Load current user role
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsReady(true); return; }
      setCurrentUserId(user.id);

      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);

      const roles = (roleData || []).map((r: any) => r.role);
      setIsAdmin(roles.includes("admin") || roles.includes("moderator"));
      setIsReady(true);
    };
    init();
  }, []);

  // Load assignments + realtime
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("chat_conversation_assignments")
        .select("phone, whatsapp_number_id, assigned_to");
      if (data) {
        const map = new Map<string, string>();
        for (const a of data as Assignment[]) {
          const key = `${a.phone}__${a.whatsapp_number_id || "none"}`;
          map.set(key, a.assigned_to);
        }
        setAssignments(map);
      }
    };
    load();

    const channel = supabase
      .channel("chat-assignments-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_conversation_assignments" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  /**
   * Returns the assigned user ID for a conversation key, or null if unassigned.
   */
  const getAssignedTo = useCallback((conversationKey: string): string | null => {
    return assignments.get(conversationKey) || null;
  }, [assignments]);

  /**
   * Filters conversations based on current user's role:
   * - Admin/moderator: sees all (or filtered by viewAsUserId)
   * - Regular user: sees only their assigned + unassigned conversations
   */
  const filterByAssignment = useCallback(<T extends { conversationKey?: string }>(conversations: T[]): T[] => {
    if (!isReady || !currentUserId) return conversations;

    // Admin viewing a specific user's conversations
    if (isAdmin && viewAsUserId) {
      return conversations.filter(c => {
        const key = c.conversationKey || "";
        const assigned = assignments.get(key);
        return assigned === viewAsUserId;
      });
    }

    // Admin sees all
    if (isAdmin) return conversations;

    // Regular user: show assigned to them + unassigned
    return conversations.filter(c => {
      const key = c.conversationKey || "";
      const assigned = assignments.get(key);
      return !assigned || assigned === currentUserId;
    });
  }, [isReady, currentUserId, isAdmin, viewAsUserId, assignments]);

  return {
    assignments,
    currentUserId,
    isAdmin,
    isReady,
    viewAsUserId,
    setViewAsUserId,
    getAssignedTo,
    filterByAssignment,
  };
}
