# Prioridade do produto no overlay
- [x] Corrigir escolha manual escondida pela opção de códigos automáticos e impedir que comentários derrubem o produto atual; E017 visível no overlay, prioridade transacional e 18 testes, sem publicar

# Fila da apresentadora — filtro dos preparados
- [x] Filtrar somente os produtos já separados por código, nome ou cor, sem novas consultas; testado na live, sem publicar

# Fila da apresentadora — tamanhos, promoções e edição em grupo
- [x] Mostrar numerações grandes por código, salvar liberação manual e impedir tamanho bloqueado no pedido por código
- [x] Vincular promoção progressiva ativa da live ao produto preparado, preservando o cálculo e os pedidos existentes
- [x] Selecionar vários produtos e aplicar preço especial/frete grátis em uma única ação
- [x] Testar regras, edição individual/em grupo, cálculo do carrinho e leiaute; 25 testes, T130 restaurado, sem publicar

# Enviar cor para a Shopify
- [x] Criar envio por código com dry-run, confirmação, proteção de duplicidade e sem sincronização completa
- [x] Integrar botão nos códigos pendentes e ao de-para existente
- [x] Bloqueio Por código já correto; 17 testes e dry-run T235 com seis tamanhos, sem escrita; nenhuma bolsa pendente

# Fila de produtos da apresentadora
- [x] Auditar seleção/overlay, ofertas, carrinho e etiquetas sem alterar comportamento atual
- [x] Preparar produtos da live com preço/condição/frete específicos e pausa sem remoção
- [x] Aplicar a configuração vigente ao anotar o carrinho, preservando preços manuais e demais modos
- [x] Imprimir etiquetas da fila com preço cheio e preço da oferta
- [x] Testar busca/edição, apresentar/parar, overlay, PDF e cálculo; 30 testes, build limpo, sem publicar
- [x] Foto do produto na busca da fila: cor do espelho Shopify com reserva pela foto do produto; 5 testes, sem publicar
- [x] Cards dos produtos com metade da altura e busca mantida aberta para adicionar vários em sequência; testado sem gravar inclusões
- [x] Cards mais quadrados e pouco mais altos, com nome, cor e preço maiores; conferido em 1705px sem sobreposição

# Previsão de entrega no rastreio
- [x] Auditar onde serviço, CEP e prazo real são gravados e como o link público lê o envio
- [x] Calcular faixa estimada por cotação: +3 dias úteis fixos, exceto SEDEX; preservar data real quando existir
- [x] Exibir a faixa no rastreio sem expor transportadora/código e sem consultas repetidas desnecessárias
- [x] Testar SEDEX, demais modalidades, fins de semana e substituição pela previsão real; não publicar

# Central de Trocas e Devoluções — Fase 2
- [x] Motor compartilhado, tokens isolados e submissão/reserva atômica, sem fiscal; edges fechadas até limite autorizado
- [x] Duas páginas públicas, links no pedido e configuração paginada de reposição
- [x] 17 testes, páginas simuladas 360px e relatório sem publicar
- [ ] Conferência real administrativa/transacional: sessão não exibiu aba; atendimento público depende de proteção aprovada
- [ ] Limites por IP/token: aguarda confirmação do dono sobre proteção ad-hoc

# Correção fiscal da reversa — desconto da venda
- [x] Compartilhar cálculo troca/reversa e aviso fiscal, sem mudar trava de duplicidade
- [x] Conferir oito TDs por SQL e dry_run, simular vínculo sem emissão (25 testes; XML já tinha desconto)
- [x] Implantar nfe-devolucao-emitir e entregar relatório; preservar notas e planos

# Follow-up automático global das lives
- [x] Botão F: toque verificado libera carrinho e sequência; resposta digitada para; simulação sem envio
- [x] Chat: HUMAN_AGENT manual 24h–7 dias somente com permissão comprovada; status e memória
- [ ] Meta: comprovar aprovação Human Agent e aceitar quick reply na resposta privada em teste autorizado (sem envio nesta entrega)
- [x] Auditoria: remetente compartilhado, Instagram privado/janela, chat e LID comprovado; simulação 07/11 sem envio e relatório
- [x] Preservar plano RH idêntico; não implementar RH nem apagar candidato protegido
- [x] Inventariar lembretes existentes e sobreposição
- [x] Configuração global desligada, por tipo e por evento
- [x] Agendamento, paradas, deduplicação e fila segura por instância
- [x] Histórico, números do dia e testes simulados sem mensagens reais
- [x] Relatório de conferência; não publicar
- [ ] Conferir entrega real em live controlada: aguarda autorização, global permanece desligado

# Ajustes atuais — CNPJ e cores Shopify
- [x] Vitrine urgente: ignorar estoque, preservar exclusões manuais e testar bolsa + Spezial 40 até pagamento.
- [x] Priorizar gateway aprovado e criar pendência quando os IDs continuarem ambíguos
- [x] Refazer a simulação de 7 dias e medir os 24 casos resolvidos ou pendentes
- [x] Listar cores ativas na Shopify ausentes no ERP, separando possíveis grafias
- [x] Importar variantes com SKU/numeração/preço e estoque zero; testar Pérola do Samba Cris
- [x] Verificar regras, telas e segurança sem emitir notas nem publicar

# Fiscal — CNPJ emissor pelo gateway
- [x] Mapear emissões automáticas/manuais, NF-e/NFC-e, cancelamentos, correções e devoluções
- [x] Criar configuração segura gateway→empresa, padrão, interruptor desligado e pendência de CNPJs diferentes
- [x] Aplicar seleção e log na emissão sem alterar o comportamento enquanto desligado
- [x] Adicionar configuração, filtro e CNPJ emissor nas telas fiscais e listas/modais de notas
- [x] Desativar somente as duas empresas de teste indicadas
- [x] Testar regras sem emitir notas e simular os últimos 7 dias por CNPJ e pagamentos divididos

