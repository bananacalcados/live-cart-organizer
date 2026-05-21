
## Respostas diretas às suas 6 perguntas

### 1) Índices do `whatsapp_messages` quebram o PDV?
**Não.** Os 4 índices marcados para drop têm **0 scans** (`pg_stat_user_indexes.idx_scan = 0`). Por definição, nada no sistema (PDV ou outros) está usando esses índices hoje — o planner do Postgres só usa índice que foi efetivamente consultado.

O índice `idx_whatsapp_messages_mass_dispatch_message_id` (14 MB, 12 scans) **fica preservado** porque é usado pelo webhook Meta. Os índices core (`created_at`, `phone_number`, `instance_id`, FK do contato) também ficam.

➡️ **Risco zero** para o PDV e demais módulos.

---

### 2) `dispatch_recipients` — preserva ROI histórico de campanhas?
**Sim, há risco.** Confirmei que duas Edge Functions ativas dependem dessa tabela para calcular vendas geradas por disparo:
- `dispatch-attribution` (janela configurável via `window_days`)
- `marketing-attribution-dashboard` (default 7 dias, mas pode usar `date_from`/`date_to` livres)

**Avaliação de ganho real:**
- Tabela hoje: **46 MB / 217k linhas**, 120k linhas >30 dias.
- Se mover >90d pra arquivo: economia de ~25 MB (~50% da tabela).
- **Mas** as queries de atribuição teriam que fazer `UNION` com o arquivo → mais complexo, mais lento, e como hoje a janela default é 7d, raramente o ROI é consultado em disparos >90d.

➡️ **Recomendo NÃO arquivar `dispatch_recipients` agora.** O ganho (25 MB) não compensa o aumento de complexidade nas duas Edge Functions críticas de ROI. Melhor manter intacto e reavaliar quando passar de 100 MB. Apenas dropar o índice subutilizado `idx_dispatch_recipients_phone` (3.4 MB).

---

### 3) `automation_pending_replies` (mesma regra do #2)
Verificado: tabela é puramente **operacional** (controla pendências de fluxos ativos). Edge functions `cron-automation-timeouts` e `meta-whatsapp-webhook` só leem registros com `is_active=true` e `expires_at` futuro. **Nada de relatório/ROI** depende de pendings expirados.

➡️ **Pode deletar** os 25k registros expirados (>30d e `expires_at < now()`). Ganho: ~15 MB.

---

### 4) `automation_dispatch_sent` (mesma regra do #2)
Verificado: tabela serve como **cooldown anti-reenvio**. `automation-dispatch-audience` consulta últimos envios pra não disparar de novo no mesmo fluxo. Registros >90d **nunca mais** influenciam decisão de envio (cooldowns máximos são bem menores).

➡️ **Pode deletar** registros >90d. Ganho: ~5 MB. Drop do índice `idx_automation_dispatch_phone` (0 scans).

---

### 5) Demais quick-wins
Procede: dropar 4 índices zero-scan do `whatsapp_messages` + 1 do archive + deletar `chat_finished_conversations >30d`. Ganho total: ~20 MB.

---

### 6) Zoppy — situação real
Identifiquei o seguinte:

- **Tabelas `zoppy_customers` / `zoppy_sales` / `zoppy_sync_log` SÃO seu CRM atual.** Estão sendo usadas por **30+ arquivos** (POS, AI agents, Marketing, CRM dedup, atribuição, etc.). **NÃO podem ser deletadas** — vão derrubar todo o sistema. O nome "zoppy" é só legado de quando você usava a plataforma.

- **Edge Function `zoppy-sync-customers` tem 2 modos:**
  - `mode: 'from_api'` → puxa da API externa Zoppy. **Esse sim pode sumir.**
  - `mode: 'calculate_rfm'` → roda RPC local `calculate_rfm_scores()`. **Esse é usado ativamente** pelo POS, AI Agents, importação Excel, e `sync-pos-shopify-to-rfm`.

