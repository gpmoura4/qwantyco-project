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
- **Decisão:** `listar_chamados(situacao)` (obrigatório pelo PDF), `get_ticket(chamado_id)` e `register_escalation(chamado_id, resumo, justificativa)`. Tudo que o modelo vê fica em snake_case. (Argumentos em PT desde a D20.)
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
  - Chamado = `{ id, titulo, descricao, cliente, situacao }` (campos em PT desde a D20), com `situacao` no enum fechado `"aberto" | "resolvido"`.
  - Massa: CH-101 e CH-103 abertos, CH-102 e CH-104 resolvidos. **Nenhum outro aberto.**
  - O `chamado_id` é normalizado (`" ch-101 "` vira `"CH-101"`) e validado no formato `CH-<número>`.
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
  
- **Trade-off aceito:** reiniciar o servidor apaga os escalonamentos. Vai para as limitações do README.

## D19 — O escalonamento não muda a situação do chamado
- **Data:** 2026-10-19
- **Contexto:** depois de escalonado, o chamado deveria mudar de situação (por exemplo, para "escalonado")?
- **Opções:** (a) mudar a `situacao` do chamado · (b) manter o chamado intacto e guardar os escalonamentos numa coleção separada, ligada pelo `chamado_id`.
- **Decisão:** (b).
- **Motivo:**
  - Os chamados são a massa mockada de leitura, e o escalonamento é um registro novo e independente, como "registrar" sugere no PDF.
  - Mudar a situação teria dois efeitos ruins:
    - criaria um terceiro valor no enum de `situacao`;
    - faria o CH-101 sumir de `listar_chamados({situacao:"aberto"})` depois de escalonado, e o caso obrigatório da avaliação ("CH-101 e CH-103") passaria a depender da ordem em que os testes rodam.
  - "Já foi escalonado?" é respondido consultando a coleção de escalonamentos (`findByTicketId`), não o chamado.
- **Verificação:** teste "keeps the ticket untouched" em `tests/domain.test.ts`.

## D20 — Campos de domínio em português
- **Data:** 2026-10-19
- **Contexto:** `situacao` é obrigatório pelo PDF. Com os outros campos em inglês, o mesmo objeto misturava idiomas (`{ title, customer, situacao }`).
- **Opções:** (a) campos de domínio em EN, com exceção de `situacao` · (b) todos os campos de domínio em PT.
- **Decisão:** (b). Ajusta a D06, a D14 e a D16.
  - **Chamado:** `{ id, titulo, descricao, cliente, situacao }`.
  - **Escalonamento:** `{ id, chamado_id, resumo, justificativa }`.
  - **Argumentos das tools:** `get_ticket(chamado_id)` e `register_escalation(chamado_id, resumo, justificativa)`.
  - **Continuam em EN:** nomes das tools (`get_ticket`, `register_escalation`, D14), identificadores de código (funções, tipos, variáveis), o envelope técnico do resultado (`ok`, `data`, `error`, `code`, `message`) e os códigos de erro (`TICKET_NOT_FOUND` etc.).
- **Motivo:** coerência com o campo obrigatório `situacao` e com o vocabulário do PDF ("chamado, resumo e justificativa"). O modelo vê dados e argumentos no mesmo idioma das mensagens do usuário.

## D21 — Dependências do grafo
- **Data:** 2026-10-19
- **Decisão:**
  - **Runtime:** `@langchain/core` 1.2.18, `@langchain/langgraph` 1.5.1 e `@langchain/ollama` 1.3.0.
  - **Dev:** `tsx` 4.23, antecipado do Passo 9a para rodar `scripts/smoke.ts`. Ele entende o alias `@/`, que o type-stripping nativo do Node não aceita.
  - **Ajuste depois da aprovação:** o `fakeModel()` que a documentação mostra importado de `langchain` é só um re-export de `@langchain/core/testing`. Por isso o pacote `langchain` foi **desinstalado**: é o mesmo modelo falso, com uma dependência a menos.
- **Motivo:** o mínimo da stack definida (D01). Uma única cópia do `@langchain/core` na árvore (verificado com `npm ls`).

## D22 — Estado do grafo com `StateSchema`
- **Data:** 2026-10-19
- **Opções:** (a) `StateSchema` + `MessagesValue` · (b) `Annotation.Root` / `MessagesAnnotation`.
- **Decisão:** (a), começando só com `messages`. Os campos da proposta (Passo 4) e do orçamento de execução (Passo 5) entram quando forem necessários.
- **Motivo:** é a forma atual da documentação do LangGraph JS 1.x (consultada em 2026-10-19), usa Zod e o `MessagesValue` já traz o reducer que acrescenta mensagens. `Annotation.Root` ainda funciona, mas a documentação atual não o mostra mais.

## D23 — Executor próprio em vez de `ToolNode` ou `createAgent`
- **Data:** 2026-10-19
- **Opções:** (a) `StateGraph` + nó executor próprio · (b) `StateGraph` + `ToolNode` pronto · (c) `createAgent` com middlewares.
- **Decisão:** (a). O grafo é `callModel → (executeTools → callModel)* → END`. Para cada tool call, `executeToolCall` (em `src/agent/executor.ts`):
  1. confere a **allowlist** (nome desconhecido → `UNKNOWN_TOOL`);
  2. valida os argumentos com o **schema Zod** da tool (inválido → `INVALID_ARGS`, nada é executado);
  3. executa via `tool.invoke()`, que aparece como run de tool no LangSmith;
  4. devolve um `ToolMessage` com o `ToolResult` em JSON e `status` `success` ou `error`.
- **Motivo:** cada regra fica visível num arquivo só, que é a frase do PDF "o executor valida e executa a função mockada". Aprovação (Passo 4) e retry/timeout (Passo 5) entram no mesmo nó. O `ToolNode` deixaria allowlist e validação implícitas, e o `createAgent` esconderia o grafo.
- **Segurança incremental:** no Passo 3 a allowlist tem só `listar_chamados` e `get_ticket`. O `register_escalation` só entra no Passo 4, junto com o `interrupt`, então nunca existiu um caminho em que o registro rode sem aprovação (há um teste que prova isso).

