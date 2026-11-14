-- Synthetic minimal schema for the postpone regression (no real data).
CREATE TABLE public.live_followup_jobs(id uuid PRIMARY KEY, status text, instagram text, phone text, whatsapp_number_id uuid,
  channel text, customer_key text, event_id uuid, order_id uuid, sequence_key text, step int, scheduled_at timestamptz,
  original_scheduled_at timestamptz, claimed_at timestamptz, variant text, postponed_count int DEFAULT 0,
  postponed_minutes int, postponed_reason text, reason text);
CREATE TABLE public.instagram_user_links(username text, ig_user_id text);
CREATE TABLE public.whatsapp_messages(id uuid PRIMARY KEY, phone text, whatsapp_number_id uuid, direction text,
  created_at timestamptz, source text, message text, message_id text, sender_user_id uuid);
CREATE TABLE public.live_selfservice_accesses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), confirm_message_id uuid);
CREATE TABLE public.live_comments(comment_id text);
CREATE TABLE public.whatsapp_lid_phone_map(lid text, whatsapp_number_id uuid, phone_key text);
CREATE FUNCTION public.automation_phone_key(p text) RETURNS text LANGUAGE sql AS $$ SELECT right(regexp_replace(p,'\D','','g'),8) $$;
CREATE OR REPLACE FUNCTION public.live_followup_contact_aliases(p_phone text, p_number uuid, p_ig_id text DEFAULT NULL::text)
 RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT array_remove(array_agg(DISTINCT alias),NULL) FROM (SELECT unnest(ARRAY[p_phone,p_phone||'@s.whatsapp.net',substring(p_phone from 3),substring(p_phone from 1 for 4)||substring(p_phone from 6),p_ig_id]) alias UNION ALL SELECT unnest(ARRAY[lid,lid||'@lid']) FROM whatsapp_lid_phone_map WHERE whatsapp_number_id=p_number AND phone_key=automation_phone_key(p_phone)) a $function$;
