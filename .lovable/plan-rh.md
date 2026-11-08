# Aba RH (recrutamento) — plano

Nada será alterado no que já funciona. Nada será publicado.

## 1. Auditoria (somente leitura)

a) **Abas do Dashboard Geral** — `src/components/pos/POSGeneralDashboard.tsx` (linha ~544): lista fixa `overview / payroll / fiscal / dre` e um `view === ...` que escolhe o painel. Folha e Fiscal são protegidas por senha da área, conferida no servidor (`src/lib/areaPassword.ts` → RPC `verify_area_password`, 5 tentativas e bloqueio de 5 min; troca só pelo admin via `change_area_password`). Permissão de admin pelo `has_role(auth.uid(),'admin')`. RH entra como 5ª aba, visível só para admin, e as funções conferem `has_role` no servidor (o botão escondido não é a proteção).

b) **WhatsApp por uazapi** — `supabase/functions/_shared/uazapi-credentials.ts` (`resolveUazapiCredentials`, `uazapiInstance`, `formatUazapiNumber`) resolve a instância e o token sem expor ao navegador. O ritmo/fila por instância fica em `selfservice-message-worker` (reserva atômica, 3–7 s por instância, recuperação após 2 min). Para um aviso interno, um por candidato, o plano é usar a mesma fila em vez de criar outra; se a fila exigir pedido/evento, faço um envio direto e único pelo helper de credenciais (ver Dúvida 2).

c) **IG Automação** — regras de comentário com `trigger_type='keyword'` e `trigger_keywords` em `_shared/instagram-comment-automation.ts` (linhas ~353 e ~699); DM por `instagram-dm-automation-run`. O padrão de "1 linha, reserva atômica, sem nova tentativa" é `ig-live-cart-notify` + RPC `claim_ig_live_cart_notifications` com `kind` (`selfservice_register_dm`, ...). Dá para incluir na fase 2 um novo `kind='rh_vaga_link'` e uma ação de regra "enviar link do RH", sem mudar os `kind` nem as regras atuais.

d) **Função pública e IA** — `_shared/withAccessLog.ts`, `requireAuth.ts`, `staff-or-internal.ts`, `ai-rate-limit.ts` e contagem por IP em `auth-security.ts` (`countLastHour`). A IA da moderação está em `supabase/functions/ig-comment-moderate/index.ts`: Lovable AI, modelo Flash, `response_format` com esquema JSON, uma chamada por item, sem nova tentativa automática. Vou reutilizar o mesmo formato.

e) **Rota pública** — `src/App.tsx`: `/g/:code`, `/zap/:slug`, `/pedido/:eventSlug...` ficam fora do login. `/vaga/:codigo` segue o mesmo padrão, com página carregada só quando aberta.

## 2. O que será criado

**Tabelas (todas com segurança ligada, sem acesso público; leitura e escrita só admin ou pelas funções do servidor):**
- `rh_vagas` — título, resumo, ativo. Já nasce com "Vendedor(a) — Live e Lojas".
- `rh_settings` (1 linha) — guia de atendimento, pesos, faixas de permanência, pontos por transporte e por computador, palavra-chave da fase 2, instância uazapi, número do aviso (padrão 5533991955003), aviso ligado/desligado.
- `rh_cenarios` — vaga, ordem, contexto, mensagem do cliente, gabarito, ativo.
- `rh_bairros_proximos` — loja (Pérola/Centro), bairro sem acento, pontos.
- `rh_links` — código (aleatório, 10+ caracteres), hash do código, @ normalizado, vaga, estado (gerado/aberto/enviado), datas. Único por @ + vaga.
- `rh_candidatos` — link, nome, WhatsApp, idade, bairro, cidade, transporte, aceita condições, já trabalhou, computador, situação, dispositivo, rascunho, status (novo/em análise/chamado/aprovado/reprovado), observação, consentimento e data, `deleted_at`.
- `rh_experiencias` — candidato, onde, função, duração em meses (até 10 por candidato).
- `rh_respostas_teste` — candidato, cenário, texto exato da resposta.
- `rh_avaliacoes` — candidato, nota final, completa/parcial, detalhamento por critério (JSON), resumo da IA em 3 linhas, sinais de alerta, `ai_attempted_at` (impede nova avaliação automática).
- `rh_avisos` — candidato (único), estado, reservado em, enviado em, erro, quantidade de reenvios (máximo 3).
- Índices só para as consultas de lista: (status, nota), (vaga, criado em), @ e nome com busca por similaridade.

**Funções SQL** (sem acesso público; conferem admin, exceto as do servidor):
- `rh_create_link(username, vaga_id)` — somente servidor, idempotente; usada pela aba e depois pelo Instagram.
- `rh_list_candidatos(status, busca, limit≤50, offset)` e `rh_list_links(limit, offset)`.
- `rh_counts()` — novos e pendentes, numa única leitura.
- `rh_candidato_detalhe(id)`, `rh_update_status(id, status, obs)`, `rh_delete_candidato(id)` (apaga dados pessoais e respostas, mantendo só um registro anônimo de exclusão).
- `rh_claim_aviso(id)` — reserva atômica do aviso.