## D24 — Modelo injetável e modelo falso nos testes
- **Data:** 2026-10-19
- **Decisão:**
  - `buildGraph({ model, checkpointer })`: o app e o smoke passam o `ChatOllama` (`src/agent/model.ts`, configurado só por variável de ambiente, `temperature: 0`), e os testes passam o `fakeModel()` de `@langchain/core/testing`.
  - O `escalationStore` só entra no `buildGraph` no Passo 4, quando houver tool de escrita.
  - O checkpointer é o `MemorySaver`, com uma `thread_id` por sessão.
- **Opções do modelo falso:** `fakeModel()` (recomendado pela documentação, fila de respostas e registro das chamadas em `model.calls`) · `FakeStreamingChatModel` (semântica pouco clara) · fake escrito à mão (mais código).
- **Motivo:** o PDF exige que os testes offline passem "pelo mesmo grafo e executor". O `model.calls` permite provar o T07: a sessão B não recebeu as mensagens da sessão A.

## D25 — Escolha do modelo local: smoke comparativo
- **Data:** 2026-10-19
- **Contexto:** `npm run smoke` roda 4 conversas (listar abertos, consultar o CH-102, consultar o CH-999, consultar o CH-101 + follow-up) com cada modelo já instalado.
- **Resultado:**

  | Modelo (Ollama) | Tool calls | Fidelidade | Observação |
  |---|---|---|---|
  | `qwen2.5:7b-instruct-q4_K_M` | 5/5 corretas | fiel em todos | objetivo; usou o contexto no follow-up |
  | `llama3.1:8b-instruct-q4_K_M` | 5/5 corretas | especulou no CH-999 ("pode ter sido cancelado…") | erros de português |
  | `gemma2:9b-instruct-q4_K_M` | — | — | o Ollama retorna "does not support tools" |
- **Decisão:** `qwen2.5:7b-instruct-q4_K_M`, configurado em `OLLAMA_MODEL`.
- **Motivo:** único modelo fiel ao retorno das tools nos 5 turnos; o llama3.1 especulou num chamado inexistente, o que vai contra a regra "nunca inventar dados".

## D26 — Aprovação humana num nó dedicado (`humanApproval`)
- **Data:** 2026-10-19
- **Contexto:** a documentação do `interrupt` (consultada em 2026-10-19) avisa que, na retomada, **o nó roda de novo desde o começo**. Qualquer efeito colateral antes do `interrupt` se repetiria.
- **Opções:** (a) `interrupt` dentro do executor · (b) nó dedicado `humanApproval`.
- **Decisão:** (b).
  - O `executeTools` valida a tool call `register_escalation` (allowlist, Zod e regras de negócio via `checkEscalationAllowed`) e, se passar, grava `pendingProposal` no estado **sem registrar nada**.
  - O grafo segue para `humanApproval`, que chama `interrupt(proposta)`. Nada com efeito colateral roda antes desse ponto.
  - Depois da decisão, o nó registra (ou não) e o fluxo vai para END.
  - Novo campo no estado: `pendingProposal: { proposal, toolCallId } | null`. O id da proposta é `prop-<uuid>`, gerado no `executeTools` (que não roda de novo na retomada).
  - O `register_escalation` está na allowlist com `requiresApproval: true`. A função da tool lança erro se for executada direto.
- **Motivo:** segue a recomendação da documentação (efeito colateral fora do trecho re-executado), e o LangSmith mostra um nó "humanApproval" pausado e retomado. O chamado resolvido é barrado **antes** de virar proposta (T02), então ninguém aprova algo inválido.
- **Resolve:** P3 (com um ajuste: o `interrupt` fica no nó dedicado, não no executor) e P4 (guarda na proposta e de novo no registro).

## D27 — Validação da aprovação no backend: três barreiras
- **Data:** 2026-10-19
- **Decisão:**
  1. **`decideProposal()`** (`src/agent/approval.ts`): antes de retomar, lê a proposta pendente da sessão (`getPendingProposal`).
     - Sem proposta pendente: devolve o registro existente, se a proposta já foi aprovada (idempotente), ou `NO_PENDING_PROPOSAL`.
     - Id diferente: `PROPOSAL_MISMATCH`, sem tocar no grafo.
     - Só retoma com `Command({ resume })` se o id bater.
  2. **`responseSchema` Zod no `interrupt`:** o valor de retomada precisa ser `{ proposta_id, decisao: "aprovar" | "rejeitar" }`. Fora disso, o LangGraph lança erro e o grafo continua pausado. O nó também confere o `proposta_id` (defesa caso alguém retome o grafo sem passar pela função).
  3. **Store idempotente por proposta:** o escalonamento guarda `proposta_id`, e `registerEscalation` devolve o registro existente se a mesma proposta chegar de novo. É a garantia final, mesmo com dois cliques simultâneos.
- **Nomes:** o payload de decisão usa campos em PT (`proposta_id`, `decisao`, `"aprovar"`/`"rejeitar"`), por coerência com a D20. Na proposta da conversa estava escrito `{ proposalId, decision }`.
- **Motivo:** o PDF exige que a aprovação seja "validada no backend e vinculada à proposta" e que repeti-la "não duplique o registro". Defesa em camadas: na mutação que removeu a barreira 1, a barreira do nó ainda impediu o registro.

## D28 — Confirmação de escrita determinística (não escrita pelo LLM)
- **Data:** 2026-10-19
- **Opções:** (a) o LLM escreve a mensagem depois de aprovar ou rejeitar · (b) rejeitar é determinístico, aprovar passa pelo LLM · (c) as duas são determinísticas.
- **Decisão:** (c). O `humanApproval` grava o `ToolMessage` com o resultado real e uma `AIMessage` montada pelo código (`confirmationText`), e vai para END:
  - "Escalonamento ESC-001 registrado para o chamado CH-101."
  - "Escalonamento rejeitado. Nada foi registrado."
  - "Não foi possível registrar o escalonamento: …"
