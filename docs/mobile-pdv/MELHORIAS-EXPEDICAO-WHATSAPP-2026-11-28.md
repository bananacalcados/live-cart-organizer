# Melhorias PDV mobile — Expedição (A) e WhatsApp (B) — 28/11

## Parte A — Expedição
- Lista paginada via RPC de leitura `mobile_pdv_expedition_ids_v2` (invoker/RLS, sem anon): loja opcional (null = todas), filtros forma de envio (all/moto/carrier/pickup/none, mesma regra do desktop sobre delivery_method||shipping_carrier) e origem (live/whatsapp/online, mesma regra de getOrigin). Ordem: SEDEX e Mototaxista primeiro, depois mais antigo (desktop não ordena assim; regra só mobile).
- Contadores: `pos_expedition_stage_counts(p_store_id null|loja)` — respeitam o filtro de loja.
- Tempo real: um ouvinte `sales_changed` por loja ativa no modo "todas", igual ao desktop. Sem polling.
- Regra pura `src/lib/pos/expeditionReadiness.ts`: etiqueta de frete, prioridade, "Dados completos/Faltando" (nome, telefone, CPF 11 díg., frete, CEP 8 díg. + logradouro/número/bairro/cidade/UF fora de retirada, pagamento), espelhando a gravação do ExpOrderEditDialog e expeditionShippingError.
- Seleção múltipla: mesmas exclusões do desktop (sem Conferência/Concluído, sem avulso incompleto). Avança pedido a pedido por `pos_expedition_transition` (mesmo modo do avanço individual) e mostra quantos avançaram e quais falharam com o motivo.
- Edição: detalhe em tela cheia + o MESMO ExpOrderEditDialog do desktop (mesma gravação), com a loja do próprio pedido.

## Parte B — WhatsApp com aparência do oficial
- Só aparência (whatsapp.css escopado + telas em src/mobile/pdv/whatsapp). Envio, Opção A, reenvio só manual: intocados (mesmo `send`/`useMobileSend`).
- Lista: título verde, busca em pílula, chips (Todas, Não lidas = linha "unread" do servidor, Instância e Linha abrem folha). Contador verde. Botão de nova conversa não existe no mobile hoje — não criado.
- Conversa: fundo bege com padrão SVG próprio, balões com rabinho, hora+tiques dentro, separador Hoje/Ontem, citação com barra lateral, responder por arrastar para a direita ou toque longo (seta saiu dos balões), áudio com play/onda/duração.
- Barra de escrever: pílula com emoji (painel de emojis simples), clipe e câmera; botão verde 48 px microfone ↔ enviar; folha de anexos (Documento, Câmera, Galeria, Áudio, Catálogo, Respostas rápidas, Modelos API na Meta). Gravação: tempo correndo, lixeira cancela, botão verde envia (toque explícito).
- Botão amarelo de tarefas (admin) fica oculto só nas telas do WhatsApp mobile.
