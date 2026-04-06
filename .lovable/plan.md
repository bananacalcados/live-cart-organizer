## Plano: Agente Jess nas Automações + Tags + Leads

### 1. Migration: Adicionar `tags` na `zoppy_customers`
- Adicionar coluna `tags TEXT[]` na tabela `zoppy_customers`
- Criar índice GIN para buscas eficientes por tag

### 2. Criar ferramentas (tools) novas no `_shared/ads-tools.ts`
Duas novas tools que a Jess poderá usar nas automações:

#### `tag_or_register_contact`
- Recebe: `phone`, `tag`, `campaign_name` (opcional), `name` (opcional)
- Lógica de decisão inteligente:
  1. Normaliza o telefone (E.164)
  2. Busca na `zoppy_customers` pelo telefone, considerando variações do 9º dígito (ex: 5533991955003 = 553391955003)
  3. **Se encontrar** → adiciona a tag no array `tags` do cliente existente
  4. **Se NÃO encontrar** → cria um registro na `ad_leads` vinculando à campanha pelo nome

#### `create_assistance_request`
- Já existe parcialmente no motor da Jess — reutilizar a tool que cria solicitações em `ai_assistance_requests`
- Permite transferir atendimento para vendedoras do PDV

### 3. Modificar `automation-ai-respond` para suportar modo Jess
- Adicionar um campo na configuração da automação (ex: `use_jess_agent: true`)
- Quando ativado, o agente usa o motor de tool calling da Jess em vez do chat simples
- O prompt configurado na automação **sobrepõe** o prompt padrão da Jess
- As tools disponíveis seriam um subconjunto controlado:
  - `tag_or_register_contact` (nova)
  - `create_assistance_request` (existente)
  - Outras tools da Jess ficariam **desabilitadas** (ex: `generate_checkout_link`, `save_lead_data`) a menos que o prompt indique o contrário

### 4. Lógica de match de telefone (9º dígito)
- Criar função utilitária reutilizável que compara telefones ignorando o 9º dígito
- Regra: Se DDI + DDD batem E os últimos 8 dígitos do número batem → é a mesma pessoa
- Usar na busca da `zoppy_customers` e também na `ad_leads`

### 5. UI: Campo de campanha na configuração da automação
- Na tela de automações (Marketing > Automações), adicionar campo para selecionar/nomear a campanha de leads
- Toggle para ativar "Modo Jess" na automação

### Fluxo exemplo:
1. Cliente responde à automação dizendo "quero ser avisada da próxima live"
2. Jess (via automação) recebe a mensagem com prompt customizado
3. Jess chama `tag_or_register_contact` com tag "quer_live"
4. Tool busca pelo telefone na zoppy_customers (com match flexível do 9º dígito)
5. Se encontrar → adiciona tag "quer_live" no cliente
6. Se não encontrar → cria lead na ad_leads com campaign vinculada
7. Jess responde ao cliente confirmando o interesse