- **Motivo:** "nunca confirmar operação que não ocorreu" vale **por construção**: a confirmação de uma escrita nunca depende de um modelo probabilístico. Também cumpre ao pé da letra "se a pessoa rejeitar, encerre sem registrar". A conversa continua normalmente com o LLM na mensagem seguinte, e o histórico contém o resultado.
- **Verificação com o modelo real (smoke):** o qwen2.5 consultou o CH-101, propôs, foi aprovado e virou ESC-001; o CH-103 foi rejeitado sem registro; no CH-102 o modelo nem propôs. Observação: o modelo acrescentou uma inferência na justificativa ("afetando a operação diária"), o que reforça o valor de a pessoa ver a proposta exata antes de aprovar.

## D29 — Retry e timeout com as políticas nativas do LangGraph
- **Data:** 2026-10-20
- **Contexto:** a documentação geral não cobre o assunto. Os tipos instalados do `@langchain/langgraph` 1.5 mostram `retryPolicy` (`maxAttempts`, `initialInterval`, `backoffFactor`, `retryOn`) e `timeout` (por tentativa, reiniciado a cada retry, lança `NodeTimeoutError`) como opções de `addNode`.
- **Opções:** (a) retry e timeout escritos à mão no executor · (b) políticas nativas nos nós.
- **Decisão:** (b).
  - `executeTools`: até 3 tentativas, timeout de 5 s por tentativa, retry **só** para `TransientToolError` ou `NodeTimeoutError`.
  - `callModel`: até 2 tentativas, timeout de 60 s, retry para qualquer erro exceto abort.
  - Backoff exponencial começando em 500 ms, com jitter (padrão do LangGraph).
  - Valores em `DEFAULT_LIMITS` (`src/agent/run.ts`); os testes injetam limites pequenos.
- **Motivo:** idiomático do framework, quase sem código, e cada tentativa aparece no log ("Retrying task executeTools…") e no trace. Erros de negócio são dados (D17) e por isso nunca são retentados. O retry re-executa o nó inteiro, o que é seguro: as leituras são idempotentes e o registro só acontece no `humanApproval`.

## D30 — Limite total de execução ativa por invocação (`runAgent`)
- **Data:** 2026-10-20
- **Opções:** (a) limite por invocação (`recursionLimit` + `AbortSignal.timeout`) · (b) orçamento acumulado em campos do estado.
- **Decisão:** (a).
  - Toda chamada ao grafo passa por `runAgent()`, com `recursionLimit: 12` e prazo de 120 s.
  - Os estouros viram erros controlados: `GraphRecursionError` vira `EXECUTION_LIMIT` (passos), o abort vira `EXECUTION_LIMIT` (tempo) e a falha técnica que esgotou as tentativas vira `EXECUTION_FAILED`. A mensagem em PT sempre diz que nenhuma operação foi registrada.
  - O `decideProposal` e o smoke usam `runAgent`, e a rota da API também usará.
- **Motivo:** a pausa para aprovação **encerra** a invocação, e a decisão humana é outra invocação com orçamento próprio. A espera humana fica fora do limite por construção, sem campos novos no estado (teste: esperar 500 ms com orçamento de 300 ms e aprovar com sucesso). Resolve o Q2.
- **Limitação conhecida:** se um run falha no meio, o checkpoint pode ficar com uma tool call sem `ToolMessage`. A sessão continua funcionando (testado), mas o histórico não registra a falha. Vai para as limitações do README.

## D31 — Injeção de falhas determinística (`faults`)
- **Data:** 2026-10-20
- **Opções:** (a) opção `faults` no `buildGraph` + variável `SIMULATE_TOOL_FAILURE` · (b) tools defeituosas só nos testes.
- **Decisão:** (a).
  - Formato `tool:modo:vezes` (ex.: `listar_chamados:error:2`). Cada tool call falha nas N primeiras tentativas e depois funciona.
  - Modos: `error` (lança `TransientToolError`), `timeout` (trava até o timeout do nó abortar) e `invalid_output` (retorno corrompido).
  - Desligado por padrão. Uma entrada malformada lança erro, para não ser ignorada em silêncio.
- **Motivo:** um único mecanismo serve aos testes e à demonstração ao vivo no LangSmith.
- **Verificação com o modelo real:** `listar_chamados:error:2` recuperou na 3ª tentativa e respondeu CH-101 e CH-103; `listar_chamados:error:3` terminou em `EXECUTION_FAILED`, sem resposta inventada.

## D32 — Validação de saída: das tools e do modelo
- **Data:** 2026-10-20
- **Decisão:**
  - **Saída da tool:** cada tool de leitura tem um `outputSchema` Zod (`toolResultSchema`). Um retorno fora do contrato vira `INVALID_OUTPUT`, e o dado corrompido nunca chega ao modelo. Não é retentado, porque é um erro de dados e não uma falha transitória.
  - **Saída do modelo:** tool calls com JSON malformado (`invalid_tool_calls` do LangChain) recebem `INVALID_ARGS` em vez de serem ignoradas, e o `routeAfterModel` também roteia nesse caso.
- **Motivo:** o PDF pede tratar "entrada ou saída inválida" e "não executar ferramenta indevida". Modelos locais às vezes emitem JSON quebrado.

## D33 — API: duas rotas finas e contrato de resposta
- **Data:** 2026-10-20
- **Contexto:** guia de Route Handlers do Next 16.4 instalado (`node_modules/next/dist/docs/`). Um `route.ts` exporta funções `POST(request: Request): Response`; o runtime padrão é Node.js (Edge está deprecated) e `POST` nunca é cacheado.
- **Opções:** (a) duas rotas, uma para mensagem e outra para decisão · (b) uma rota com campo `action`.
- **Decisão:** (a).
  - `POST /api/chat` recebe `{ sessionId, message }`.
  - `POST /api/chat/decision` recebe `{ sessionId, proposta_id, decisao }`.
  - As rotas só validam o corpo (Zod, `parseBody`), chamam o core (`src/agent/chat.ts`: `sendMessage` e `sendDecision`) e traduzem o resultado em HTTP (`toResponse`). Nenhuma regra de negócio fica nelas.
  - Respostas:
    - 200 com `{ kind: "reply", reply }` ou `{ kind: "approval_required", proposal, reply }`;
    - 400 `INVALID_REQUEST`;
    - 409 `PROPOSAL_PENDING`, `NO_PENDING_PROPOSAL` ou `PROPOSAL_MISMATCH`;
    - 503 `EXECUTION_LIMIT` ou `EXECUTION_FAILED`.
