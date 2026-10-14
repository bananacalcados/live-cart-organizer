# Roleta individual ao vivo no Overlay + prêmios no pedido e na Ficha

Já corrigido: o campo "Pagou em até (min)" agora aparece também ao criar uma roleta nova (antes só aparecia depois de salvar).

## O que a equipe vai ver

1. **Lista de quem pode girar** — dentro de cada roleta, na aba Roleta do evento, aparece a lista das clientes que se encaixam na regra (ex.: pagou o 1º pedido em até X min, compra mínima). Cada linha mostra @, valor pago, tempo que levou para pagar e se já girou.
2. **Botão GIRAR AO VIVO** em cada cliente — o sistema sorteia o prêmio na hora (mesma chance configurada) e registra para aquela cliente. Quem já usou todos os giros fica marcado "Já girou" com o prêmio ao lado.
3. **No Overlay (OBS)** — aparece um bloco "Roleta" com o @ da cliente e o texto do prêmio trocando rápido entre os prêmios da roleta por uns 6 segundos, desacelerando até parar no prêmio sorteado, que fica em destaque por alguns segundos. O bloco pode ser ligado/desligado e arrastado na tela "Overlay da Live", como os outros.
4. **Prêmio físico** (ex.: "Bolsa") — entra como item no pedido da cliente naquela live, com o nome escrito na roleta e preço R$ 0, e aparece na Expedição do PDV junto com os produtos para não esquecer de enviar. Usa o ciclo de prêmio físico que já existe (reservado → enviado).
5. **Desconto %, R$ ou frete grátis** — aparece na aba **FICHA** do chat da Live e no chat do WhatsApp do PDV, junto do cashback, com nome do prêmio, código e validade, para usar numa próxima compra.

## Regras
- Só a equipe logada consegue girar pelo painel; a cliente não precisa fazer nada.
- O sorteio é feito no servidor e não pode girar duas vezes para a mesma cliente além do limite.
- Se a cliente não tiver pedido na live, o prêmio físico fica registrado e aparece no próximo pedido dela.
- O overlay continua sem acessar pedidos, clientes ou comentários: recebe só o @ e o resultado.

## Detalhes técnicos
- `event-prize-wheel`: novas ações `eligible_list` (paginada, teto 200, staff via JWT) e `staff_spin` (JWT de equipe, reaproveita a mesma validação e criação em `customer_prizes`).
- Overlay: novo kind `wheel_spin` em `live_overlay_events` com payload `{handle, labels[], winner_label}`; novo bloco `wheel` em `config.layout` e `config.wheel` (enabled, duração); `overlay_pull` já entrega eventos.
- Prêmio físico: inserir item de prêmio no pedido do evento da cliente (preço 0, marcado como prêmio), sem baixa de estoque, ligado a `customer_prizes`; Expedição exibe com etiqueta "PRÊMIO".
- Ficha: `OrderCashbackBox` e o painel do WhatsApp do PDV passam a listar `customer_prizes` ativos não físicos do telefone (consulta por telefone, poucas colunas).
- Consultas novas: 1 ao abrir a lista de elegíveis (manual, sem polling); 1 por giro; 1 na Ficha ao abrir a conversa.
