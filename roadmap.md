# Rodada de ajustes — modo WhatsApp + Cadastro online

## Grupos — Fase C — 30/10
- [x] Resolver responsável em campanhas, agendamentos, administração, convites e envio avulso; preservar criação, textos e cadência.
- [x] Escolha por envio e resumo nas telas, chave reversível, travas e alertas de desconexão.
- [x] Testes de filas/reconexão/reversão/admin com rollback e envio real único Teste 235 pela Whats Carol (3EB046EAB884153CE155DD), histórico relido na tela; site não publicado. Não testados ao vivo: 2/3 instâncias, mídia, administração, criação e convite.

## Confirmação da Katia — 29/10
- [x] Conflito de telefone em leads isolado da confirmação; testes transacionais de colisão/idempotência passaram com rollback. Confirmação real das 16:27 recuperada pelo código e identidade exata do pedido/cadastro; resposta única marcada sent às 16:37:20. Sem publicar; leitura pela cliente não confirmada.

## Linhas da live — carrinhos em Novos Contatos — 29/10
- [x] Regressão corrigida: linha segue o canal aberto pelo card; comentário Instagram não sobrepõe resposta no WhatsApp. 14 testes passaram; Marina real saiu de Não Lidas para Aguardando, sem tag indevida; build OK. Sem consultas extras, publicação ou envio real de teste.
- [x] Cadastro do pedido exato preenche telefone só na exibição; carrinho com produtos/telefone supera etapa incompleta antiga, mensagens WhatsApp/Instagram usam sinais de leitura existentes. 17 testes passaram; tela autenticada confirmou Marina fora de Novos Contatos/Incompletos e em Não Lidas, sem duplicação. Sem consultas novas, escritas em clientes ou publicação; nova mensagem real não enviada nos testes.

## Pix — excesso de requisições — 29/10
- [x] Pedido a7d00f4a: logs e histórico confirmaram HTTP 400 payer.email (gmail.coml), não excesso de requisições. Corrigida normalização compartilhada sem alterar cadastro, e ficha passa a mostrar o erro real. Serviços Pix/boleto/cartão atualizados.
- [x] 21 testes passaram; uma única geração real após confirmar ausência de Pix vinculado retornou R$379,99 e ficou vinculada, pendente, sem pagamento/envio. Página pública abriu sem erro, mas formulário ainda carregava na captura; clique da ficha não foi repetido para evitar novo Pix. Crossell pausado até aprovação posterior; site não publicado.

## Crossell uazapi e atendimento nos Pagos — 29/10
- [x] Plano aprovado em 29/10 às 17:16 UTC: envio manual direto de blocos pela instância atual (uazapi/Meta), sem convite prévio; intervalo aleatório de 4–15 s entre blocos. Meta exige janela real de mensagem da cliente, não data da compra.
- [x] Pagos priorizam não lidas com os sinais existentes e atividade de todos os pedidos agrupados; clique principal abre WhatsApp, Ver pedidos/Unificar fica separado.
- [x] Editor com texto/fotos/arquivos/áudios/vídeos/botões, catálogo, prévia, ofertas reutilizáveis, ENVIAR pela instância selecionada e histórico; fila persistida isolada com 4–15s, cancelamento, bloqueios, janela Meta e revisão sem retry automático.
- [x] 19 testes e validação transacional com rollback (clique repetido, claim exclusivo, review, prazo, cancelamento, interesse). Navegador autenticado abriu Pagos/chat, montou todos os tipos, salvou e releu texto/botões; oferta temporária removida. Serviços atualizados, site não publicado; nenhum envio real.
- [ ] Entrega e clique reais, mídias reais e chegada simultânea de mensagem: aguardam número de teste autorizado. Interesse usa broadcast durante sessão e histórico persistido no editor; restauração da tag do card após recarga ainda não validada. Fase C dos grupos entregue nesta rodada.

## Expedição e estorno AustPay — 28/10
- [x] Correção definitiva: GET real CAPPTA/APPROVED/antecipação ativa, refunds vazio e ledger ausente; rota direta sem valor no integral, janela estimada 27/10 23:59:59, registro manual admin com senha no servidor e trava transacional, PDF manual, badges e falhas ocultas. Testes e prévia/tela real sem devolver nem registrar Adriana. Sexta D+1 útil fecha domingo (divergência no exemplo do pedido); janela desconhecida bloqueia. Registro/PDF manual real não executados por limite da tarefa.
- [x] Investigar 90 pagos: todos vinculados ao PDV, 89 ativos e Sandra cancelada; 62 vendas em Conferência e 27 em Separação. Contadores cortavam mil itens antigos; substituídos por consulta agregada indexada com permissões existentes. Navegador confirmou Adriana em Separação, Ilma em Conferência e novos totais; seis testes passaram, sem movimentar pedidos.
- [x] Integrar integral AustPay ao fluxo protegido, aprovação condicional atômica, acompanhamento sem repetição e comprovante após conclusão; prévia real da Adriana conferida no Novo estorno. Sem publicação, devolução ou mensagem real nos testes.
- [ ] Adriana: somente Matthews faz a devolução no painel e depois registra o protocolo no sistema; não executar estorno nem envio automático.

