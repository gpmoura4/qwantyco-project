# Log de decisões

Formato: data · contexto · opções · decisão · motivo (e risco, quando a decisão foi contra a recomendação).

---

## D01 — Stack: PDF + LangChain JS
- **Data:** 2026-10-19
- **Contexto:** o PDF exige TypeScript + Next.js + LangGraph + LangSmith.
- **Opções:** (a) só LangGraph, com chamadas de modelo e tools escritas à mão; (b) LangGraph como orquestrador + LangChain JS para modelo de chat, mensagens, tools (Zod) e `bindTools`.
- **Decisão:** (b). Usar apenas APIs atuais (LangChain/LangGraph 1.x); proibido `AgentExecutor`, `LLMChain`, `@langchain/classic`. Em dúvida, consultar docs.langchain.com.
- **Motivo:** LangChain padroniza modelo, mensagens e tools; tools definidas com Zod dão validação de contrato e aparecem automaticamente como runs no LangSmith.

## D02 — Gerenciador de pacotes: npm
- **Data:** 2026-10-19
- **Opções:** npm (já instalado, `package-lock.json`, `npm ci` sem passo extra) · pnpm (mais rápido e estrito, mas exige instalação via corepack).
- **Decisão:** npm.
- **Motivo:** familiaridade (era o padrão na Branddi) e zero instalação extra para quem clonar o repositório.

## D03 — Versão do Node: 24 LTS
- **Data:** 2026-10-19
- **Contexto:** a máquina local roda Node 26.10.0, sem gerenciador de versões (nvm/fnm). Em 2026-10-19, o Node 24 é a LTS ativa ("Krypton") e o 26 ainda não é LTS.
- **Opções:** 24 LTS · 26 (local, ainda "Current") · 22 LTS (mais antiga).
- **Decisão:** `.nvmrc` = `24` e `engines.node` = `>=24`.
- **Motivo:** LTS é a escolha mais previsível para quem clonar e avaliar.
- **Risco/mitigação:** desenvolvimento local acontece no 26. No Passo 1, `npm test` e `npm run build` foram validados nas duas versões (24.22.0 e 26.10.0). Repetir a validação no 24 antes da entrega final.

## D04 — Framework de testes: Vitest
- **Data:** 2026-10-19
- **Opções:** Vitest (TS/ESM nativos, quase sem configuração) · Jest (mais conhecido, exige ts-jest/SWC e tem atrito com ESM dos pacotes LangChain).
- **Decisão:** Vitest 5.
- **Motivo:** mais rápido, sem configuração de transpilação, e o SDK do LangSmith tem integração com Vitest.

## D05 — Estrutura de pastas: projeto Next único com core isolado
- **Data:** 2026-10-19
- **Contexto:** testes offline e avaliação no LangSmith precisam rodar o mesmo grafo sem subir o Next.
- **Opções:** (A) um projeto Next com `src/agent/` como core, que nunca importa `next` · (B) monorepo com workspaces (`packages/agent` + `apps/web`).
- **Decisão:** (A). Estrutura:
  - `src/app/` — Next.js (UI e rotas de API finas, só chamam o core)
  - `src/agent/` — core sem dependência do Next (domínio, grafo, modelo)
  - `evals/` — dataset, avaliador e runner do LangSmith
  - `tests/` — testes offline (Vitest)
  - `docs/` — requisitos, plano, decisões (`docs/references/` fora do git)
- **Motivo:** um único `package.json`, simples de explicar. A fronteira entre core e Next é por convenção (regra no CLAUDE.md), não imposta por ferramenta.
- **Consequência:** scripts TS fora do Next (eval) vão precisar de um executor (`tsx`), que só será instalado no Passo 9a.

## D06 — Convenção de idioma
- **Data:** 2026-10-19
- **Opções:** (a) PT na fronteira com o modelo (nomes de tools e campos) e EN no resto · (b) PT apenas no texto ao usuário e na documentação, EN em todo o resto.
- **Decisão:** (b).
  - **PT:** texto ao usuário (UI, respostas, mensagens de erro), system prompt e documentação.
  - **EN:** código, identificadores, comentários e commits.
  - **Exceções obrigatórias do PDF:** a tool `listar_chamados`, o argumento `situacao` e o valor `"aberto"` (exigido literalmente no critério da avaliação).
  - As duas tools de nome livre terão nomes em inglês (definidos no Passo 2).
