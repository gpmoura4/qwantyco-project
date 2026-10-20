"use client";

import { useState, type FormEvent } from "react";
import type { ChatReply } from "@/agent/chat";
import type { Decision, Proposal } from "@/agent/domain/schemas";
import styles from "./chat.module.css";

// Simple chat UI. It is just another client of the API routes (U1): every rule
// (approval, idempotency, session isolation) is enforced by the backend.

type Entry = { role: "user" | "assistant" | "error"; text: string };

// Quick actions send the phrasings measured as reliable with the local model
// (D41). Free text still works; the backend guard covers what goes wrong.
const QUICK = {
  list: () => "Liste todos os chamados abertos.",
  get: (id: string) => `Consulte o ${id}.`,
  escalate: (id: string) => `Consulte o ${id} e prepare um escalonamento se ele estiver aberto.`,
};

type ApiResult =
  | { ok: true; data: ChatReply }
  | { ok: false; code?: string; message: string };

async function post(path: string, body: unknown): Promise<ApiResult> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (response.ok) return { ok: true, data: json };
    return {
      ok: false,
      code: json.error?.code,
      message: json.error?.message ?? "Erro inesperado.",
    };
  } catch {
    return { ok: false, message: "Não foi possível falar com o servidor." };
  }
}

export default function Chat() {
  // Created on the first message; "Nova conversa" resets it (U3).
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticketId, setTicketId] = useState("CH-101");

  const add = (...items: Entry[]) => setEntries((current) => [...current, ...items]);

  function showResult(result: ApiResult) {
    if (!result.ok) {
      add({ role: "error", text: result.message });
      // The backend says there is nothing to decide anymore: drop the stale card.
      if (result.code === "NO_PENDING_PROPOSAL") setProposal(null);
      return;
    }
    const reply = result.data.reply.trim();
    if (reply) add({ role: "assistant", text: reply });
    setProposal(result.data.kind === "approval_required" ? result.data.proposal : null);
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy || proposal) return;

    const id = sessionId ?? crypto.randomUUID();
    setSessionId(id);
    add({ role: "user", text: message });
    setBusy(true);
    showResult(await post("/api/chat", { sessionId: id, message }));
    setBusy(false);
  }

  async function sendDraft(event: FormEvent) {
    event.preventDefault();
    const message = draft;
    setDraft("");
    await send(message);
  }

  const locked = busy || proposal !== null;
  const normalizedId = ticketId.trim().toUpperCase();
  const validId = /^CH-\d+$/.test(normalizedId);

  async function decide(decisao: Decision["decisao"]) {
    if (!proposal || !sessionId || busy) return;
    setBusy(true);
    showResult(
      await post("/api/chat/decision", { sessionId, proposta_id: proposal.id, decisao }),
    );
    setBusy(false);
  }

  function newConversation() {
    setSessionId(null);
    setEntries([]);
    setProposal(null);
    setDraft("");
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Aurora — Assistente de Suporte</h1>
          <p className={styles.session}>
            Sessão: {sessionId ? sessionId.slice(0, 8) : "nova (criada na primeira mensagem)"}
          </p>
        </div>
        <button type="button" onClick={newConversation} disabled={busy}>
          Nova conversa
        </button>
      </header>

      <section className={styles.help} aria-label="Como usar">
        <p>
          <strong>Como usar:</strong> 1) liste os chamados abertos · 2) consulte um chamado pelo
          identificador · 3) peça o escalonamento: a proposta aparece abaixo para você aprovar ou
          rejeitar. Uma ação por mensagem, sempre com o identificador (ex.: CH-101).
        </p>
        <div className={styles.quick}>
          <button type="button" onClick={() => send(QUICK.list())} disabled={locked}>
            Listar chamados abertos
          </button>
          <label htmlFor="ticket" className={styles.srOnly}>
            Identificador do chamado
          </label>
          <input
            id="ticket"
            value={ticketId}
            onChange={(event) => setTicketId(event.target.value)}
            disabled={locked}
            size={8}
          />
          <button
            type="button"
            onClick={() => send(QUICK.get(normalizedId))}
            disabled={locked || !validId}
          >
            Consultar
          </button>
          <button
            type="button"
            onClick={() => send(QUICK.escalate(normalizedId))}
            disabled={locked || !validId}
          >
            Preparar escalonamento
          </button>
        </div>
      </section>

      <section className={styles.messages} aria-live="polite">
        {entries.map((entry, index) => (
          <div key={index} className={`${styles.message} ${styles[entry.role]}`}>
            {entry.text}
          </div>
        ))}
        {busy && <div className={styles.pending}>Consultando…</div>}
      </section>

      {proposal && (
        <section className={styles.proposal} aria-label="Proposta de escalonamento">
          <h2>Proposta de escalonamento — aguardando sua decisão</h2>
          <dl>
            <dt>Chamado</dt>
            <dd>{proposal.chamado_id}</dd>
            <dt>Resumo</dt>
            <dd>{proposal.resumo}</dd>
            <dt>Justificativa</dt>
            <dd>{proposal.justificativa}</dd>
          </dl>
          <p className={styles.proposalId}>Proposta {proposal.id}</p>
          <div className={styles.actions}>
            <button type="button" onClick={() => decide("aprovar")} disabled={busy}>
              Aprovar
            </button>
            <button type="button" onClick={() => decide("rejeitar")} disabled={busy}>
              Rejeitar
            </button>
          </div>
        </section>
      )}

      <form className={styles.form} onSubmit={sendDraft}>
        <label htmlFor="message" className={styles.srOnly}>
          Mensagem
        </label>
        <input
          id="message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={proposal ? "Decida a proposta antes de continuar." : "Digite sua mensagem…"}
          disabled={locked}
          autoComplete="off"
        />
        <button type="submit" disabled={locked || !draft.trim()}>
          Enviar
        </button>
      </form>
    </main>
  );
}