- **Motivo:** bate 1:1 com o PDF ("mensagem" e "decisão de aprovação") e com o core. Os handlers são funções comuns, testadas no Vitest sem subir servidor (`tests/api.test.ts`).

## D34 — Sessão identificada por UUID gerado no cliente
- **Data:** 2026-10-20
- **Opções:** (a) o cliente gera um UUID, validado com Zod, que vira o `thread_id` · (b) cookie httpOnly gerado pelo servidor.
- **Decisão:** (a).
- **Motivo:** simples, e "Nova conversa" na UI é só gerar outro UUID, o que facilita demonstrar sessões separadas. Um UUID v4 não é adivinhável.
- **Limitação:** o servidor confia no id recebido. Em produção, a sessão viria da autenticação. Vai para as limitações do README.

## D35 — Runtime único em `globalThis`
- **Data:** 2026-10-20
- **Opções:** (a) `getRuntime()` com o grafo, o store e os limites guardados em `globalThis` · (b) singleton simples de módulo.
- **Decisão:** (a), em `src/agent/runtime.ts`.
  - `createRuntime({ model, faults, limits })` monta o grafo (com `MemorySaver`) e o store.
  - `getRuntime()` cria uma vez com `ChatOllama` e as `faults` do `.env`.
  - `setRuntimeForTests()` permite aos testes de rota usar um `fakeModel`.
- **Motivo:** o HMR do `next dev` reavalia os módulos a cada edição. Com um singleton simples, isso apagaria todas as sessões e escalonamentos. Resolve o P7.

## D36 — Mensagem nova com proposta pendente é recusada (409)
- **Data:** 2026-10-20
- **Opções:** (a) recusar com `409 PROPOSAL_PENDING` · (b) rejeitar automaticamente a proposta e processar a mensagem.
- **Decisão:** (a). A checagem fica no `sendMessage`, antes de invocar o grafo.
- **Motivo:** nenhuma decisão humana é tomada por inferência do sistema, e nada fica pendurado no checkpoint. A UI também vai desabilitar o envio enquanto houver proposta.
- **Verificação com o modelo real (`next dev` + `curl`):**
  - listar → 200 com CH-101 e CH-103;
  - escalonar o CH-101 → 200 `approval_required` com a proposta exata;
  - mensagem com proposta pendente → 409;
  - outra sessão aprovando → 409 `NO_PENDING_PROPOSAL`;
  - aprovar → `ESC-001`;
  - aprovar de novo → "já registrado";
  - corpo inválido → 400.

## D37 — UI de chat: Client Component com `fetch`, CSS Module, sessão só no estado
- **Data:** 2026-10-20
- **Contexto:** guia do Next 16.4 instalado. Páginas são Server Components por padrão, e interatividade exige `'use client'`. O Next também oferece Server Functions (`'use server'`).
- **Opções:**
  - **Comunicação:** (a) Client Component chamando as rotas do Passo 6 com `fetch` · (b) Server Functions.
  - **Estilo:** (a) CSS Module · (b) inline · (c) Tailwind (recusado na D08).
  - **Sessão:** (a) só no estado React · (b) `sessionStorage` + rota de histórico.
- **Decisão:** (a) nas três.
  - `src/app/page.tsx` (Server Component) renderiza `src/app/chat.tsx` (`'use client'`), estilizado por `chat.module.css`.
  - O UUID da sessão é criado na primeira mensagem, e "Nova conversa" gera outro.
  - O cartão da proposta mostra chamado, resumo, justificativa e id **exatamente** como vieram da API, com os botões Aprovar e Rejeitar.
  - O campo de mensagem fica bloqueado enquanto há proposta pendente ou requisição em andamento.
  - Os erros 400, 409 e 503 aparecem como aviso com a mensagem em PT do backend.
  - Os tipos de resposta vêm do core via `import type`, que é apagado na compilação: nenhum código de servidor vai para o navegador.
- **Motivo:**
  - A UI é só mais um cliente da API já testada, então existe um caminho único até o core. Server Functions criariam uma segunda porta de entrada, sem testes.
  - O CSS Module é nativo e não exige dependência.
  - A sessão no estado React é a opção mais simples, e trocar o UUID demonstra a separação de sessões.
- **Limitação:** recarregar a página começa uma sessão nova na UI. O servidor mantém o histórico, mas a UI não o recupera.
- **Verificação:** Chrome headless (Puppeteer do cache do `mermaid-cli`, fora do projeto) dirigiu a UI real com o modelo real:
  - listagem com CH-101 e CH-103;
  - escalonamento do CH-101 mostrou o cartão, com o campo bloqueado;
  - Aprovar resultou em "ESC-001 registrado", e o cartão sumiu;
  - "Nova conversa" trocou a sessão e limpou o histórico;
  - escalonar o CH-103 e Rejeitar resultou em "Nada foi registrado".

## D38 — Status de escalonamento: fonte de verdade na leitura e resultado da aprovação no mesmo formato
- **Data:** 2026-10-20
- **Contexto (achado do Guilherme testando a UI):** depois de escalonar e aprovar o chamado da Padaria Pão Dourado (CH-101), a pergunta "qual o status do chamado?" teve como resposta "aberto, ainda não foi escalonado e continua em análise". Isso é **dado inventado**, contra a regra principal do PDF.
- **Diagnóstico** (reproduzido com o modelo real):
  1. **Faltava fonte de verdade.** Pela D19, o escalonamento não altera o chamado, mas nenhuma tool expunha a coleção de escalonamentos. O `get_ticket` dizia só "aberto".
  2. **O modelo responde sem reconsultar.** O qwen 7B responde perguntas de acompanhamento a partir do histórico e preenche lacunas.