- **Risco registrado:** a lista de tools que o modelo vê mistura idiomas (`listar_chamados` em PT, as outras em EN), o que pode parecer inconsistente na apresentação. O impacto no modelo deve ser baixo, porque ele escolhe a tool pela descrição. **Mitigação:** descrições de tools claras e padronizadas. Explicar na entrevista que os nomes em PT são exigência do contrato de avaliação.
- **A definir no Passo 2:** idioma das descrições das tools e dos campos que o modelo vê.

## D07 — Provedor de LLM: modelo local via Ollama
- **Data:** 2026-10-19
- **Contexto:** o PDF exige um modelo real (local ou via API) em pelo menos uma execução da avaliação, com o modelo identificado e a configuração documentada.
- **Opções:** (a) API de provedor (Anthropic, OpenAI, Google): tool-calling mais confiável e avaliação estável, mas com custo/cota e dados saindo da máquina · (b) modelo local via Ollama (`@langchain/ollama`): sem custo e dados locais, mas modelos menores erram mais em tool-calling e consomem hardware.
- **Decisão:** (b), modelo local via Ollama (v0.33.0 já instalado). O modelo específico será escolhido no fim do Passo 3, com um smoke de tool-calling.
- **Motivo (Guilherme):**
  1. **Soberania de dados:** o PDF diz que a Qwantyco cria "IA proprietária com soberania de dados". Rodar local mantém dados e prompts na máquina.
  2. **Controle da execução:** com um modelo local sabemos exatamente qual modelo, versão e parâmetros estão rodando, e observamos seu comportamento real, em vez de chamar um serviço externo e torcer pelo melhor.
  3. **Escopo:** o teste usa 3 tools e dados mockados, e um modelo menor tende a ser suficiente.
  4. **Custo:** evita pagar API externa.
  5. **Hardware:** MacBook M2 com 24 GB de RAM roda modelos de porte médio com folga razoável.
- **Riscos e mitigações:**
  - Modelos pequenos podem errar a tool ou os argumentos. É exatamente o cenário que o executor (allowlist + validação Zod) e as guardas de negócio no backend precisam cobrir, e o PDF pede que o bloqueio não dependa só do prompt.
  - O resultado da avaliação pode variar entre execuções. Os testes offline usam modelo falso (determinístico), e a avaliação real é separada.
  - Latência maior que a de uma API. O timeout por tool e o limite de execução ativa precisam considerar isso (Passo 5).
- **Implementação:** um único provedor, sem fábrica multi-provedor. Variáveis `OLLAMA_BASE_URL` e `OLLAMA_MODEL` no `.env`.

## D08 — Opções do esqueleto Next.js
- **Data:** 2026-10-19
- **Decisão:** `create-next-app@16.4.2` com App Router, `src/`, TypeScript `strict`, ESLint, alias `@/*`.
  - **Sem:** Tailwind, React Compiler, Cache Components.
  - **Removidos do template:** Google Fonts (o build não depende de rede) e os assets de demonstração.
- **Motivo:** UI simples e o mínimo de dependências que preciso explicar.

## D09 — Manter o `AGENTS.md` gerado pelo Next
- **Data:** 2026-10-19
- **Contexto:** o `next dev` (16.4) cria e recria um `AGENTS.md` que orienta agentes de código a ler a documentação da versão instalada em `node_modules/next/dist/docs/`.
- **Opções:** manter e versionar · desligar com `agentRules: false` no `next.config.ts`.
- **Decisão:** manter e versionar; o CLAUDE.md aponta para ele.
- **Motivo:** reforça a regra de consultar documentação atual em vez de memória. Se não for versionado, o arquivo reaparece como alteração pendente a cada `next dev`.

## D10 — Segredos e materiais fora do git
- **Data:** 2026-10-19
- **Decisão:**
  - `.env*` ignorado, exceto `.env.example` (só nomes de variáveis, sem valores).
  - `docs/references/` e `*.pdf` ignorados.
  - Chaves nunca em código, logs, traces ou commits.
- **Motivo:** o PDF proíbe enviar segredos; o material de apoio do desafio não deve ser publicado.

