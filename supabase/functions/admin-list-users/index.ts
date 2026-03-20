import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://www.bananacalcados.com.br",
  "https://bananacalcados.com.br",
  "https://live-cart-organizer.lovable.app",
  "https://checkout.bananacalcados.com.br",
  "https://tqxhcyuxgqbzqwoidpie.supabase.co",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const callerId = claimsData.claims.sub;

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check admin or manager
    const { data: isAdmin } = await serviceClient.rpc("has_role", {
      _user_id: callerId,
      _role: "admin",
    });
    const { data: isManager } = await serviceClient.rpc("has_role", {
      _user_id: callerId,
      _role: "manager",
    });

    if (!isAdmin && !isManager) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // List all users
    const { data: usersData, error: usersError } = await serviceClient.auth.admin.listUsers();
    if (usersError) {
      return new Response(JSON.stringify({ error: usersError.message }), {
        status: 500,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Get roles and permissions
    const { data: roles } = await serviceClient.from("user_roles").select("*");
    const { data: permissions } = await serviceClient.from("user_module_permissions").select("*");
    const { data: profiles } = await serviceClient.from("profiles").select("*");

    const users = usersData.users.map((u) => {
      const userRoles = (roles || []).filter((r) => r.user_id === u.id);
      const userPermissions = (permissions || []).filter((p) => p.user_id === u.id);
      const profile = (profiles || []).find((p) => p.user_id === u.id);

      return {
        id: u.id,
        email: u.email,
        display_name: profile?.display_name || u.user_metadata?.display_name || u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        roles: userRoles.map((r) => r.role),
        modules: userPermissions.map((p) => p.module),
      };
    });

    return new Response(JSON.stringify({ users }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