- **Opções:** (a) enriquecer as tools de leitura com o campo `escalonamento` · (b) nova tool `get_escalation`.
- **Decisão:** (a), mais prompt reforçado, teste offline e caso de avaliação no Passo 9 (F1–F4 aprovados pelo Guilherme), com um ajuste descoberto nos experimentos:
  - **F1 — Visão de leitura:** `listar_chamados` e `get_ticket` devolvem o chamado mais `escalonamento` (`null` ou `{ id, resumo, justificativa }`), calculado do store (`getTicketView` e `listTicketViews`). O chamado continua intacto (D19). As tools passam a ser criadas por runtime (`createTools(store)`).
  - **F1b — Resultado da aprovação no mesmo formato (achado nos experimentos):** ao registrar, o `ToolMessage` do `register_escalation` passa a conter a **visão atualizada do chamado** (com `"escalonamento": { "id": "ESC-001" }`), e não mais o registro bruto.
  - **F2 — Prompt reorganizado** em seções com passos numerados: regras gerais; procedimento de escalonamento ("chame `register_escalation` logo em seguida, sem pedir confirmação; a confirmação é a aprovação humana"); como ler `situacao` e `escalonamento`; "nunca diga que fez algo sem ter chamado a ferramenta".
  - **F3 — Medição:** teste offline (`get_ticket` antes e depois da aprovação, resultado da aprovação no formato da visão, listagem de abertos inalterada). No Passo 9, este cenário vira o **caso adicional da avaliação**.
  - **F4 — Texto simples:** o prompt pede respostas sem Markdown. Funciona só em parte: o modelo ainda usa `**` às vezes. É cosmético e não vale uma dependência de Markdown na UI.
- **Experimentos com o modelo real** (5 cenários: listar, CH-101 com perguntas de acompanhamento, CH-103, CH-102, o fluxo do Guilherme; temperatura 0, 2 rodadas idênticas):

  | Variante | CH-101 propõe | CH-103 propõe | Acompanhamento após aprovar |
  |---|---|---|---|
  | Prompt com regras soltas novas | ❌ | ❌ e **diz que registrou** | — |
  | Prompt antigo + F1 | ✅ | ❌ | sem consulta, incompleto |
  | Prompt em passos (F2) + F1 | ✅ | ✅ | ❌ "ainda não foi escalonado" (lia o `null` antigo do histórico) |
  | F2 + F1 + contexto de escalonamentos injetado no system prompt | ❌ | ✅ | ❌, e o fluxo do Guilherme quebrou (descartado) |
  | **F2 + F1 + F1b (adotado)** | ✅ | ✅ | ✅ "foi escalonado (ESC-001)" |
- **Motivo:**
  - O modelo obedece ao dado **mais recente** sobre o chamado no histórico. Se esse dado tem o mesmo formato e é verdadeiro, a resposta é verdadeira, mesmo quando o modelo não reconsulta a tool.
  - A correção que funcionou foi **estrutural** (o formato dos dados), não o texto do prompt. Mudanças de prompt alteraram o comportamento do 7B de forma imprevisível, inclusive para pior.
- **Limites honestos:** o modelo ainda não reconsulta `get_ticket` nas perguntas de acompanhamento, apesar da regra do prompt. Ele acerta porque o histórico agora é coerente. Uma afirmação inventada em texto livre não é bloqueável só por código, e por isso este cenário vai para a avaliação (Passo 9).

## D39 — Manter o qwen2.5 7B (sem modelo maior)
- **Data:** 2026-10-20
- **Contexto:** com texto livre ("escalone o chamado do pão dourado" depois de uma listagem), o 7B consultava o chamado e respondia "proposta criada" **sem chamar `register_escalation`**: nenhum cartão e uma afirmação falsa. Reproduzido 3/3. Cinco variações de prompt corrigiam um cenário e quebravam outro, e uma delas fez o modelo escrever a tool call como texto.
- **Opções:** (a) testar o `qwen2.5:14b-instruct` (cerca de 9 GB, cabe nos 24 GB) com um roteiro fixo · (b) guarda em código contra afirmação sem ação · (c) aceitar e documentar.
- **Decisão:** não baixar modelo novo e seguir com (b), mais orientação na interface (D40, D41).
- **Risco registrado (decisão contra a recomendação (a) do Claude):** o 7B continua no limite para tool calling em conversas longas e com texto livre. O guard reduz e torna visível, mas não elimina: quando a correção falha, o usuário recebe uma mensagem honesta, sem cartão. Para a apresentação, os botões de ação rápida usam frases medidas como estáveis. Se aparecerem novas falhas, a troca de modelo continua sendo a correção de raiz.

## D40 — Guard da resposta final (`checkReply`)
- **Data:** 2026-10-20
- **Decisão:** novo nó `checkReply` (`src/agent/guard.ts`). Toda resposta final do modelo (sem tool calls) passa por ele antes de ir ao usuário. Ele aplica três checagens, todas baseadas em **evidência das tools**:
  1. **Pedido de escalonamento não executado:** o usuário pediu no imperativo e sem ser pergunta ("escalone", "prepare um escalonamento"); o `get_ticket` do turno mostrou o chamado aberto e sem escalonamento; não houve `register_escalation`.
  2. **Afirmação sem ação:** o texto diz que criou, preparou ou vai propor uma proposta ("proposta … criada", "proporei", "vou propor"…), mas não houve `register_escalation` no turno.
  3. **Dado sem fonte:** a resposta cita `CH-xxx` ou `ESC-xxx` que não apareceu em nenhum retorno de tool da conversa.

  Quando há violação, a resposta é removida do histórico (`RemoveMessage`) e o modelo recebe **uma** correção marcada (`name: "reply_guard"`), com instrução objetiva, por exemplo: "não peça confirmação; chame `register_escalation` com `chamado_id` CH-101". Se violar de novo no mesmo turno, a resposta é **substituída** por uma mensagem honesta com a frase recomendada. No máximo uma correção por turno, sem loop.
