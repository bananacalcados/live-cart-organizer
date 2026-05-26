# Plano: Canais Alternativos de Contato com Cliente da Live

Hoje toda mensagem da Live sai via Z-API (`live-campaign-dispatch`). Vamos adicionar **2 canais alternativos**, escolhidos por campanha (ou por lead, conforme origem). A fila de despachos (`live_campaign_dispatches`) continua sendo o coração — só muda o "transporte" no momento do envio.

---

## Diagnóstico do que já existe

- `live-campaign-dispatch` envia tudo via Z-API (`zapi-send-message` / `zapi-send-media`).
- `instagram-dm-send` **já funciona**: manda DM via Meta Graph (`graph.instagram.com`), com fallback `private_reply` para comentário recente. Usa `META_PAGE_ACCESS_TOKEN` e a tabela `instagram_user_links` (username → ig_user_id).
- `instagram-send-bulk-dm` já existe (envio em lote, similar). 
- `meta-whatsapp-send-template` + `meta-whatsapp-get-templates` já existem (WABA oficial). Templates já são listáveis no projeto.
- `live_campaign_messages` hoje só tem `message_type` (text/audio/video/image) + `content/media_url/caption`. **Não tem campo de canal nem de template_name.**

---

## Opção 1 — Instagram DM (para leads vindos do IG)

### Como funciona
Quando o lead entrou na Live via comentário do Instagram (Livete Anotador), já temos `ig_user_id` ou `username` salvo. Hoje a Live só dispara WhatsApp — vamos permitir que a campanha (ou só esses leads IG) saiam via DM do Instagram.

### Limitações da Meta a respeitar
- **Janela 24h**: só pode mandar DM se o usuário interagiu nas últimas 24h. Para Live isso é ok (acabou de comentar).
- **Fora da janela**: precisa de `comment_id` recente (private_reply) — já temos fallback.
- **Mídia**: imagem/vídeo/áudio funcionam via `attachment` (já implementado parcialmente em `instagram-dm-send`; expandir para os 4 tipos).

### Mudanças
1. **Schema**: adicionar em `live_campaign_dispatches`:
   - `channel text default 'whatsapp'` ('whatsapp' | 'instagram')
   - `ig_user_id text` (opcional) e `ig_comment_id text` (opcional, p/ fallback)
2. **Schema**: adicionar em `live_campaigns`:
   - `channel_preference text default 'whatsapp'` ('whatsapp' | 'instagram' | 'auto') — `auto` = usa IG quando o lead veio do IG, senão WhatsApp.
3. **`live-campaign-trigger`** (cria a fila): ao enfileirar, se a origem do lead for IG (ou `channel_preference='instagram'`), grava `channel='instagram'` e preenche `ig_user_id`/`ig_comment_id` a partir dos dados do comentário.
4. **`live-campaign-dispatch`**: branch no envio — se `channel='instagram'`, chama `instagram-dm-send` com `{ ig_user_id, message, fallbackCommentId, mediaUrl, mediaType }`. Salvar `whatsapp_messages` (já faz) para aparecer no histórico unificado.
5. **UI da campanha (Live)**: switch "Canal de envio" com 3 opções (WhatsApp / Instagram / Auto). Mostrar aviso da janela 24h.
6. **Teste end-to-end** numa Live de teste: pegar 1 comentário real, disparar campanha em modo IG, validar entrega + histórico no chat.

---

## Opção 2 — Meta WhatsApp Cloud API (Templates oficiais)

### Como funciona
A WABA (Cloud API) **só permite iniciar conversa via template aprovado**. Depois que o cliente responde, abre janela 24h e dá pra mandar texto livre. Ou seja: o **primeiro disparo** da Live precisa ser um template; o Jess Mode/follow-up continua igual após resposta.

### Limitações
- Texto/imagem/vídeo dentro do template seguem o que foi aprovado pela Meta. Variáveis ({{1}}, {{2}}, etc.) preenchidas no momento do envio.
- Sem `comment_id` ou similar — qualquer telefone pode receber template (desde que opt-in implícito da Live).
- Não dá pra mandar áudio como template (limitação Meta). Áudio fica só para mensagens dentro da janela 24h.

### Mudanças
1. **Schema** — adicionar em `live_campaign_messages`:
   - `meta_template_name text` (quando preenchido, a "mensagem" é um template Meta)
   - `meta_template_language text default 'pt_BR'`
   - `meta_template_variables jsonb` (mapeia {{1}} → `lead.first_name`, {{2}} → `checkout_link`, etc.)