## D11 — Duplicidade de escalonamento: idempotência por proposta + bloqueio por chamado
- **Data:** 2026-10-19
- **Contexto:** o PDF diz que "repetir a aprovação não pode duplicar o registro". Falta definir o que é a "mesma operação".
- **Opções:**
  1. Chave por conteúdo: hash de (chamado + resumo + justificativa).
  2. Chave por **id da proposta** (só resolve aprovações repetidas da mesma proposta).
  3. Id da proposta **e** bloqueio de um segundo escalonamento para um chamado que já foi escalonado.
- **Decisão:** (3).
- **Explicação, em duas camadas:**

  **Camada 1 — idempotência por proposta (o que o PDF pede).** Cada proposta recebe um id único quando é criada, por exemplo `prop-7f3a`. O botão "Aprovar" envia esse id. O backend:
  1. confere se ele corresponde à proposta pendente daquela sessão;
  2. registra o escalonamento associado ao id;
  3. se a mesma aprovação chegar de novo, devolve o registro que já existe em vez de criar outro.

  > *Exemplo:* o usuário clica duas vezes em "Aprovar" na proposta `prop-7f3a` do CH-101, ou a rede reenvia a requisição. Resultado: um único registro `ESC-001`. A segunda resposta diz que a operação já foi registrada e aponta o mesmo `ESC-001`.

  **Camada 2 — bloqueio por chamado (proteção extra).** Se o CH-101 já tem um escalonamento registrado, uma nova tentativa de escalonar o CH-101 é recusada. A recusa acontece antes de virar proposta e de novo no momento do registro.

  > *Exemplo:* de manhã o CH-101 foi escalonado (`ESC-001`). À tarde, na mesma sessão ou em outra, alguém pede "escalone o CH-101". O modelo gera uma proposta nova, com outro id e um resumo escrito de outro jeito. Sem a camada 2, isso viraria `ESC-002`, e a equipe receberia dois alertas para o mesmo problema. Com a camada 2, a resposta é: "O CH-101 já foi escalonado (ESC-001)".

  **Por que não usar hash do conteúdo (opção 1)?** O LLM reescreve o texto a cada vez. "Cliente sem acesso ao sistema" e "Cliente não consegue acessar o sistema" geram hashes diferentes, e a duplicata passaria. O conteúdo gerado por modelo não serve como chave de identidade; ids e regras de negócio servem.
- **Trade-off aceito:** não é possível reescalonar legitimamente um chamado (por exemplo, se o problema piorou). Fica fora do escopo e vai para as limitações do README.

## D12 — Plano incremental e cadência de git
- **Data:** 2026-10-19
- **Decisão:** plano de 11 passos em `docs/plano.md`. Mudanças em relação ao rascunho:
  - o Passo 6 foi dividido em API (6) e UI (7);
  - a avaliação foi dividida em offline (9a) e modelo real (9b);
  - a validação de tool desconhecida e de argumentos inválidos foi antecipada para o Passo 3;
  - foi incluído um smoke com o modelo real no fim do Passo 3.

  Git: commit ao fim de cada passo após o OK; push nos passos 1, 3, 5, 7, 9b, 10 e 11.
- **Motivo:** cada passo termina com algo verificável. Os riscos maiores (tool-calling do modelo local, avaliação) aparecem cedo.

## D13 — Validação de contratos com Zod 4
- **Data:** 2026-10-19
- **Opções:** Zod 4 · validação manual.
- **Decisão:** `zod@^4` (4.6.7). Compatível com `@langchain/core` 1.2 (`^3.25.76 || ^4`) e `@langchain/langgraph` 1.5 (`^4.2.0`).
- **Motivo:** um schema serve ao mesmo tempo como validação em tempo de execução, tipo TypeScript (`z.infer`) e JSON Schema da tool para o modelo (Passo 3). Validação manual seria mais código e perderia essa integração.

## D14 — Nomes das tools e dos argumentos
- **Data:** 2026-10-19
- **Opções:** `get_ticket` + `register_escalation` · `get_ticket` + `escalate_ticket`.
- **Decisão:** `listar_chamados(situacao)` (obrigatório pelo PDF), `get_ticket(ticket_id)` e `register_escalation(ticket_id, summary, justification)`. Tudo que o modelo vê fica em snake_case.
- **Motivo:** `register_escalation` traduz literalmente "Registrar escalonamento" do PDF e deixa explícito que é uma operação de escrita.

