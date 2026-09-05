# Typebot com caminhos condicionais, campos padronizados e aviso de lead no PDV

## O que já existe hoje
O Typebot atual (Eventos > Typebots) já tem perguntas de nome, telefone, escolha única/múltipla, uma condição simples por pergunta (valores aceitos → encerra ou pula pra outra etapa, com mensagem de motivo) e grava respostas soltas num campo livre do lead (`custom_fields`), onde cada typebot inventa a própria "chave". É exatamente isso que gera colunas duplicadas.

## O que vamos construir

### 1. Catálogo de Campos de Lead (criados antes, valem para todos os typebots)
Nova sub-aba **Eventos > Typebots > Campos** para cadastrar campos padronizados uma única vez:
- Nome exibido, chave interna (ex.: `tamanho_calcado`), tipo e se é obrigatório.
- Tipos: texto livre, número, moeda (renda), CPF (com validação), telefone, endereço (CEP → rua, bairro, cidade/UF preenchidos automaticamente), sim/não, lista fixa (opções cadastradas aqui, ex.: tamanhos 33–44), lista múltipla, data.
- Campos essenciais já criados de fábrica: CPF, Endereço, Cidade/UF, Renda mensal, Trabalha?, Local de trabalho, Tamanho que calça.
- Campos podem ser desativados, nunca apagados se já tiverem respostas.

### 2. Construtor do Typebot passa a usar o catálogo
- Ao adicionar uma pergunta, escolhe-se **um campo do catálogo** em vez de digitar uma chave. Campos de lista já trazem as opções prontas; CPF/endereço/moeda já trazem máscara e validação no chat público.
- Continua possível criar pergunta "só de mensagem" (sem gravar nada).

### 3. Caminhos condicionais de verdade
Cada pergunta ganha regras "**Se a resposta for X → então**":
- Continuar normalmente
- Pular para a etapa Y
- **Encerrar e desqualificar** com mensagem de motivo (ex.: "Por enquanto o crediário é só para Governador Valadares…"), opcionalmente ainda salvando o lead como descartado
- Regras por tipo: para lista/sim-não compara valores; para número/moeda compara maior/menor que; para cidade compara texto (ex.: cidade = Governador Valadares).
- O construtor mostra um resumo visual "Pergunta → destino" para conferir os caminhos.

### 4. Ficha do lead padronizada
- As respostas ficam salvas no lead por chave do catálogo. Na lista/detalhe de leads do typebot, cada campo vira uma coluna própria com filtro, e a exportação CSV sai com essas colunas.
- Leads desqualificados aparecem separados, com o motivo.

### 5. Aviso no WhatsApp do PDV + abertura de chat
Ao captar um lead qualificado (typebot ou LP):
- Por typebot, escolhe-se a **instância de WhatsApp do PDV** e a **loja** responsável.
- O sistema envia ao lead a primeira mensagem (texto configurável com variáveis como `{nome}`, `{tamanho_calcado}`) por essa instância, o que cria a conversa no chat do PDV.
- O card entra na linha **Novas mensagens** com etiqueta "Lead Crediário" e um resumo dos campos captados (CPF, renda, cidade, tamanho) visível ao abrir a conversa.
- Respeita opt-out/bloqueio e horário de silêncio já existentes.

## Fora do escopo desta etapa
Análise de crédito, integração com bureau, e a criação do crediário em si.

## Detalhes técnicos
- Novas tabelas: `lead_field_definitions` (key, label, type, options jsonb, required, active, sort_order) e `lead_field_values` opcional para consultas; respostas continuam também em `event_leads.custom_fields` (compatível com o que já existe). GRANTs + RLS para `authenticated`.
- `flow_json` das etapas ganha `field_id` (referência ao catálogo) e `rules: [{ operator, value, action, target_step_id, message, save_disqualified }]`; o formato antigo (`field_key` + `condition`) continua funcionando (migração automática ao abrir no construtor).
- `EventTypebotView` (chat público): novos inputs por tipo (máscara CPF com `isValidCpf`, CEP via ViaCEP, moeda), avaliação das regras por operador.
- `event-lead-capture`: valida respostas contra o catálogo, grava por chave, e para leads qualificados enfileira `automation_message_queue` (instância/loja do typebot) usando a fila anti-spam já existente; a conversa nasce em `whatsapp_messages` com `event_id`/tag de lead, exibida no PDV via lane "Novas mensagens".
- `event_typebots` ganha `notify_wa_number_id`, `notify_store_id`, `notify_message`.
- Typebots sem evento (crediário) já são suportados pela rota `/typebot/:slug`; leads ficam com `event_id` nulo e passam a aparecer no painel de leads da aba Typebots.