**Funções do servidor:**
- `rh-public` (aberta, mas com limite: 30/h por IP e 60/h por código; tudo validado no servidor) — `open` (devolve vaga, cenários e guia; marca "aberto"), `draft` (salva rascunho), `submit` (valida, grava, marca "enviado" e dispara a avaliação em segundo plano). Nunca devolve dados de outros candidatos.
- `rh-score` (somente servidor/admin) — aplica as regras, faz uma chamada à IA e grava a avaliação. Se a IA falhar, grava nota parcial. Depois reserva e envia o aviso. Botões "Reavaliar com IA" e "Reenviar aviso" passam por aqui, com checagem de admin.
- `rh-admin` (admin) — criar link e salvar configurações.

**Telas:**
- `src/pages/VagaPublicPage.tsx` (`/vaga/:codigo`), feita primeiro para celular.
- `src/components/pos/rh/RhTab.tsx` com subabas Links, Candidatos e Configurações.
- `src/pages/RhCandidatoPage.tsx` (`/rh/candidato/:id`, exige login e volta para o mesmo endereço depois de entrar).
- Alteração mínima em `POSGeneralDashboard.tsx` (nova aba, só para admin) e em `App.tsx` (2 endereços).

## 3. Pontuação (servidor)
- **Atendimento, 50 pontos:** 3 cenários × 10. Pergunta no final ou aviso de retorno vale 3 (regra); ação correta vale 3 (IA); até 200 caracteres vale 2 (regra); tom cordial vale 2 (IA).
- **Situação, 20 pontos:** nota 0–10 da IA × 2.
- **Permanência, 15 pontos:** média em meses, por faixas configuráveis. Sem experiência dá 7,5 pontos.
- **Transporte e bairro, 10 pontos:** pontos por meio de transporte + tabela de bairros, com teto de 10.
- **Computador, 5 pontos:** 0, 3 ou 5.
- Quem não topa as condições recebe a nota normalmente, mas vai para o fim da lista e ganha uma marca.
- Instruções fixas para a IA: avaliar só o conteúdo, ignorar características pessoais, descrever com neutralidade. A tela informa: "A IA é apoio; a decisão é sua."

## 4. Aviso no WhatsApp
Depois da avaliação (ou com "nota parcial" se a IA não responder em 25 s), envia uma mensagem por candidato: "Novo candidato: {nome} (@{ig}) — nota {n}/100 — vaga {vaga}. Ver respostas: {link do detalhe no ERP}". Usa a instância escolhida; se ela estiver desligada, usa a primeira uazapi conectada. Sem nova tentativa automática; um erro fica visível e pode ser reenviado até 3 vezes.

## 5. Consultas ao abrir cada tela
- **Página pública:** 1 chamada ao abrir; rascunho salvo 1,5 s após parar de digitar (só se algo mudou); 1 chamada ao enviar. Sem repetição automática.
- **Aba RH:** 2 chamadas ao abrir (contadores + 1ª página de 50 candidatos). Links e Configurações fazem 1 chamada cada, somente quando abertos. Sem atualização automática.
- **Detalhe:** 1 chamada, com tudo junto.
- **Servidor por candidato enviado:** 1 chamada de IA + 1 mensagem de WhatsApp. Nenhum agendamento novo.

## 6. Fases (cada uma pode ser testada e desfeita separadamente)
1. **Banco + criação de link.** Teste: criar o mesmo @ duas vezes devolve o mesmo link; um usuário sem permissão não lê nada.
2. **Página pública + gravação.** Teste no celular (390 px): rascunho, menor de 18, até 10 experiências, link já enviado e limite de acessos.
3. **Pontuação.** Testes automáticos de cada regra (pesos, sem experiência = metade, computador, "não topa" no fim) + 1 avaliação real com a IA + simulação de falha (nota parcial).
4. **Aba RH + detalhe.** Teste: paginação, busca no servidor, status e observação, apagar candidato, voltar ao detalhe depois do login.
5. **Aviso.** Teste: 1 envio para o seu número com candidato de teste, reserva dupla não envia duas vezes, instância de reserva e reenvio limitado. Os dados de teste são apagados no final.
6. **Fase 2 (só com autorização):** `kind='rh_vaga_link'` em `ig_live_cart_notifications` + ação nas regras de palavra-chave + áudio com transcrição.

## 7. Dúvidas e riscos
1. **Acesso:** a aba deve ser só admin, ou também com senha própria como Folha/Fiscal? Proposta: só admin, sem senha.
2. **Fila do aviso:** a fila do autoatendimento é ligada a evento/pedido. Proposta: envio direto e único pelo helper de credenciais, porque é 1 mensagem interna por candidato e não é disparo em massa. Confirma?
3. **Endereço do link:** usar `checkout.bananacalcados.com.br/vaga/...`? Proposta: sim.
4. **Faixas iniciais de permanência:** menos de 3 meses = 4; 3–6 = 8; 6–12 = 12; mais de 12 = 15. **Transporte:** a pé, moto e bicicleta = 6; carro = 5; ônibus = 3; bairro próximo soma até 4. Confirma?
5. **Guarda dos dados:** apagar automaticamente candidatos reprovados depois de X meses? Proposta: não apagar sozinho; apagar só pelo botão.
6. **Risco:** o @ vem do link, e alguém pode repassar o link a outra pessoa. A tela mostra o @ ("Cadastro de @fulana") para reduzir esse risco.
7. **Fase 2 (Instagram):** a resposta por comentário depende da permissão atual de mensagem privada. Vai ser conferida antes de ligar.
