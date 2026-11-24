# Links de Disparo — plano em 3 fases

## O que já existe (lido agora, sem alterar)
- O disparo do PC grava o disparo primeiro como "em espera", coloca os destinatários pela função do motor de cotas (`enqueue_dispatch_recipients_guarded`), só depois libera para "enviando" e chama `vps-dispatch-proxy`, que acorda o `dispatch-worker`.
- Agendado: o disparo fica como "scheduled" com data, e o orquestrador já existente o promove na hora certa.
- O worker remove bloqueados (`blocked-guard`) a cada lote; opt-out e cotas são aplicados ao colocar na fila.
- Clientes Ravena hoje entram com "pular unificação" ligado: **não passam pelo motor de cota mensal** (loja externa). O link vai repetir exatamente esse comportamento, salvo se você mandar diferente.
- `vps-dispatch-proxy` exige usuário logado da equipe — a página pública não pode chamá-la; a função nova chamará o worker do mesmo jeito que o proxy faz, por dentro.

## Fase 1 — Banco + funções + testes das travas
Tabelas novas (todas com segurança ligada; leitura/escrita só admin; funções usam acesso interno):
- `dispatch_links`: id, código público (aleatório, longo), nome, descrição, hash da senha (bcrypt), versão da senha (muda ao redefinir → derruba sessões), instâncias permitidas, modo de template (todos aprovados / lista), templates permitidos, públicos permitidos (fonte fixa como 'ravena' ou id de público salvo), filtros travados, permite agora, permite agendar, limite de destinatários, validade, ativo, revogado em, criado por, datas.
- `dispatch_link_sessions`: link, hash do token, versão da senha, IP, expira em (2h), revogada.
- `dispatch_link_attempts`: link, IP, sucesso, data — base para bloqueio (ex.: 5 erros em 15 min → 15 min travado por link+IP; 20 por link → trava o link 15 min).
- `dispatch_link_tests`: sessão, link, hash da configuração (instância+template+idioma+variáveis), número de teste (mascarado), status, id da mensagem, data. Válido por 2h e só para a mesma sessão.
- `dispatch_history.dispatch_link_id` — coluna nova, vazia por padrão (não muda nada nos disparos do PC).

Funções novas (cada chamada revalida sessão, link ativo/não vencido/não revogado e presets):
- `dispatch-link-admin` (só admin logado): criar, editar, redefinir senha, ativar/desativar, revogar, listar, histórico por link. Entrada: dados do preset + senha digitada. Saída: link sem hash de senha.
- `dispatch-link-public` (pública, por ação):
  - `login` {código, senha} → {token, expira, nome do link}. Erro genérico igual para link inexistente e senha errada.
  - `options` {token} → instâncias permitidas, templates permitidos (só aprovados), públicos permitidos com contagem (sem telefones), limites e o que é permitido.
  - `count` {token, instância, público} → total que entraria (já com limite).
  - `send_test` {token, instância, template, variáveis, telefone de teste} → envia 1 mensagem só para esse número, grava o teste com o hash. Limite: 5 testes por sessão/hora.
  - `create_dispatch` {token, instância, template, variáveis, público, agora|data} → recalcula o hash e exige teste com sucesso igual; monta a lista no servidor; aplica limite; grava `dispatch_history` com `dispatch_link_id`; enfileira pela MESMA função do motor de cotas; ativa e acorda o worker (ou deixa "scheduled"). Proteção contra clique duplo (chave única por sessão+hash).
  - `status` {token, disparo} → enviados/falhas, só de disparos daquele link; chamado manualmente pelo botão "Atualizar".
- Testes: senha errada, bloqueio por tentativas, sessão expirada/revogada após trocar senha ou desativar, instância/template/público fora do preset, acima do limite, agendar quando proibido, disparo sem teste, teste com outro template/variável/instância, sem mensagens reais (envio simulado).

## Fase 2 — Wizard no celular (/d/:codigo)
Uma etapa por tela, barra de progresso, voltar, botões grandes, caixa "Como fazer":
1. Senha 2. Instância (pula se só uma) 3. Template + variáveis + prévia 4. Público + contagem 5. Teste obrigatório no próprio número 6. Resumo → Enviar agora ou Agendar.
Ponta a ponta com instância Ravena + Clientes Ravena. A página não usa login da equipe nem lê tabelas; token só na memória da aba. Andamento por botão "Atualizar", sem consulta automática.

## Fase 3 — Sub-aba "Links de Disparo" em Marketing > Disparos
Lista de links, criar/editar preset, definir/redefinir senha (nunca mostrada), copiar link, ativar/desativar, revogar, histórico por link (disparos com enviados/falhas). A tela atual de disparos não muda.

## Riscos e como evito
- Quebrar o disparo do PC: não mexo nele; a lógica de montar a lista é duplicada na função (só para as fontes permitidas: Ravena e público salvo). Coluna nova é vazia por padrão.
- Furar opt-out/cota/bloqueio: uso a mesma função de enfileirar e o mesmo worker; nunca coloco destinatário direto.
- Lentidão: contagem por consulta de contagem com índice; lista montada em lotes de 1000 só no disparo; sem consulta automática; limite de destinatários por link.
- Vazamento: página só recebe contagens e textos de template; telefone de teste mascarado no registro; senha só em hash.
- Abuso de teste (virar disparo disfarçado): limite de testes por sessão e só um número por teste.

## Dúvidas para você
1. Links da Ravena devem continuar **sem** motor de cota mensal (como no PC hoje) ou passar a respeitar a cota?
2. Qual "tipo de comunicação" o link usa (obrigatório no motor)? Fixo por link no preset?
3. O número de teste é livre (a pessoa digita) ou eu travo uma lista de números da equipe por link?
4. Disparo pelo link pode "forçar reenvio" para quem já recebeu hoje? Proponho: nunca (sempre pula quem já recebeu).
5. Templates com mídia no cabeçalho/carrossel: liberar upload de imagem no celular ou só templates sem mídia na primeira versão?
6. Quer aviso para você (WhatsApp/e-mail) quando um link disparar?

## Detalhes técnicos
- Senha: bcrypt via pgcrypto em RPC exclusiva do acesso interno (mesmo padrão já usado nas senhas de área). Token: 32 bytes aleatórios, guardado só o hash.
- Novas funções SQL: sem execução pública/anônima; só acesso interno.
- Hash da configuração: SHA-256 de instância+template+idioma+variáveis normalizadas.
- Agendamento reutiliza `status='scheduled'` + `scheduled_at` e o orquestrador atual.
