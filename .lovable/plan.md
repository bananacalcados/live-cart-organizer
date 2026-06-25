# Plano: Construtor de Automações de Carrossel (Online > Automações)

## Diagnóstico

O backend já está pronto e funcionando:
- `campanhas_auto` guarda TODA a configuração da campanha (template, textos com variáveis, filtro, limite diário `qtd_por_dia`, dias da semana `dias_semana`, cooldown `cooldown_dias`, rodízio de vendedora, `ativa`).
- `campanha_cards` guarda os cards (imagem + legenda) — a quantidade de cards "ok" escolhe automaticamente o template aprovado certo.
- `campanha_envios` é a fila de disparo.
- As funções `resolve_campaign_template` e `select_campaign_batch` e as edge functions `carousel-campaign-scheduler` (agenda por dia da semana) e `carousel-campaign-sender` (dispara respeitando limites/cooldown/retry) já operam sobre essas tabelas.

O que **não existe** é a interface para o operador montar e **iniciar** a campanha. Hoje a aba "Públicos" (`CampaignAudienceManager`) grava em `campanhas_auto`, mas só preenche nome + filtro + instância + modelo — sem cards, sem variáveis, sem agendamento e sem botão de iniciar. É exatamente essa peça que falta.

## Decisão de arquitetura: separar Público de Campanha

Hoje "público" e "campanha" estão na mesma tabela (`campanhas_auto`), o que confunde. Como você já criou públicos e quer "selecionar o público" ao montar a automação, vou separar:

- Nova tabela leve `campanha_publicos` (id, nome, filtro_json) = só o público reutilizável.
- Migração: os registros que você criou como "públicos" (inativos, sem cards) passam para `campanha_publicos`.
- `campanhas_auto` ganha `publico_id` (referência ao público escolhido). O disparo continua lendo o filtro — `select_campaign_batch` passa a usar o `filtro_json` do público vinculado (com fallback para o filtro próprio, mantendo o legado).
- A aba "Públicos" passa a gravar em `campanha_publicos` (não cria mais campanha pela metade).

## O que será construído

### 1) Nova aba "Automações" no hub (`POSOnlineHub.tsx`)
Três abas: **Automações** (novo, padrão) · **Templates** · **Públicos**.

### 2) Lista de automações (`CampaignList.tsx`, novo)
- Lista campanhas de `campanhas_auto` com: nome, público, instância, status (Ativa/Pausada), nº de cards prontos, resumo do agendamento.
- Ações: **Nova automação**, Editar, Pausar/Ativar (toggle `ativa`), Excluir, e um resumo de envios (enviados/pendentes/falhas a partir de `campanha_envios`).

### 3) Construtor da automação (`CampaignBuilder.tsx`, novo)
Fluxo em seções, salvando em `campanhas_auto` + `campanha_cards`:

1. **Instância Meta + Modelo de template**
   - Seletor de instância (só Meta ativas) e de modelo aprovado (reusa a lógica de `CampaignAudienceManager.loadModels`).
   - Só mostra modelos que tenham templates **aprovados** para a instância.

2. **Cards (imagens + legendas)**
   - Para cada card: botões **Subir do PC** e **Subir do site** (Shopify) — reusa `ImageCropDialog` (crop 1:1 da miniatura) e `ProductSelector`, já existentes.
   - Legenda por card via `VariableTextField` (já existe: inserção de variáveis + emojis).
   - Adicionar/remover cards (2 a 10). A contagem de cards "ok" define o template usado.
   - Valida que a quantidade de cards casa com um template aprovado do modelo (mostra aviso se não houver template aprovado para aquela contagem).

3. **Texto/variáveis**
   - Corpo do topo (`top_body`) e corpo do card (`card_body`) via `VariableTextField`, com as variáveis padrão (`{{nome}}`, `{{tamanho}}`, `{{vendedora}}`, texto livre) e emojis.

4. **Público**
   - Seletor de público (`campanha_publicos`) com contagem estimada em tempo real (reusa `count_campaign_audience`). Atalho "Criar/editar público" abre o builder de público.

5. **Agendamento e limites**
   - **Limite diário** (`qtd_por_dia`) — input numérico.
   - **Dias da semana** (`dias_semana`) — toggles Dom–Sáb.
   - **Cooldown** (`cooldown_dias`) — quantos dias até a mesma pessoa poder receber de novo.
   - **Rodízio de vendedora** (`rodizio_vendedora` + `vendedoras_rodizio`) — opcional.

6. **Iniciar automação**
   - Botão **Iniciar automação** grava `ativa = true` (e Pausar grava `false`). Validações antes de ativar: instância + modelo + ≥2 cards prontos + público selecionado + ≥1 dia da semana + limite ≥ 1.

## Detalhes técnicos / arquivos

- Migração (tool de migração):
  - `CREATE TABLE public.campanha_publicos (id, nome, filtro_json, created_at, updated_at)` + GRANTs + RLS + trigger updated_at.
  - `ALTER TABLE campanhas_auto ADD COLUMN publico_id uuid REFERENCES campanha_publicos(id)`.
  - Backfill: mover registros "público" existentes de `campanhas_auto` para `campanha_publicos` (feito via tool de insert, não migração).
  - Recriar `select_campaign_batch` para usar o filtro do `publico_id` quando houver (fallback ao `filtro_json` próprio).
- Front (novos): `src/components/pos/automation/CampaignList.tsx`, `CampaignBuilder.tsx`, `CampaignCardsEditor.tsx`.
- Front (alterados): `POSOnlineHub.tsx` (nova aba), `audience/CampaignAudienceManager.tsx` (gravar em `campanha_publicos`).
- Reuso: `ImageCropDialog`, `ProductSelector`, `VariableTextField`, `EmojiPickerButton`, RPC `count_campaign_audience`.
- Storage: imagens dos cards no bucket público já usado nos disparos (mesmo padrão do `AutomationFlowBuilder`).

## Validação
- Criar uma automação completa (5 cards, variáveis, público tamanho 34, limite 50/dia, seg–sex, cooldown 30) e ativar.
- Rodar `carousel-campaign-scheduler` manualmente e confirmar enfileiramento em `campanha_envios`.
- Rodar `carousel-campaign-sender` e confirmar disparo + variáveis resolvidas + identificação do card no webhook.
- Confirmar que pausar zera novos enfileiramentos e que o público continua reutilizável entre automações.
