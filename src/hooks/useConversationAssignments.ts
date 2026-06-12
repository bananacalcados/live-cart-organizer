import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Assignment {
  phone: string;
  whatsapp_number_id: string | null;
  assigned_to: string;
  assigned_name?: string | null;
}

/**
 * Manages conversation assignments and admin visibility.
 * - Admins/moderators see all conversations
 * - Regular users see only conversations assigned to them (or unassigned)
 * - Each conversation shows the name of the attendant handling it
 */
export function useConversationAssignments() {
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map());
  const [assignedNames, setAssignedNames] = useState<Map<string, string>>(new Map());
  const [profileNames, setProfileNames] = useState<Map<string, string>>(new Map());
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

  // Load profile names (user_id -> display_name) for fallback name resolution
  useEffect(() => {
    const loadProfiles = async () => {
      const { data } = await supabase.from("profiles").select("user_id, display_name");
      if (data) {
        const map = new Map<string, string>();
        for (const p of data as any[]) {
          if (p.user_id && p.display_name) map.set(p.user_id, p.display_name);
        }
        setProfileNames(map);
      }
    };
    loadProfiles();
  }, []);

  // Load assignments + realtime
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("chat_conversation_assignments")
        .select("phone, whatsapp_number_id, assigned_to, assigned_name");
      if (data) {
        const map = new Map<string, string>();
        const nameMap = new Map<string, string>();
        for (const a of data as Assignment[]) {
          const key = `${a.phone}__${a.whatsapp_number_id || "none"}`;
          map.set(key, a.assigned_to);
          if (a.assigned_name) nameMap.set(key, a.assigned_name);
        }
        setAssignments(map);
        setAssignedNames(nameMap);
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
   * Returns the display name of the attendant handling a conversation, or null.
   * Falls back to the profile display name when no stored name exists.
   */
  const getAssignedName = useCallback((conversationKey: string): string | null => {
    const stored = assignedNames.get(conversationKey);
    if (stored) return stored;
    const userId = assignments.get(conversationKey);
    if (userId) return profileNames.get(userId) || null;
    return null;
  }, [assignedNames, assignments, profileNames]);

  /**
   * Assigns a conversation to a user (an attendant).
   * When onlyIfUnassigned is true, it won't override an existing assignment —
   * used to auto-attribute a conversation to whoever replies first.
   */
  const assignConversation = useCallback(async (params: {
    phone: string;
    whatsappNumberId?: string | null;
    userId: string;
    name?: string | null;
    onlyIfUnassigned?: boolean;
  }) => {
    const { phone, whatsappNumberId = null, userId, name = null, onlyIfUnassigned } = params;
    if (!phone || !userId) return;
    const key = `${phone}__${whatsappNumberId || "none"}`;
    if (onlyIfUnassigned && assignments.get(key)) return;

    const resolvedName = name || profileNames.get(userId) || null;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("chat_conversation_assignments").upsert({
      phone,
      whatsapp_number_id: whatsappNumberId,
      assigned_to: userId,
      assigned_name: resolvedName,
      assigned_by: user?.id || null,
    } as any, { onConflict: "phone,whatsapp_number_id" });
    if (error) {
      console.error("assignConversation error:", error);
      return;
    }
    // Optimistic local update (realtime will reconcile)
    setAssignments(prev => new Map(prev).set(key, userId));
    if (resolvedName) setAssignedNames(prev => new Map(prev).set(key, resolvedName));
  }, [assignments, profileNames]);

  /**
   * Filters conversations based on current user's role:
   * - Admin/moderator: sees all (or filtered by viewAsUserId)
   * - Regular user: sees only their assigned + unassigned conversations
   *
   * In the POS, a seller signs in through the "seller gate" and her replies are
   * assigned to her linked user id (sellerLinkedUserId), which can differ from the
   * device's auth account (currentUserId). Pass that id via `viewerUserId` so the
   * seller sees the conversations assigned to her — not only the unassigned ones.
   */
  const filterByAssignment = useCallback(<T extends { conversationKey?: string }>(
    conversations: T[],
    options?: { viewerUserId?: string | null },
  ): T[] => {
    const viewerUserId = options?.viewerUserId || null;
    const effectiveUserId = viewerUserId || currentUserId;
    if (!isReady || !effectiveUserId) return conversations;

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

    // Regular user / seller: show conversations assigned to them (either the
    // device account or the selected seller's linked id) + unassigned ones.
    const allowed = new Set<string>();
    if (currentUserId) allowed.add(currentUserId);
    if (viewerUserId) allowed.add(viewerUserId);
    return conversations.filter(c => {
      const key = c.conversationKey || "";
      const assigned = assignments.get(key);
      return !assigned || allowed.has(assigned);
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
    getAssignedName,
    assignConversation,
    filterByAssignment,
  };
}