# Vínculo ERP ↔ Shopify e de-para de cores
- [x] Rodar relink e refresh dos intents abertos após cada sincronização, retornando o resultado da relink
- [x] Bloquear confirmação do card somente pelos avisos de item definidos, sem duplicar aviso do intent
- [x] Adicionar de-para manual de cores em Estoque → Códigos e religar após salvar
- [x] Testar regras, rodar a sincronização uma vez e informar o jsonb retornado

# Rastreio do contrato próprio dos Correios
- [x] Ligar envios próprios à consulta oficial sem expor transportadora/código real
- [x] Manter Frenet e etapas existentes; testar com envio real e sem publicar

# Auditoria de cadastro e carrinho da live
- [x] Conferir registros reais de cadastro, confirmação e fila de mensagens
- [x] Auditar identificação de pedidos e reproduzir as telas sem cadastrar ou enviar
- [x] Entregar achados comprovados, riscos e próximos passos sem reenvios automáticos

# Reemissão de logística reversa
- [ ] Conferir vínculo da compra, itens e conversa das clientes restantes; separar dúvidas
- [ ] Reemitir somente casos comprovados com NF-e e código; preservar prazo original
- [ ] Enviar código e DANFE espaçados, confirmar registro e listar resultados
- [ ] Andreia fora (Frenet); Gilda e Michelly já enviadas, não reenviar

# Promoções progressivas — reaproveitamento
- [x] Listar e buscar promoções de outras lives, com resumo
- [x] Copiar promoção e produtos sem alterar a original, tratando nome duplicado
- [x] Vincular a cópia ao catálogo e às ofertas da live atual e informar divergências
- [x] Testar “3 por 200” de 05/11 para 07/11 e conferir os vínculos

# Segurança — Fase 4
- [x] A1 shopify-create-order: só pedido pago, dados do banco, auth
- [x] A2 shopify-create-live-order: idem
- [x] A3 mercadopago-check-payment: referência E valor
- [x] A4 mercadopago-create-pix: desconto do servidor, override admin
- [x] A5 pagarme-create-charge: valor do body só comparado
- [x] A6 split-payment: total comparado, auth nas mutações
- [x] A7 shopify-webhook: HMAC obrigatório
- [x] A8 checkout-public: update_sale restrito, lookup CPF
- [x] A9 payment-confirmed-hook: só pedido pago
- [x] A10 yampi-create-payment-link / mp-create-boleto / austpay-charge-card
- [ ] B11–B14 destrutivas e conta
- [ ] C15–C17 disparos e mensageria
- [ ] D18 gasto e IA

## Fase 4 — status
- [x] A pagamento/pedidos (implantado)
- [x] B destrutivas/conta (implantado; rotinas fiscais migradas p/ segredo interno)
- [x] C disparo/mensagens (implantado; código da live com limite 3/h telefone, 10/h IP)
- [x] D IA/gasto (implantado; limite de uso por IP)
- [ ] Pendências: validação de assinatura nos webhooks WhatsApp (item 17); identidade do livete-respond (14); valores server-side em Yampi/boleto; split-payment por token de sessão; shopify-webhook precisa do segredo do painel Shopify; botão antigo de pedido Shopify da live (LiveSessionManager); replay MP/Pagar.me com 0 falso negativo

# Central de Trocas — Parte 1 (banco + funções)
- [x] Entrega confirmada J&T/Transportadora no rastreio + backfill + origem da entrega
- [x] Configurações, solicitações, links únicos, elegibilidade e marcador de reposição
- [x] Testes pedidos e relatório final

# Grupo VIP no link da live
- [ ] Plano aguardando aprovação (substituído pelo pedido da Central)

# Moderação de comentários do Instagram
- [x] Fila, IA, ocultar, direct de rastreio, tela e testes (interruptor desligado)
- [ ] Confirmar permissão de ocultar com um comentário de teste real (aguarda o dono ligar)
- [ ] Conferir se comentários de anúncio exclusivo chegam (aguarda um anúncio real comentado)

# Link curto /v/:code para grupos VIP
- [x] Tabela, função de criar e resolver, rota rápida, teste

# Trava NF-e de devolução duplicada (urgente)
- [x] Reversa vincula NF à troca aberta; conferência reusa/bloqueia
- [x] Trava de soma ≤ NF original em nfe-devolucao-emitir
- [x] Bloqueio de 2ª troca aberta com mesmos itens
- [x] Backfill de vínculo + relatórios + testes por SQL

# RH (recrutamento)
- [x] Complemento VAGA: stories/menções conferidos e DM direta incluída; 64 testes passaram e funções implantadas sem publicar, candidato preservado
- [x] Fase 1: banco, links por @, senha da área
- [x] Fase 2: página /vaga/:codigo + rascunho + envio
- [x] Fase 3: pontuação no servidor, avaliação IA isolada e testes
- [x] Fase 4: aba RH, detalhe, senha e configurações; testes e limpeza
- [x] Fase 5: aviso WhatsApp único após avaliação, teste manual e reenvio admin; aviso desligado por padrão
- [x] Automação Instagram VAGA-RH: variações tolerantes só nesta regra, link por @, Direct com botão e resposta pública
- [x] Testes reais de correspondência, idempotência e reserva única; limpar somente dados de teste, preservando o candidato do dono
