

# Plano: Integração para Agente de IA de Recuperação de Carrinho

## Contexto

Existem **duas tabelas de leads** com dados complementares:
- **`catalog_lead_registrations`** — leads do catálogo/checkout (tem `cart_items`, `cart_total`, `status`)
- **`lp_leads`** — leads do marketing/automação (tem `metadata` JSONB, recebe dados do Shopify Growth Suite via `automation-trigger-new-lead`)

O agente de IA precisa consultar leads de ambas as fontes.

---

## Alterações

### 1. Migration — Adicionar 6 colunas em `catalog_lead_registrations`

```sql
ALTER TABLE catalog_lead_registrations
  ADD COLUMN IF NOT EXISTS chosen_payment_method TEXT,
  ADD COLUMN IF NOT EXISTS pix_code TEXT,
  ADD COLUMN IF NOT EXISTS pix_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_disparo INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_ultimo_disparo_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_session_id TEXT;
```

### 2. Migration — Adicionar colunas de recovery em `lp_leads`

Para que o agente também rastreie disparos feitos para leads que só existem em `lp_leads`:

```sql
ALTER TABLE lp_leads
  ADD COLUMN IF NOT EXISTS recovery_disparo INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_ultimo_disparo_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_session_id TEXT;
```

### 3. Migration — RPC `get_leads_for_recovery`

Usa **UNION** entre as duas tabelas para não perder leads de nenhuma rota:

```sql
CREATE OR REPLACE FUNCTION get_leads_for_recovery()
RETURNS TABLE (
    id TEXT, source_table TEXT, phone TEXT, name TEXT,
    cart_items JSONB, cart_total DECIMAL,
    status TEXT, chosen_payment_method TEXT,
    pix_code TEXT, pix_expires_at TIMESTAMPTZ,
    recovery_disparo INTEGER, recovery_ultimo_disparo_at TIMESTAMPTZ,
    recovery_session_id TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER AS $$
  -- catalog_lead_registrations
  SELECT id::TEXT, 'catalog' as source_table,
    whatsapp as phone, instagram_handle as name,
    cart_items, cart_total, status,
    chosen_payment_method, pix_code, pix_expires_at,
    recovery_disparo, recovery_ultimo_disparo_at,
    recovery_session_id, created_at
  FROM catalog_lead_registrations
  WHERE status IN ('browsing','checkout_started')
    AND whatsapp IS NOT NULL AND cart_items IS NOT NULL
  UNION ALL
  -- lp_leads com dados de carrinho abandonado
  SELECT id::TEXT, 'lp_leads' as source_table,
    phone, name,
    (metadata->>'cartSummary')::jsonb as cart_items,
    (metadata->>'totalAmount')::decimal as cart_total,
    CASE WHEN metadata->>'chosen_payment_method' IS NOT NULL
         THEN 'checkout_started' ELSE 'browsing' END as status,
    metadata->>'chosen_payment_method',
    metadata->>'pix_code',
    (metadata->>'pix_expires_at')::timestamptz,
    recovery_disparo, recovery_ultimo_disparo_at,
    recovery_session_id, created_at
  FROM lp_leads
  WHERE source = 'abandoned_cart'
    AND phone IS NOT NULL
    AND converted = false
  ORDER BY created_at DESC LIMIT 500;
$$;
```

### 4. Migration — RPC `update_lead_recovery`

Aceita `source_table` para saber em qual tabela atualizar:

```sql
CREATE OR REPLACE FUNCTION update_lead_recovery(
    p_lead_id TEXT, p_source_table TEXT,
    p_disparo INTEGER, p_session_id TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_source_table = 'catalog' THEN
    UPDATE catalog_lead_registrations
    SET recovery_disparo = p_disparo,
        recovery_ultimo_disparo_at = NOW(),
        recovery_session_id = p_session_id
    WHERE id::TEXT = p_lead_id;
  ELSE
    UPDATE lp_leads
    SET recovery_disparo = p_disparo,
        recovery_ultimo_disparo_at = NOW(),
        recovery_session_id = p_session_id
    WHERE id::TEXT = p_lead_id;
  END IF;
END; $$;
```

### 5. Migration — RPC `sync_lead_pix_data`

Para o agente sincronizar dados de PIX do `lp_leads` para `catalog_lead_registrations`:

```sql
CREATE OR REPLACE FUNCTION sync_lead_pix_data(
    p_whatsapp TEXT, p_chosen_payment_method TEXT,
    p_pix_code TEXT, p_pix_expires_at TIMESTAMPTZ
) RETURNS VOID LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE catalog_lead_registrations
  SET chosen_payment_method = p_chosen_payment_method,
      pix_code = p_pix_code,
      pix_expires_at = p_pix_expires_at
  WHERE whatsapp = p_whatsapp
    AND status IN ('browsing','checkout_started')
    AND created_at > NOW() - INTERVAL '24 hours';
$$;
```

### 6. Edge Function — Atualizar `automation-trigger-new-lead`

Na seção que monta o `metadata` (linhas 30-33), adicionar os 3 campos novos do payload:

```typescript
const { phone, name, email, campaignTag, recoveryUrl,
        cartSummary, totalAmount,
        chosen_payment_method, pix_code, pix_expires_at } = await req.json();

// dentro do bloco metadata:
if (chosen_payment_method) metadata.chosen_payment_method = chosen_payment_method;
if (pix_code) metadata.pix_code = pix_code;
if (pix_expires_at) metadata.pix_expires_at = pix_expires_at;
```

Nenhuma outra lógica é alterada.

---

## Resumo de arquivos

| Arquivo | Ação |
|---|---|
| Migration SQL | 6 colunas em `catalog_lead_registrations`, 3 colunas em `lp_leads`, 3 RPCs |
| `supabase/functions/automation-trigger-new-lead/index.ts` | Mapear 3 campos novos do payload para `metadata` |

Sem alterações de frontend — as RPCs são para consumo pelo agente de IA externo via REST API.

