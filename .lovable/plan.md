## Objetivo
Fazer a tela **Marketing > Grupos VIP > Configurar Grupos em Massa** funcionar para campanhas em qualquer provedor (uazapi, Z-API, WaSender), respeitando a regra de ouro do projeto: **a conversa/operação roteia pelo provider REAL da instância**, nunca assume Z-API.

## Causa raiz (confirmada no banco)
- Campanha LIVE usa instância `provider = uazapi`; os 3 grupos são uazapi.
- `CampaignBulkSettings.tsx` chama sempre `zapi-group-settings` (Z-API).
- Nas ações Nome/Foto/Descrição/Permissões o componente nem envia `whatsapp_number_id` → resolve para Z-API errado/ausente.
- Na ação Fixar, envia o id uazapi, mas `resolveZApiCredentials` filtra `provider='zapi'` → erro.
- Resultado: 0/3 em tudo.

## Estratégia (sem quebrar Z-API existente)
Rotear por provider, igual ao padrão já usado no PDV (`posWhatsappSend` / `uazapi-send-buttons`). O front descobre o provider de cada grupo (via `instance_id` do grupo, não só o da campanha) e chama a edge function certa.

### 1. Backend — completar `uazapi-groups`
Adicionar as ações que faltam, espelhando o contrato do `zapi-group-settings` mas usando os endpoints uazapi (Instance Token):
- `updateName` → `/group/updateName` (ou equivalente uazapi: `{ groupjid, name }`)
- `updateDescription` → `/group/updateDescription` `{ groupjid, description }`
- `updatePhoto` → `/group/updateImage` `{ groupjid, image }`
- `updateSettings` (permissões) → `/group/updateSettings` para `messagesAdminsOnly` e `editAdminsOnly`
- `pinMessage` → enviar texto (já existe sendMessage) + ação de pin do uazapi

Observação: validar os nomes exatos dos endpoints uazapi na doc antes de implementar (alguns variam por versão). Onde a uazapi não suportar uma ação, retornar erro claro em vez de falhar silencioso.

### 2. Backend — `wasender-groups` (paridade)
Verificar se `wasender-groups` cobre as mesmas ações; se a campanha um dia for WaSender, adicionar o que faltar. (Hoje a campanha LIVE é uazapi, então prioridade é uazapi.)

### 3. Frontend — `CampaignBulkSettings.tsx` (roteamento por provider)
- Ao carregar, buscar os grupos **com `instance_id`** e o `provider` de cada instância (join em `whatsapp_numbers`).
- Criar um helper `applyGroupSetting(group, action, payload)` que:
  - lê o provider do `instance_id` do grupo;
  - chama `uazapi-groups` / `zapi-group-settings` / `wasender-groups` conforme o provider;
  - **sempre** passa `whatsapp_number_id = group.instance_id` (corrige o bug de não enviar o id nas ações de nome/foto/descrição/permissão).
- Mapear os nomes de ação atuais para os de cada provider (ex.: `update-name`→uazapi `updateName`).
- Manter o caminho Z-API atual intacto (grupos cujo provider for `zapi`).
- Para Fixar: usar `uazapi-send-message`/`uazapi-groups sendMessage` quando uazapi, e a sequência atual quando zapi.

### 4. Tratamento de erro / UX
- Trocar os `catch {}` silenciosos por captura da mensagem real e mostrar no toast (ex.: "2/3 — falha no grupo #10: <motivo>").
- Logar resposta da edge function para diagnóstico futuro.

### 5. Validação
- Rodar Nome/Descrição/Foto/Permissão/Fixar na campanha LIVE (uazapi) e confirmar 3/3.
- Confirmar que uma campanha Z-API (se existir) continua funcionando.
- Conferir logs das edge functions `uazapi-groups`.

## Arquivos afetados
- `supabase/functions/uazapi-groups/index.ts` (novas ações)
- `supabase/functions/wasender-groups/index.ts` (paridade, se necessário)
- `src/components/marketing/CampaignBulkSettings.tsx` (roteamento por provider + envio do instance_id + erros)
- Possível helper compartilhado de roteamento de grupo (opcional, espelhando `posWhatsappSend`).

## Riscos e mitigação
- **Risco:** nomes de endpoints uazapi incorretos. **Mitigação:** validar na doc uazapi e testar grupo a grupo antes de aplicar em massa.
- **Risco:** quebrar fluxo Z-API atual. **Mitigação:** roteamento aditivo — Z-API só é chamado quando o grupo é `provider='zapi'`; nenhum código Z-API existente é removido.
- **Nada no banco/schema muda** — somente edge functions e frontend.