- **Motivo:** o PDF exige "nunca inventar dados ou confirmar uma operação que não ocorreu" e "não depender só do prompt". O guard confere o texto contra fatos do sistema (tool calls e resultados), não contra a opinião do modelo.
- **Verificação com o modelo real** (5 cenários × 2 rodadas, todos corretos):
  - o fluxo do print do Guilherme gera o cartão, com o guard corrigindo uma vez;
  - os botões no CH-101 depois de uma consulta prévia geram o cartão, também com uma correção;
  - o fluxo "Sim" e o CH-103 geram o cartão;
  - o CH-102 é recusado;
  - as perguntas de status depois da aprovação são verdadeiras.
- **UI real (Chrome headless):** botões → cartão → aprovar → "escalonado"; texto livre "escalone o chamado da Transportadora Rota Sul" → cartão → aprovar → status correto.
- **Limites:** as checagens 1 e 2 dependem de padrões de texto em PT (imperativos e frases de proposta). Uma redação nova pode escapar, e por isso cada redação real encontrada vira teste (`tests/guard.test.ts`). Uma pergunta ("já foi escalonado?") nunca dispara a checagem 1.

## D41 — Orientação na interface: ajuda e ações rápidas
- **Data:** 2026-10-20
- **Decisão:** a UI ganha um bloco "Como usar" e três ações rápidas com um campo de identificador:
  - "Listar chamados abertos" envia "Liste todos os chamados abertos.";
  - "Consultar" envia "Consulte o CH-xxx.";
  - "Preparar escalonamento" envia "Consulte o CH-xxx e prepare um escalonamento se ele estiver aberto.".

  O texto livre continua funcionando, com o guard por trás.
- **Motivo:** as frases dos botões foram as mais estáveis nas medições com o 7B. O modelo continua no circuito (ele emite as tool calls, como o PDF exige); a UI só padroniza o pedido. Além disso, a demonstração fica reproduzível.

## D42 — Envio dos traces depois da resposta (`after()` + `awaitAllCallbacks`) — resolve P8
- **Data:** 2026-10-21
- **Contexto:** o `@langchain/core` 1.2 envia os traces em background por padrão (só bloqueia com `LANGCHAIN_CALLBACKS_BACKGROUND=false`, `callbacks/base.js`). Num processo que fica de pé (`next dev`/`next start`) eles chegam. Num ambiente serverless, o processo pode parar logo após a resposta, e os traces se perdem. Processos curtos (smoke, eval) também terminam antes do envio.
- **Opções:** (1) nada nas rotas, só aguardar nos scripts · (2) `after(() => awaitAllCallbacks())` nas rotas + aguardar nos scripts · (3) `LANGCHAIN_CALLBACKS_BACKGROUND=false`, que bloqueia cada callback e atrasa toda resposta.
- **Decisão:** (2), recomendação do Claude, aprovada pelo Guilherme. `flushTracesAfterResponse()` em `src/app/api/chat/http.ts`, chamado no início das duas rotas. O `scripts/smoke.ts` aguarda `awaitAllCallbacks()` no `finally`.
- **Motivo:** `after()` (Next 16) roda depois de a resposta sair, então o usuário não espera o envio e o envio fica garantido em qualquer ambiente. É o padrão da documentação do LangSmith para Next. Fica na borda Next, e o core continua sem importar `next`.
- **Teste:** `tests/api.test.ts` mocka `next/server` (o `after()` lança erro fora de uma requisição do Next) e confere que as duas rotas agendam o envio.

## D43 — Identidade de cada execução no trace
- **Data:** 2026-10-21
- **Contexto:** o R15 pede correlação por sessão e por execução. O LangGraph já copia o `thread_id` do `configurable` para a metadata de todos os runs (`PROPAGATE_TO_METADATA`), e a tela Threads do LangSmith agrupa por `thread_id`. Mas todo run raiz se chamava "LangGraph", e não dava para distinguir uma mensagem de uma retomada.
- **Opções:** (1) só o automático · (2) `runName`, tags e metadata no `runAgent` · (3) a (2) mais um `runId` próprio devolvido pela API e mostrado na UI.
- **Decisão:** (2), recomendação do Claude, aprovada pelo Guilherme. `traceConfig(input)` em `run.ts` deriva tudo da entrada:
  - mensagem: `runName: "aurora_message"`, tags `["aurora", "message"]`, metadata `{ run_kind: "message" }`;
  - retomada (`Command`): `runName: "aurora_resume"`, tags `["aurora", "resume"]`, metadata `{ run_kind: "resume", proposta_id }`.
- **Motivo:** um lugar só (toda execução passa pelo `runAgent`), sem mudar assinaturas nem o contrato da API. Dá para filtrar por tag, e a retomada fica ligada à proposta.
- **Teste:** `tests/tracing.test.ts` captura os runs em memória (`RunCollectorCallbackHandler`, sem rede) e confere nome, tags, metadata e `thread_id` da mensagem e da retomada. Confere também a árvore: nós, chamada ao modelo (`llm`) e run da tool sob o `executeTools`, com args e resultado.
- **Verificado no LangSmith (smoke real, 2026-10-21):**
  - 12 traces raiz (10 mensagens + 2 retomadas), cada retomada com `proposta_id` e o mesmo `thread_id` da conversa;
  - a árvore mostra `callModel` → `ChatOllama` (com `ls_model_name`), `executeTools` → `get_ticket`/`listar_chamados` com entrada e saída;
  - com `SIMULATE_TOOL_FAILURE=listar_chamados:error:2`, cada tentativa aparece como um `executeTools` com erro e a mensagem da falha, seguido do que deu certo.
- **Como ler o trace (para a apresentação):**
  - o `humanApproval` aparece como **erro** no trace da mensagem. É o `interrupt`: o LangGraph pausa lançando `GraphInterrupt`, e o "erro" traz a proposta exata. A raiz fica `success`;
  - a proposta aparece na saída do `executeTools` (`pendingProposal`). O `register_escalation` nunca executa direto, por isso não tem run de tool próprio;
  - o trace da retomada mostra o `Command` com a decisão e, na saída do `humanApproval`, a visão do chamado com `ESC-xxx`.