## Grupos WhatsApp — escopo corrigido 28/10
- [x] Reverter Bloco 2: visão removida, 203 linhas por instância e seleção/ações individuais restauradas; Bloco 1 preservado.
- [x] Bloco 3: VIP manual por group_jid_base, inicialmente desmarcado, relatórios VIP só is_vip=true; novas instâncias herdam somente marcação manual existente.
- [x] Dois testes passaram; tela real marcou quatro instâncias, recarregou e confirmou persistência, depois desmarcou todas; sem erros nem publicação. Só normalização dos cruzamentos e marcação VIP, motores de disparo preservados.

## Frete padrão do evento — 27/10
- [x] Aplicar regra do evento automaticamente nos pedidos de autoatendimento, preservando isenções e valores manuais; 12 regras verificadas na função instalada e teste de marcar/desmarcar com rollback.
- [x] Corrigir o pedido aberto do tênis sem frete definido desta live; carrinho real exibiu R$ 19,99 sem erros, sem cobrar nem publicar. Pagos, cancelados e tentativas vinculadas preservados.

## Direct do Instagram com link de cadastro — 27/10
- [x] Criar pedido pela conversa de Novos Contatos (botão Editar abre novo pedido com WhatsApp completo).
- [x] Direct automático com link único (5 variações em rodízio, botão CADASTRAR, 1 por @ por live, sem re-tentativa automática) + Reenviar direct nos Incompletos (máx. 2, 10 min). Envio real ao Instagram ainda não testado.

## Correios formatos de impressão — 27/10
- [x] Medir rótulo original do envio AP664805855BR: 1 página de aproximadamente 100×150 mm, sem A4 ou recorte necessário.
- [x] Gerar três formatos persistidos, impressão individual e lote com escolha lembrada; rótulo oficial e DANFE separada térmica, A4 com compatibilidade antiga.
- [x] Validar PDFs reais a 203 dpi: térmicas exatamente 100×150 mm (2/1 páginas), A4 1 página; objeto e chave NF-e decodificados em ambas, 15 testes passaram e build OK. Botão térmico real abriu PDF no navegador autorizado e lembrou formato, lotes 10×15/A4 retornaram PDFs. Sem pré-postagem nova nem publicar; impressão física na ELGIN não testada. A4 sem CropBox seguro não é recortado por adivinhação.

## Cadastro sem etapa intermediária — 24/10
- [x] Unir campos à tela do pedido e de quem não tem pedido, mantendo captura, rascunho e bloqueios existentes.
- [x] Informar que a confirmação exige enviar a mensagem no WhatsApp; 43 testes passaram e navegador conferiu pedido real com rascunho restaurado, erro por campo e tela mobile. Sem pedido, confirmado e expirado conferidos com respostas simuladas; escritas interceptadas para não alterar cliente, sem mensagem real e sem publicar. Regras e serviços de cadastro, sorteio, pagamento, CAPI e confirmação não alterados.

## Erro ao gerar Pix — 24/10
- [x] Identificar recusa do Mercado Pago por ponto antes do @ no e-mail; corrigir validação compartilhada sem alterar cadastro, valores ou consultas.
- [x] Validar 17 testes e geração real de R$ 341,99 no carrinho da Vaneide, QR/código visíveis e Pix enviado no WhatsApp; liberar tentativas falhas somente desse pedido. Correção compartilhada disponível no serviço e Pix opcional do boleto protegido; site não publicado.

## Confirmações de pagamento — 24/10
- [x] Diagnosticar Isabel: IDs recusados da cascata bloqueavam consulta da captura AustPay, cujo GET omite referência; quatro confirmações ausentes, nenhum cadastro pago ausente nos últimos sete dias do autoatendimento.
- [x] Corrigir prova da transação vinculada, fila como idempotência e recuperação limitada pelo worker de dois minutos existente; falha de cashback não bloqueia confirmação paga.
- [x] Recuperar quatro confirmações e verificar entrega real (Silvania leu, Isabel respondeu SIM), 11 testes e conversa da Isabel no navegador; não publicar o site.
- [ ] Cashback de @aicrampio e @carmenpina165: Appmax retorna pagamento aprovado e valor mas não data de aprovação; aguarda evidência oficial, sem estimar crédito. Confirmações entregues com cashback em conferência.

## Ficha em tempo real e carrinho manual — 24/10
- [x] Investigar dados da Silvania: chave do telefone divergente e telefone provisório perdido no chat; corrigir espelho por pedido/evento e chave do servidor para contatos sem pedido, preservando edições da equipe.
- [x] Oferecer copiar/enviar carrinho exato na parte de pagamento da ficha sem depender da confirmação no WhatsApp; envio manual salva cadastro do pedido sem confirmar WhatsApp.
- [x] Validar 20 testes, ficha real da Silvania e cópia do link exato, além de rascunho real de contato ainda não confirmado. Sem envio de mensagem real nesta rodada e sem publicar o site.

