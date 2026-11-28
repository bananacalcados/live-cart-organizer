-- Disposable database only. These are minimal shapes of the production rows.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE events(id uuid PRIMARY KEY,name text,live_followup_enabled boolean,whatsapp_number_id uuid,wa_initial_number_id uuid,self_service_slug text);
CREATE TABLE live_comments(created_at timestamptz);
CREATE TABLE orders(id uuid PRIMARY KEY,event_id uuid,customer_id uuid,created_at timestamptz,registered_at timestamptz,origin text,attribution jsonb,is_paid boolean,paid_externally boolean,stage text,merged_into_order_id uuid,products jsonb,selfservice_cart_sent_at timestamptz,live_followup_cart_sent_at timestamptz,live_followup_first_item_at timestamptz,paid_at timestamptz);
CREATE TABLE customers(id uuid PRIMARY KEY,whatsapp text,full_name text,instagram_handle text);
CREATE TABLE customer_registrations(id uuid PRIMARY KEY,order_id uuid,whatsapp text,full_name text);
CREATE TABLE live_selfservice_accesses(id uuid PRIMARY KEY,event_id uuid,order_ids uuid[],created_at timestamptz,live_followup_phone_at timestamptz,registered_at timestamptz,whatsapp_confirmed_at timestamptz,entered_phone text,confirmed_phone text,instagram text);
CREATE TABLE live_followup_sources(source_key text PRIMARY KEY,event_id uuid,order_id uuid,access_id uuid,changed_at timestamptz DEFAULT now());
CREATE TABLE live_followup_jobs(id uuid PRIMARY KEY,status text,scheduled_at timestamptz,sent_at timestamptz,reason text);
CREATE TABLE selfservice_message_queue(order_id uuid,kind text,status text,sent_at timestamptz);
CREATE TABLE instagram_user_links(username text,ig_user_id text);
CREATE TABLE whatsapp_messages(phone text,channel text,direction text,created_at timestamptz,whatsapp_number_id uuid);
CREATE FUNCTION live_followup_enabled(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION live_event_sender(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('id','0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c') $$;