## D44 — Segredos nos traces e testes sem rede
- **Data:** 2026-10-21
- **Decisão:** sem mascaramento (`LANGSMITH_HIDE_INPUTS` ou `anonymizer`); recomendação do Claude, aprovada pelo Guilherme. No `vitest.config.mts`, as quatro variáveis que ligam o tracing (`LANGSMITH_TRACING`, `LANGSMITH_TRACING_V2`, `LANGCHAIN_TRACING`, `LANGCHAIN_TRACING_V2`) ficam fixadas em `"false"`. Qualquer uma delas com `"true"` liga o tracing (`@langchain/core/dist/utils/callbacks.js`).
- **Motivo:** os dados são fictícios, e a chave não entra no trace: o SDK só anexa variáveis `LANGSMITH_*`/`LANGCHAIN_*` e exclui `*_API_KEY` e nomes sensíveis (`langsmith/lib/utils/env.mjs`). Esconder as entradas apagaria justamente o que o PDF pede para mostrar. Fixar as variáveis no Vitest garante que nem um `export` no shell faz um teste mandar dados para fora.
- **Verificação:** os 12 traces do smoke, com todos os runs filhos, foram baixados pela API e nenhum contém o valor da chave. A metadata tem só `LANGSMITH_TRACING`, dados do SDK e do runtime, `run_kind` e `thread_id`.
- **Teste:** `tests/tracing.test.ts` falha se alguma das quatro variáveis não estiver `"false"`.

## D45 — Avaliação com `evaluate()` do LangSmith; `langsmith` como dependência direta
- **Data:** 2026-10-21
- **Opções:** (1) script `npm run eval` com `evaluate()` de `langsmith/evaluation` · (2) integração Vitest (`langsmith/vitest`), em que o dataset e o experimento nascem dos arquivos de teste.
- **Decisão:** (1), recomendação do Claude, aprovada pelo Guilherme. O `langsmith` passa a ser dependência direta, **fixada em 0.11.0**: a mesma versão que o `@langchain/core` já instalava. O lockfile ganhou só a linha da dependência raiz, e nenhum pacote novo foi baixado.
- **Motivo:** o `evaluate()` mostra explicitamente as quatro peças (dataset → target → avaliadores → experimento), o que facilita explicar. A opção (2) mistura o Vitest com o modelo real, e o PDF pede para separar os testes offline da avaliação.
- **Estrutura** (`evals/`, prevista na D05):
  - `dataset.ts`: os casos;
  - `target.ts`: `runCase`, que roda um caso;
  - `evaluators.ts`: `evaluateCase`;
  - `run.ts`: o `evaluate()`, no Passo 9b.
- **Nota para o 9b:** o SDK passa `outputs` e `referenceOutputs` como `Record<string, any>`, então o `run.ts` terá um adaptador de uma linha para o `evaluateCase`, que continua tipado.

## D46 — O avaliador examina o registro do turno, extraído do estado do grafo
- **Data:** 2026-10-21
- **Opções:** (1) o target devolve um registro estruturado do turno, tirado do estado do grafo, e o avaliador é uma função pura sobre ele · (2) o avaliador percorre a árvore do trace (`run.child_runs`).
- **Decisão:** (1), recomendação do Claude, aprovada pelo Guilherme.
  - **Target:** `runCase(model, inputs)` cria um runtime **novo por caso** (sessões e escalonamentos não vazam entre casos). Ele usa as mesmas portas da UI (`sendMessage`, `sendDecision`) e devolve, por turno: a resposta mostrada ao usuário, as tool calls do modelo, os resultados (os `ToolMessage` que o executor ou o `humanApproval` produziram), a proposta, a decisão e o erro controlado. Devolve também os escalonamentos registrados.
  - **Avaliador:** uma nota (0/1) por critério, para cada um virar uma coluna no experimento, mais `pass`, que só é 1 quando todos são 1. Os comentários ficam em PT e explicam a nota (por exemplo, "omitidos: CH-103; extras ou inventados: nenhum").
  - **Caso obrigatório (`list_open`):**
    - `tool_called`: houve `listar_chamados` com **exatamente** `{"situacao":"aberto"}`;
    - `tool_succeeded`: o resultado **dessa** chamada (pareado pelo `tool_call_id`) tem `ok: true`;
    - `tool_matches_reference`: os ids retornados são os esperados no dataset;
    - `answer_matches_tool`: os `CH-xxx` da resposta são exatamente os do resultado, sem omissão nem extra;
    - `no_side_effects`: nenhuma proposta e nenhum registro.
- **Motivo:** um `ToolMessage` só existe se o executor de fato executou a tool. É evidência do sistema, não texto do modelo, e é isso que o PDF pede ("só acertar o texto ou mencionar a ferramenta não basta"). A função pura é testável offline pelo mesmo grafo.
- **Limite:** os "dados inventados" são conferidos **pelos ids**. Um título ou cliente errado no texto livre não é detectado.
- **Testes** (`tests/evaluators.test.ts`, 19 testes): o avaliador puro, com o resultado real de `listTicketViews`, reprova os casos de consulta pulada, chamado inventado, chamado omitido, argumento errado (outra situação, sem filtro, argumento extra), consulta com falha e proposta durante a listagem. Pelo grafo, com o modelo falso: o modelo correto passa; o que pula a consulta e o que inventa o CH-105 reprovam. No caso da invenção, o guard (D40) troca a resposta, e o avaliador reprova por omissão. Mutação: 10 alterações no avaliador e no target, todas pegas pelos testes. A única que escapou na primeira rodada (ids sem fonte no caso adicional) ganhou um teste próprio.