## D15 — Descrições das tools e dos campos em português
- **Data:** 2026-10-19
- **Opções:** PT · EN.
- **Decisão:** PT (fecha o ponto pendente da D06).
- **Motivo:** as descrições são instruções ao modelo, da mesma natureza do system prompt (PT pela D06). Também ficam coerentes com as mensagens do usuário em PT.

## D16 — Formato do chamado e massa de dados
- **Data:** 2026-10-19
- **Opções:** campo de estado `situacao` · `status`.
- **Decisão:**
  - Chamado = `{ id, title, description, customer, situacao }`, com `situacao` no enum fechado `"aberto" | "resolvido"`.
  - Massa: CH-101 e CH-103 abertos, CH-102 e CH-104 resolvidos. **Nenhum outro aberto.**
  - O `ticket_id` é normalizado (`" ch-101 "` vira `"CH-101"`) e validado no formato `CH-<número>`.
  - Os mocks são validados pelo schema no carregamento, e as funções devolvem cópias (ninguém altera os mocks).
- **Motivo:** o campo de estado tem o mesmo nome do filtro, então o modelo não precisa mapear `situacao` para `status`. Um terceiro chamado aberto quebraria o critério "sem registros extras" do caso obrigatório. (Resolve P1 e P2.)

## D17 — Erros de negócio como dado, não como exceção
- **Data:** 2026-10-19
- **Opções:** (a) retorno `{ ok: true, data } | { ok: false, error: { code, message } }` · (b) lançar exceções tipadas.
- **Decisão:** (a) para erros de negócio. Os códigos atuais são `TICKET_NOT_FOUND`, `TICKET_NOT_OPEN` e `ALREADY_ESCALATED`, e as mensagens ficam em PT. Exceção fica reservada para falha técnica (por exemplo, a falha transitória do Passo 5, que terá retry).
- **Motivo:** o modelo recebe o erro como resultado da tool e não tem como entender que a operação ocorreu. O teste checa o `code`, e o trace mostra o erro estruturado. Separar o erro esperado (negócio) da falha técnica deixa claro o que deve ter retry.

## D18 — Store de escalonamentos em memória e injetável (sem banco)
- **Data:** 2026-10-19
- **Opções:** (a) `createEscalationStore()` injetado nas funções · (b) variável global do módulo com `reset()` para os testes · (c) banco de dados (SQLite/Postgres).
- **Decisão:** (a).
  - `registerEscalation(store, input)` aplica as guardas: chamado existe, está aberto e ainda não foi escalonado (camada 2 da D11).
  - A idempotência por id da proposta (camada 1) fica para o Passo 4.
- **Motivo:**
  - Cada teste cria o seu store, sem contaminação entre testes.
  - **Sobre banco de dados (pergunta do Guilherme):** não é necessário, porque o PDF pede registro "simulado", aceita "dados locais" e diz que "checkpoint em memória é suficiente". As regras avaliadas (bloqueio, idempotência, não confirmar o que não ocorreu) ficam na função de registro e funcionam igual com memória ou com banco. O store tem uma interface pequena (`add`, `findByTicketId`, `list`), então trocar por SQLite ou Postgres em produção mexeria só nessa implementação.
- **Trade-off aceito:** reiniciar o servidor apaga os escalonamentos. Vai para as limitações do README.

---

## Propostas em aberto (confirmar no passo indicado)

| # | Proposta | Passo |
|---|----------|-------|
| P3 | A proposta nasce da tool call de escalonamento emitida pelo modelo. O executor valida e chama `interrupt` **antes** de executar, e a proposta exibida são os argumentos validados. | 4 |
| P4 | O bloqueio de chamado não aberto é checado na criação da proposta **e** de novo no registro. | 4 |
| P6 | Falha transitória determinística e injetável (por exemplo, falhar as N primeiras chamadas), nunca aleatória. | 5 |
| P7 | Checkpointer e registros em memória ancorados em `globalThis`, para sobreviver ao HMR do `next dev`. | 6 |
| P8 | Garantir o envio dos traces antes de a resposta da rota Next terminar (confirmar na documentação do LangSmith). | 8 |
| P9 | Como o runner da avaliação trata um `interrupt` (casos da avaliação devem ficar em consulta). | 9a |
| Q2 | Definição do "limite total de execução ativa": orçamento de tempo de relógio por execução, pausado durante o `interrupt`, mais um máximo de voltas modelo↔tool. | 5 |
