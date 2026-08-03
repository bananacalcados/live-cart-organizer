# Folha completa: funcionários não-vendedores, provisionamento CLT, horas extras e bônus

## Objetivo
Transformar a aba FOLHA (PDV > Dashboard Geral) numa folha de pagamento completa: cadastrar qualquer funcionário (mesmo sem vendas), calcular provisionamentos CLT mensais, lançar horas extras e bônus de cartão de benefícios, e ver o custo em camadas (bruto, com provisionamento, com bônus).

## 1. Funcionários sem vendas
- Botão **"+ Novo funcionário"** na seção Configurar → Pessoas, pedindo nome e cargo/função.
- Funcionário criado sem vínculo com vendedora aparece normalmente na tabela da FOLHA, com faturamento e comissão zerados, mas com salário, gratificação, provisionamento, extras e bônus somados.
- Marcador visual (badge "Administrativo") quando a pessoa não tem vendedora vinculada.
- Continua sendo possível vincular vendedoras depois, sem duplicar cadastro.

## 2. Provisionamento CLT (mensal, 1/12)
Cadastrado por pessoa como liga/desliga (padrão ligado), calculado sobre a **base salarial** (salário fixo + gratificação de cargo):

```text
Base = salário fixo + gratificação de cargo

13º salário        = Base / 12
Férias             = Base / 12
1/3 constitucional = (Base / 12) / 3
Aviso prévio       = Base / 12      (indenização de 1 salário provisionada em 12 meses)

Provisionamento total = soma dos itens ativos
```
- Encargos sobre provisionamento (FGTS/INSS) ficam fora deste escopo, com um campo opcional **"% encargos sobre provisionamento"** por pessoa (padrão 0) para quem quiser somar.
- Cada item pode ser desligado individualmente por pessoa (ex.: aviso prévio só para alguns).

## 3. Horas extras
Por pessoa e por período (mês selecionado na FOLHA):
- **Qtd. de horas extras** (número, informativo).
- **Valor pago em horas extras (R$)** — digitado manualmente, entra no bruto.
Lançamento fica guardado por mês, então cada período tem seu próprio valor.

## 4. Bônus cartão de benefícios
Valor manual por pessoa/mês. **Não entra no contracheque** (não tributável): fica em coluna própria e só aparece no total final "custo com bônus".

## 5. Camadas de valores exibidas
Cada linha da tabela e o rodapé de totais mostram:

```text
A) Salário bruto (sem provisionamento) = salário + gratificação + horas extras
B) A + comissão                        = "Salário + Comissão"
C) B + provisionamento                 = "Com provisionamento"
D) C + bônus benefícios                = "Custo total"
```
- Coluna de provisionamento com tooltip detalhando 13º, férias, 1/3 e aviso prévio.
- Rodapé com o somatório de cada camada para a empresa inteira.
- CSV de exportação passa a incluir todas as colunas novas.

## Detalhes técnicos
- Migração em `pos_commission_people`: `role_title text`, `is_employee_only boolean default false`, `provision_13 boolean default true`, `provision_vacation boolean default true`, `provision_notice boolean default true`, `provision_charges_percent numeric default 0`.
- Nova tabela `pos_payroll_period_entries` (person_id, period_start, period_end, overtime_hours, overtime_value, benefits_bonus) com unique(person_id, period_start, period_end), GRANTs para `authenticated`/`service_role`, RLS igual às demais tabelas de folha, e trigger de `updated_at`.
- `src/lib/pos/payroll.ts`: `PayrollPerson` ganha as flags de provisionamento; novo input `periodEntries`; `PersonRow` ganha `overtimeHours`, `overtimeValue`, `benefitsBonus`, `provision13`, `provisionVacation`, `provisionVacationBonus`, `provisionNotice`, `provisionCharges`, `provisionTotal`, `grossSalary`, `salaryPlusCommission`, `withProvision`, `totalCost`. Cálculo puro, com testes novos em `src/test/payroll.test.ts`.
- Pessoas sem vendas hoje são filtradas apenas por `is_active`; manter, garantindo que quem não tem vendedora vinculada continue com linha na tabela.
- `POSPayrollTab.tsx`: diálogo de novo funcionário, inputs de provisionamento na configuração, inputs de horas extras/bônus por período (salvos onBlur em `pos_payroll_period_entries`), novas colunas + rodapé e export CSV atualizado.
- `POSDashboard.tsx` (dashboard da loja) segue usando só comissão — sem alteração.

## Fora do escopo
Descontos (INSS, IRRF, vale-transporte, faltas), adiantamentos, geração de contracheque em PDF e histórico de reajuste salarial.