## Confirmação de cadastro — erros nos campos
- [x] Mostrar erros por campo e focar primeiro erro ao confirmar; 5 testes passaram e navegador confirmou nome com e-mail bloqueado sem envio, aviso visível e erro removido ao corrigir. Identificação simulada, evento real, sem salvar cadastro nem enviar WhatsApp. Sem publicar.

## Novos contatos — mensagens não lidas
- [x] Priorizar nova mensagem não lida, destacar com tag verde e permitir marcar como lido no card; 8 testes passaram, leitura conferida na live real e consulta indexada validada. Leitura por aparelho (padrão existente); chegada de nova mensagem validada em teste, não com novo envio real. Sem publicar.

## Integridade dos links e vínculos — 24/10
- [x] Investigar e proteger link de pagamento: autoatendimento usa carrinho do pedido exato. Link antigo da Amine mostrou 530 Dourado/35 no navegador; divergência reportada não reproduzida.
- [x] Corrigir vínculo seguro por final único sem conflito; vincular três cadastros confirmados, incluindo Amine, e reprocessar pela fila existente sem reenviar o já enviado.
- [x] Validar carrinho real, fila sent, 15 testes e teste transacional de final único/conflito/empate; site não publicado.

## Carrinho e cadastro — 24/10
- [x] Mostrar frete separado nas páginas públicas do autoatendimento.
- [x] Cadastro confirmado oferece pagamento sem nova confirmação.
- [x] Pedido posterior ao cadastro confirmado recebe link pela fila existente.
- [x] Testar os três caminhos sem publicar o site: 10 testes, identificação transacional com rollback e navegador no pedido real. Sem envio real de WhatsApp.

## Ajustes de fila — 24/10
- [x] Intervalo aleatório persistido de 3–7 segundos por instância e testes.
- [x] Recuperação por minuto enquanto há trabalho, liberando reservas após 2 minutos.
- [x] Conferir status/reenvio pela mesma chave e entregar arquivos alterados, sem publicar.

Verificação da rodada: testes transacionais de pacing/reenvio/recuperação/ativação e remoção do cron passaram; 11 testes do autoatendimento passaram. Fila consultada: pending=0, sending=0, claimed=0, sent=0, failed=0. Cron só existe enquanto há fila. Sem envio real nesta rodada. A chave deduplica a fila, não a aceitação ambígua do provedor.

Regras: NÃO alterar modos manual/member_area/whatsapp nem eventos existentes. NÃO publicar o site.

- [x] BLOCO 0 — Auditoria (respondida em texto antes de codar)
- [x] BLOCO 1 — Chat interno fora das páginas públicas (/pedido, /ao-vivo) — TeamChat oculto
- [x] BLOCO 2 — Fila persistida anti-spam (4s por instância, retry 30s/2min/10min/30min, 5 tentativas, idempotência por chave, fallback para envio direto, alerta + reenvio na Central da Live). Só no modo whatsapp_autoatendimento; modos antigos seguem envio direto.
- [x] BLOCO 3 — Sorteio ao vivo: contador/lista de elegíveis em tempo real no painel, sorteio grava evento `raffle_draw`, overlay gira a roleta com confete, destaque 10s e barra "Ganhadora: @x", botão "Testar sorteio" no controle do overlay
- [x] BLOCO 4 — Faixa de confiança no link do carrinho (10 anos/2 lojas, selo Google configurável no evento, Mercado Pago + bandeiras)
- [x] BLOCO 5 — Interruptor "match avançado Meta" na Etapa 1 do assistente (padrão ligado)
- [x] BLOCO 6 — Vídeos tutoriais (41s cada, verticais) + botões "Como funciona?"/"Como pagar?" nas páginas

Verificação: 24 testes passando, build OK, fila testada no banco (idempotência, ordem, intervalo, recuperação de travada), funções publicadas no backend. Site NÃO publicado.

Ressalvas dos vídeos (conferir antes de mostrar às clientes): dados de exemplo fictícios (Maria Aparecida Souza, Tênis Ortopédico R$ 189,90), QR Code ilustrativo (não escaneia), painel de parcelas do cartão é desenho (a tela real não carregou com pedido fictício), sem narração (textos + música).

## Correios fase 2 — 26/10
- [x] Pré-postagem + etiqueta conjunta (correios-shipment, correios_shipments, bucket correios-labels)
- [x] Cotação automática na Conferência + resumo nos cards
- [ ] Primeira pré-postagem real (aguardando autorização do Matthews)

## Transferência entre lojas — 27/10
- [x] Motor atômico, histórico, estorno (admin), aba Transferência no PDV e telas antigas unificadas; testes do banco e prévia real conferidos sem transferir.
- [ ] Transferência real de validação — aguarda pedido do Matthews.