- **Edge Function `zoppy-sync-sales`** → 100% puxa da API externa. **Pode deletar.**

➡️ **Plano:** renomear a lógica de RFM pra uma função nova `rfm-recalculate` (cópia limpa do modo `calculate_rfm`), atualizar os 4 call-sites pra apontar pra ela, e então deletar `zoppy-sync-customers`, `zoppy-sync-sales`, remover botões "Sincronizar Vendas Zoppy" do `Marketing.tsx` e o secret `ZOPPY_API_TOKEN`.

---

## Plano de execução (ordem segura)

### Etapa A — Drops de índices e deletes seguros (~40 MB)
```sql
-- 1. Drop índices zero-scan do whatsapp_messages
DROP INDEX IF EXISTS idx_whatsapp_messages_status;
DROP INDEX IF EXISTS idx_wm_sender_user_id;
DROP INDEX IF EXISTS idx_whatsapp_messages_source_created;
DROP INDEX IF EXISTS idx_whatsapp_messages_channel;
DROP INDEX IF EXISTS idx_wm_archive_phone_created;
DROP INDEX IF EXISTS idx_dispatch_recipients_phone;
DROP INDEX IF EXISTS idx_automation_dispatch_phone;

-- 2. Limpezas operacionais
DELETE FROM automation_pending_replies
  WHERE created_at < now() - interval '30 days'
    AND (expires_at IS NULL OR expires_at < now());

DELETE FROM automation_dispatch_sent
  WHERE created_at < now() - interval '90 days';

DELETE FROM chat_finished_conversations
  WHERE created_at < now() - interval '30 days';

-- 3. VACUUM ANALYZE pra reclamar espaço
VACUUM (ANALYZE) automation_pending_replies;
VACUUM (ANALYZE) automation_dispatch_sent;
VACUUM (ANALYZE) chat_finished_conversations;
VACUUM (ANALYZE) whatsapp_messages;
```

### Etapa B — Migração Zoppy → função RFM dedicada
1. Criar Edge Function `rfm-recalculate` (apenas roda `supabase.rpc('calculate_rfm_scores')`, sem token, sem fetch externo).
2. Atualizar 4 call-sites:
   - `src/pages/AIAgents.tsx:178`
   - `src/pages/Marketing.tsx:672` (botão "Calcular RFM")
   - `src/pages/Marketing.tsx:891` (pós-import Excel)
   - `supabase/functions/sync-pos-shopify-to-rfm/index.ts:450`
3. Remover do `Marketing.tsx` o botão "Sincronizar Vendas Zoppy" (linha 686) que não faz mais sentido.
4. Deletar Edge Functions `zoppy-sync-customers` e `zoppy-sync-sales` (via tool `supabase--delete_edge_functions`).
5. Deletar secret `ZOPPY_API_TOKEN`.
6. Verificar `cron.job` por entradas que invocam essas funções — remover se existirem.

**Importante:** `crm-dedup-customers` continua viva (opera só nas tabelas locais). Tabelas `zoppy_*` ficam intactas.

### Etapa C — NÃO fazer agora
- ❌ Arquivar `dispatch_recipients` (ganho não compensa risco/complexidade no ROI).
- ❌ Mexer em `marketing_contacts` (precisa investigação mais profunda em outro momento).

---

## Resumo de ganho estimado
| Item | Espaço liberado |
|---|---|
| 7 índices zero-scan | ~17 MB |
| DELETE pending_replies | ~15 MB |
| DELETE dispatch_sent >90d | ~5 MB |
| DELETE chat_finished >30d | ~3 MB |
| **Total Etapa A** | **~40 MB** |
| Etapa B (Zoppy code) | Limpeza de código, sem ganho de DB |

Confirma esse plano? Especialmente: (a) manter `dispatch_recipients` intacta (só dropar índice subutilizado) e (b) estratégia de criar `rfm-recalculate` em vez de deletar tudo da Zoppy.