## D47 — Caso adicional (P10) e tratamento do `interrupt` na avaliação (P9)
- **Data:** 2026-10-21
- **Opções:** (1) fluxo real na mesma sessão, com a aprovação feita por código · (2) escalonamento semeado no store, sessão nova, só a pergunta · (3) histórico semeado à mão e depois a pergunta.
- **Decisão:** (1), recomendação do Claude, aprovada pelo Guilherme. O caso `status_after_approval` tem dois turnos:
  1. "Consulte o CH-101 e prepare um escalonamento se ele estiver aberto." Quando o grafo pausa, o target **faz o papel do humano** e aprova com `sendDecision`, que passa pela mesma validação de backend da UI.
  2. "O CH-101 já foi escalonado?"
- **P9 resolvida:** o `interrupt` é tratado aprovando ou rejeitando por código, conforme o `decisao` do caso. Sem `decisao`, a proposta é rejeitada, nada é registrado e o caso reprova em `no_side_effects`.
- **Critérios do caso adicional:**
  - `escalation_registered`: o pré-requisito. A proposta foi aprovada e o registro existe;
  - `answer_matches_status`: a resposta concorda com o `escalonamento` da **última** visão do chamado em qualquer resultado de tool da conversa (`get_ticket`, `listar_chamados` ou o resultado da aprovação, D38). Se houver escalonamento, a resposta precisa afirmar e não pode negar. A negação ("não foi escalonado", "sem escalonamento") prevalece sobre a afirmação;
  - `answer_ids_backed`: nenhum `CH-`/`ESC-` sem fonte nas tools.
- **Motivo:** reproduz o bug real da D38 (resposta de acompanhamento a partir do histórico) e mostra aprovação e retomada dentro do experimento. Se o 7B falhar no turno 1, o caso reprova no pré-requisito, e isso é um resultado honesto.
- **Limite:** a afirmação e a negação são reconhecidas por padrões de texto em PT, com a mesma limitação do guard. O "ESC-001" não é exigido no texto, porque no smoke o modelo respondeu certo sem citá-lo.

## D48 — Dataset do LangSmith sincronizado com o código a cada execução
- **Data:** 2026-10-21
- **Opções:** (1) criar só se não existir · (2) sincronizar a cada execução · (3) apagar e recriar sempre, o que apaga os experimentos antigos.
- **Decisão:** (2), recomendação do Claude, aprovada pelo Guilherme. `evals/sync.ts`: `syncDataset` cria o dataset `aurora-suporte` se não existir. `planSync`, uma função pura, compara inputs e gabarito dos examples com os `CASES`: cria os que faltam e apaga os que saíram do código ou ficaram duplicados. Um caso alterado vira apagar mais criar. A comparação ignora a ordem das chaves devolvida pela API.
- **Motivo:** o `evals/dataset.ts` é a única fonte. Um caso novo, como numa alteração ao vivo, aparece no próximo `npm run eval`. Cada mudança gera uma versão nova do dataset, e os experimentos antigos continuam ligados à versão que usaram. A exclusão é lógica (padrão do SDK).
- **Teste:** `planSync` em `tests/evaluators.test.ts`: dataset vazio, dataset igual com as chaves em outra ordem, caso novo e caso removido, gabarito alterado e duplicado. Mutação: as 3 alterações foram pegas.
- **Verificado:** a primeira execução criou 2 examples; as seguintes, 0 criados e 0 removidos.

## D49 — Experimento com o modelo real: 3 repetições por caso
- **Data:** 2026-10-21
- **Opções:** 1, 3 ou 5 ou mais repetições.
- **Decisão:** 3 (`REPETITIONS` em `evals/run.ts`), recomendação do Claude, aprovada pelo Guilherme. Os casos rodam um de cada vez (`maxConcurrency: 1`): o Ollama local atende uma requisição por vez, e em paralelo os casos estourariam o limite de 120 s.
- **Configuração registrada no experimento (R19):** prefixo `aurora-<modelo>` e metadata `{ provider: "ollama", model, temperature: 0, repetitions, limits }`. O LangSmith acrescenta sozinho o git (`commit`, `dirty`, `branch`, `remoteUrl`) e a versão do dataset. Por isso a função própria de commit, que chegou a ser escrita, foi removida.
- **Resultado (2026-10-21, `qwen2.5:7b-instruct-q4_K_M`, commit `7ed9def` com mudanças locais):** **6/6 `pass`**.
  - Caso obrigatório: 3/3, sempre com `listar_chamados({"situacao":"aberto"})`.
  - Caso adicional: 3/3. A aprovação foi feita pelo target, e a resposta "O chamado CH-101 já foi escalonado…" veio **sem nova consulta**, a partir do resultado da aprovação no histórico (D38 F1b).
  - As três repetições foram idênticas (`temperature: 0`). Cerca de 90 s no total.
  - Cada run do experimento abre o trace completo do agente (`aurora_message`, `humanApproval`, `aurora_resume`…), aninhado sob o run do caso.
- **Leitura honesta:** 3/3 com `temperature: 0` mostra que esses dois cenários, com essas frases, são estáveis. Não mostra robustez a texto livre, que continua sendo o ponto fraco do 7B (D39).

## D50 — Demonstração do avaliador dentro do LangSmith
- **Data:** 2026-10-21
- **Opções:** (1) só os testes no terminal · (2) o grafo com um modelo falso mal-comportado, em que o guard trocaria a resposta e confundiria a demonstração · (3) respostas fabricadas e rotuladas.
- **Decisão:** (3), recomendação do Claude, aprovada pelo Guilherme. `npm run eval:demo` (`evals/demo.ts`) roda dois experimentos só com o caso obrigatório:
  - `demo-pula-consulta`: o texto certo, sem nenhuma tool;
  - `demo-inventa-chamado`: o resultado real de `listar_chamados`, com uma resposta que cita CH-105.

  Os nomes e as descrições deixam claro que não é o agente.
- **Verificado:** `demo-pula-consulta` deu `tool_called`=0 e `pass`=0. `demo-inventa-chamado` deu `answer_matches_tool`=0 ("extras ou inventados: CH-105") e `pass`=0. O mesmo resultado é conferido offline em `tests/evaluators.test.ts`.

---

## Propostas em aberto (confirmar no passo indicado)

Nenhuma no momento.

