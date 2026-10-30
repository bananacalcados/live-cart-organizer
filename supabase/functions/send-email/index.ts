import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { sendEmail, requireAdminOrService } from "../_shared/email-send.ts";

const Body = z.object({
  categoria: z.enum(["fiscal", "transacional", "marketing"]),
  from: z.object({ email: z.string().email(), name: z.string().max(120).optional() }).optional(),
  to: z.array(z.string().email()).min(1).max(50),
  cc: z.array(z.string().email()).max(50).optional(),
  reply_to: z.string().email().optional(),
  subject: z.string().min(1).max(300),
  html: z.string().max(500_000).optional(),
  text: z.string().max(500_000).optional(),
  attachments: z.array(z.object({ filename: z.string().min(1).max(200), content_base64: z.string() })).max(10).optional(),
  company_id: z.string().uuid().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (!(await requireAdminOrService(req))) return json({ error: "unauthorized" }, 401);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
  const r = await sendEmail(parsed.data as any);
  return json(r, r.ok ? 200 : 502);
});
