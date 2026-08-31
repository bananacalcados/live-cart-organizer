# SIMU ENVIOS — rastreio simulado na Expedição

Nova aba no módulo PDV > Expedição para criar rastreios simulados, com página pública no estilo Correios que evolui a localização automaticamente a cada 2 dias.

## Aba "SIMU ENVIOS" (interno)

Botão novo na barra de abas da Expedição (ao lado de Trocas/Chargebacks), com lista de simulações e botão "Nova simulação".

Formulário de criação/edição:
- Cliente (nome) e telefone — opcionais, só para identificação interna
- Pedido vinculado (opcional, busca por número)
- Cidade/UF de **origem** (postagem)
- Cidade/UF de **destino**
- **Cidades intermediárias**: lista livre, adicionar/remover/reordenar quantas quiser (arrastar ou setas)
- Data e hora da postagem
- Intervalo entre etapas: padrão 2 dias (editável)
- Status: ativa / pausada / entregue

Ao salvar, o sistema gera um **código de rastreio** (formato tipo `BC123456789BR`) e um link público copiável, com botão de enviar no WhatsApp.

Na lista: código, cliente, origem → destino, etapa atual (calculada), data prevista de entrega, ações (ver página, copiar link, editar, pausar, excluir).

Controles extras: "Avançar etapa agora" e "Marcar como entregue" para ajustes manuais.

## Página pública `/rastreio/:codigo`

Layout limpo estilo Correios, isolado do sistema:
- Cabeçalho com o código do objeto e situação atual ("Objeto em trânsito")
- Linha do tempo vertical, do evento mais recente para o mais antigo:
  - `Objeto postado` — cidade de origem, data da postagem
  - `Objeto em trânsito - de <cidade A> para <cidade B>` — uma entrada por cidade intermediária
  - `Objeto saiu para entrega ao destinatário` — cidade destino
  - `Objeto entregue ao destinatário`
- Cada evento com data/hora e local (Cidade/UF)
- Só aparecem os eventos cuja data já passou; os futuros ficam ocultos
- Sem chat interno, sem prompt de instalação do app, sem cabeçalho/menu do sistema

A rota é pública e fica fora dos wrappers que injetam o chat de equipe e o InstallPrompt.

## Como a progressão funciona

Nada de cron: a linha do tempo é **calculada na hora da leitura** a partir da data de postagem + intervalo (2 dias) × índice da etapa. Isso mantém a página sempre coerente e sem job em segundo plano. Se o operador clicar em "Avançar etapa agora", a data de postagem é ajustada para refletir a nova etapa.

Horários dos eventos recebem minutos pseudo-aleatórios determinísticos (derivados do código) para parecerem naturais.

## Detalhes técnicos

- Tabela `public.shipment_simulations`: código único, cliente, telefone, order_id opcional, origem (cidade/uf), destino (cidade/uf), `stops` (jsonb — lista ordenada de cidades), `posted_at`, `step_interval_days` (default 2), `status`, `manual_offset_days`, timestamps + trigger de updated_at.
- GRANTs: `authenticated` com CRUD completo, `service_role` total; **sem** acesso `anon` à tabela.
- Leitura pública via edge function `shipment-tracking-public` (verify_jwt = false), que recebe o código e devolve apenas os eventos já ocorridos — nenhum dado sensível do pedido.
- Frontend: `src/components/expedition/ShipmentSimulations.tsx` (aba) + `src/pages/PublicTracking.tsx` (rota pública), com a lógica de geração de eventos em `src/lib/shipmentSimulation.ts` compartilhada.
- Rota `/rastreio/:codigo` adicionada acima do catch-all em `App.tsx`.