2. **Schema** — em `live_campaigns`: já tem `whatsapp_number_id`. Adicionar opção `channel_preference='meta_whatsapp'`.
3. **UI — editor de mensagens da campanha**:
   - Toggle "Usar template Meta oficial"
   - Quando ligado: dropdown carregando `meta-whatsapp-get-templates` (filtra `status=APPROVED`), preview do template, e campos para mapear variáveis a partir de placeholders fixos (`{{nome}}`, `{{checkout_link}}`, `{{produto}}`, etc.).
4. **`live-campaign-dispatch`**: branch — se `meta_template_name` setado, chama `meta-whatsapp-send-template` com variáveis resolvidas (substituindo placeholders pelos dados do lead/pedido).
5. **Follow-up**: o disparo de template inicia a conversa. Quando o cliente responder (webhook `meta-whatsapp-webhook`), abrir janela 24h — Jess Mode/Bia podem mandar texto livre normalmente via `meta-whatsapp-send`. Já temos esse caminho; só precisa garantir que a sessão Jess seja ativada também por resposta a template (não só ao fim da fila Z-API).
6. **Criação de templates novos**: já existe `MetaTemplateCreator.tsx` + `meta-whatsapp-create-template`. Bom orientar criar 1-2 templates específicos para Live (ex: `live_carrinho_separado` com header IMAGE + body com nome e link).

---

## Estratégia de Rollout (ordem sugerida)

1. **Migration única** com todos os campos novos (`channel`, `ig_user_id`, `ig_comment_id`, `meta_template_*`, `channel_preference`).
2. **Backend dispatch**: branchs no `live-campaign-dispatch` (Instagram + Meta Template). Manter Z-API como default.
3. **Trigger**: `live-campaign-trigger` passa a popular `channel` e `ig_*` quando aplicável.
4. **UI Campanhas Live**: selector de canal + editor de template.
5. **Teste piloto** com 1 campanha em cada canal antes de migrar tudo.
6. **Painel** simples mostrando taxa de entrega por canal (Z-API vs IG DM vs Meta Template) para você decidir quando ativar fallback automático.

---

## Recomendação tática (para o problema do banimento agora)

- **Curto prazo (esta semana)**: implementar **Opção 1 (Instagram DM)** primeiro — risco zero, já temos toda a infra Meta funcionando, e cobre 100% dos leads que vieram comentando na Live do IG.
- **Médio prazo**: implementar **Opção 2 (Meta WhatsApp template)** — exige aprovar 1-2 templates na Meta (24-48h), mas é o canal mais escalável e não banível. Vira o canal principal da Live.
- **Z-API**: manter como fallback para leads que vieram só por telefone (WhatsApp orgânico) ou enquanto a aprovação dos templates não sai.

---

## Detalhes técnicos (resumo)

**Migration:**
```sql
ALTER TABLE live_campaign_dispatches
  ADD COLUMN channel text NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN ig_user_id text,
  ADD COLUMN ig_comment_id text;

ALTER TABLE live_campaigns
  ADD COLUMN channel_preference text NOT NULL DEFAULT 'whatsapp';
  -- valores: 'whatsapp' | 'instagram' | 'meta_whatsapp' | 'auto'

ALTER TABLE live_campaign_messages
  ADD COLUMN meta_template_name text,
  ADD COLUMN meta_template_language text DEFAULT 'pt_BR',
  ADD COLUMN meta_template_variables jsonb;
```

**Dispatch (pseudocódigo):**
```ts
if (d.channel === 'instagram') {
  await invoke('instagram-dm-send', { ig_user_id: d.ig_user_id, message, fallbackCommentId: d.ig_comment_id, mediaUrl, mediaType });
} else if (msg.meta_template_name) {
  await invoke('meta-whatsapp-send-template', {
    to: d.phone,
    template_name: msg.meta_template_name,
    language: msg.meta_template_language,
    variables: resolveVars(msg.meta_template_variables, lead),
    whatsapp_number_id: camp.whatsapp_number_id,
  });
} else {
  // Z-API atual
}
```

Confirma este plano? Se sim, começo pela **migration + Opção 1 (Instagram)** que já está 80% pronta, depois sigo para Opção 2 (templates).
