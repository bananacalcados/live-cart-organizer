-- A) Novas colunas em pos_sellers
ALTER TABLE public.pos_sellers
  ADD COLUMN IF NOT EXISTS is_manager boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_phone text;

-- Trigger de updated_at reutilizável (já pode existir)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- B) Definições de tarefa
CREATE TABLE IF NOT EXISTS public.pos_task_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'custom',
  verification_mode text NOT NULL DEFAULT 'manual', -- 'manual' | 'auto'
  target_count integer NOT NULL DEFAULT 1,
  recurrence text NOT NULL DEFAULT 'daily', -- once|daily|weekly|weekly_specific|monthly|monthly_specific
  recurrence_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  assignment text NOT NULL DEFAULT 'all', -- all|managers|specific
  assigned_seller_ids uuid[] NOT NULL DEFAULT '{}',
  points_reward integer NOT NULL DEFAULT 0,
  auto_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_task_definitions TO authenticated;
GRANT ALL ON public.pos_task_definitions TO service_role;
ALTER TABLE public.pos_task_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage task definitions" ON public.pos_task_definitions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_pos_task_definitions_updated
  BEFORE UPDATE ON public.pos_task_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_pos_task_definitions_store ON public.pos_task_definitions(store_id, is_active);

-- C) Instâncias por vendedora/dia
CREATE TABLE IF NOT EXISTS public.pos_seller_task_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid NOT NULL REFERENCES public.pos_task_definitions(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  due_date date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  status text NOT NULL DEFAULT 'pending', -- pending | completed
  progress_current integer NOT NULL DEFAULT 0,
  progress_target integer NOT NULL DEFAULT 1,
  completion_mode text, -- manual | auto
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_id, seller_id, due_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_seller_task_instances TO authenticated;
GRANT ALL ON public.pos_seller_task_instances TO service_role;
ALTER TABLE public.pos_seller_task_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage task instances" ON public.pos_seller_task_instances
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_pos_seller_task_instances_updated
  BEFORE UPDATE ON public.pos_seller_task_instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_task_instances_seller_date ON public.pos_seller_task_instances(seller_id, due_date, status);
CREATE INDEX IF NOT EXISTS idx_task_instances_store_date ON public.pos_seller_task_instances(store_id, due_date);

-- D) Contatos verificáveis das tarefas automáticas
CREATE TABLE IF NOT EXISTS public.pos_task_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.pos_seller_task_instances(id) ON DELETE CASCADE,
  customer_phone text,
  customer_name text,
  customer_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  contacted boolean NOT NULL DEFAULT false,
  contacted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_task_contacts TO authenticated;
GRANT ALL ON public.pos_task_contacts TO service_role;
ALTER TABLE public.pos_task_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage task contacts" ON public.pos_task_contacts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_task_contacts_instance ON public.pos_task_contacts(instance_id);

-- E) Agendamentos de disparo de template no WhatsApp pessoal
CREATE TABLE IF NOT EXISTS public.pos_task_dispatch_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  name text,
  template_name text NOT NULL,
  template_language text NOT NULL DEFAULT 'pt_BR',
  whatsapp_number_id uuid,
  template_variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  target text NOT NULL DEFAULT 'all_sellers', -- all_sellers | managers
  send_times text[] NOT NULL DEFAULT '{}', -- horários "HH:MM"
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_task_dispatch_schedules TO authenticated;
GRANT ALL ON public.pos_task_dispatch_schedules TO service_role;
ALTER TABLE public.pos_task_dispatch_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage task dispatch schedules" ON public.pos_task_dispatch_schedules
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_pos_task_dispatch_schedules_updated
  BEFORE UPDATE ON public.pos_task_dispatch_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger: ao concluir todos os contatos, conclui a instância automaticamente
CREATE OR REPLACE FUNCTION public.sync_task_instance_progress()
RETURNS TRIGGER AS $$
DECLARE
  v_instance_id uuid;
  v_count integer;
  v_target integer;
BEGIN
  v_instance_id := COALESCE(NEW.instance_id, OLD.instance_id);
  SELECT count(*) INTO v_count FROM public.pos_task_contacts
    WHERE instance_id = v_instance_id AND contacted = true;
  SELECT progress_target INTO v_target FROM public.pos_seller_task_instances
    WHERE id = v_instance_id;
  UPDATE public.pos_seller_task_instances
    SET progress_current = v_count,
        status = CASE WHEN v_count >= COALESCE(v_target,1) THEN 'completed' ELSE 'pending' END,
        completion_mode = CASE WHEN v_count >= COALESCE(v_target,1) THEN 'auto' ELSE completion_mode END,
        completed_at = CASE WHEN v_count >= COALESCE(v_target,1) THEN now() ELSE NULL END,
        updated_at = now()
    WHERE id = v_instance_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_sync_task_instance_progress
  AFTER INSERT OR UPDATE OR DELETE ON public.pos_task_contacts
  FOR EACH ROW EXECUTE FUNCTION public.sync_task_instance_progress();