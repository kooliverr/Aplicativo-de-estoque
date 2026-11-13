"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import AccountGate from "./account";
import Excel from "./excel";

export type Item = {
  id: string;
  name: string;
  code: string;
  brand: string;
  category: string;
  unit: string;
  minimum: number;
  quantity: number;
  version: number;
};

export type Movement = {
  id: string;
  productId: string;
  productName: string;
  productCode: string;
  type: string;
  quantity: number;
  balanceAfter: number;
  reason: string;
  userName: string;
  userEmail: string;
  createdAt: number;
};

export const CATEGORIES = [
  "Cabos & Fios",
  "Disjuntores & Proteção",
  "Iluminação & Lâmpadas",
  "Conectores & Terminais",
  "Infraestrutura",
  "Ferramentas & EPIs",
  "Automação & Comandos",
  "Outros",
];

const status = (p: Item) =>
  p.quantity === 0 ? "Esgotado" : p.quantity <= p.minimum ? "Baixo" : "Regular";

const fmt = (v: number) =>
  (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

const normalized = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default function App() {
  return (
    <AccountGate>
      {(admin, userName) => <Inventory admin={admin} userName={userName} />}
    </AccountGate>
  );
}

function Inventory({ admin, userName }: { admin: boolean; userName: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [query, search] = useState("");
  const [filter, setFilter] = useState("Todos");
  const [categoryFilter, setCategoryFilter] = useState("Todas");
  const [action, setAction] = useState("");
  const [selected, select] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  // Histórico
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(false);

  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const n = ++request.current;
    try {
      const r = await fetch("/api/products", { cache: "no-store" });
      if (!r.ok) throw Error();
      const data = await r.json();
      if (n === request.current) {
        setItems(data);
        setReady(true);
        setError("");
      }
    } catch {
      if (n === request.current)
        setError("Falha ao atualizar o estoque. Tente novamente.");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    window.addEventListener("focus", load);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  async function open(mode: string, item: Item | null = null) {
    select(item);
    setAction(mode);
    setFormError("");

    if (mode === "history" && item) {
      setLoadingMovements(true);
      dialog.current?.showModal();
      try {
        const r = await fetch(`/api/movements?productId=${item.id}&limit=50`, {
          cache: "no-store",
        });
        if (r.ok) setMovements(await r.json());
      } finally {
        setLoadingMovements(false);
      }
      return;
    }

    if (mode === "global_history") {
      setLoadingMovements(true);
      dialog.current?.showModal();
      try {
        const r = await fetch(`/api/movements?limit=100`, { cache: "no-store" });
        if (r.ok) setMovements(await r.json());
      } finally {
        setLoadingMovements(false);
      }
      return;
    }

    dialog.current?.showModal();
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError("");

    const form = new FormData(e.currentTarget);
    const values = Object.fromEntries(form);

    try {
      const payload: Record<string, unknown> = {
        ...values,
        id: selected?.id ?? crypto.randomUUID(),
        version: selected?.version,
        action,
      };

      if (action === "create" || action === "in" || action === "out") {
        payload.quantity = Math.round(Number(values.quantity) * 1000);
      }
      if (action === "create" || action === "edit" || action === "minimum") {
        payload.minimum = Math.round(Number(values.minimum) * 1000);
      }

      const r = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await r.json();

      if (!r.ok) {
        if (r.status === 409 && selected) {
          await load();
          dialog.current?.close();
          setError(data.error);
          return;
        }
        throw new Error(data.error || "Erro ao salvar.");
      }

      dialog.current?.close();
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  const low = items.filter((p) => status(p) === "Baixo").length;
  const empty = items.filter((p) => !p.quantity).length;

  const visible = items.filter((p) => {
    const matchesFilter = filter === "Todos" || status(p) === filter;
    const matchesCategory =
      categoryFilter === "Todas" || (p.category || "Outros") === categoryFilter;
    const matchesSearch = normalized(
      [p.name, p.code, p.brand, p.category || ""].join(" ")
    ).includes(normalized(query));
    return matchesFilter && matchesCategory && matchesSearch;
  });

  const titles: Record<string, string> = {
    create: "Cadastrar Novo Material",
    edit: "Editar Dados do Material",
    in: "Registrar Entrada de Material",
    out: "Registrar Saída de Material",
    minimum: "Alterar Estoque Mínimo",
    remove: "Remover Material",
    history: "Histórico de Movimentações",
    global_history: "Histórico Geral de Movimentações",
  };

  return (
    <>
      <header>
        <div className="bar">
          <img src="/favicon.svg" alt="" width="36" />
          <strong>Almoxarifado</strong>
          <span className="division">/</span>
          <span>Setor Elétrico</span>
          <b className="project">EPC13</b>
        </div>
      </header>

      <main>
        <section className="intro">
          <div>
            <small>CONTROLE DE MATERIAIS</small>
            <h1>Estoque da elétrica</h1>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => open("global_history")}>
              📜 Histórico de Movimentações
            </button>
            <button className="primary" onClick={() => open("create")}>
              ＋ Cadastrar material
            </button>
          </div>
        </section>

        <section className="stats">
          {[
            ["Materiais cadastrados", items.length, "Todos"],
            ["Estoque baixo", low, "Baixo"],
            ["Materiais esgotados", empty, "Esgotado"],
          ].map(([label, value, f], i) => (
            <button
              className={"metric m" + i}
              key={label}
              onClick={() => setFilter(String(f))}
            >
              <span>{label}</span>
              <strong>{ready ? value : "—"}</strong>
              <i aria-hidden="true">{["▤", "↓", "∅"][i]}</i>
            </button>
          ))}
        </section>

        <Excel admin={admin} reload={load} />

        <section className="inventory">
          <div className="invhead">
            <h2>Inventário de Materiais</h2>
            <div className="tools">
              <input
                aria-label="Buscar material"
                type="search"
                placeholder="Buscar nome, código, marca ou categoria"
                value={query}
                onChange={(e) => search(e.target.value)}
              />

              <select
                aria-label="Filtrar categoria"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="Todas">Todas as categorias</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filtrar situação"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                {["Todos", "Regular", "Baixo", "Esgotado"].map((x) => (
                  <option key={x} value={x}>
                    {x === "Todos" ? "Todas as situações" : x}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <p role="alert">
              {error} <button onClick={load}>Atualizar</button>
            </p>
          )}

          <div className="scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "Material / Referência",
                    "Marca",
                    "Categoria",
                    "Saldo",
                    "Mínimo",
                    "Situação",
                    "Ações",
                  ].map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.name}</b>
                      <code>{p.code}</code>
                    </td>
                    <td>{p.brand}</td>
                    <td>
                      <span className="cat-tag">{p.category || "Outros"}</span>
                    </td>
                    <td>
                      <b>{fmt(p.quantity)}</b> {p.unit}
                    </td>
                    <td>
                      {fmt(p.minimum)} {p.unit}
                    </td>
                    <td>
                      <span className={"tag " + status(p)}>{status(p)}</span>
                    </td>
                    <td>
                      <button onClick={() => open("in", p)}>Entrada</button>{" "}
                      <button
                        disabled={!p.quantity}
                        onClick={() => open("out", p)}
                      >
                        Saída
                      </button>{" "}
                      <button
                        title="Ver histórico de movimentações"
                        onClick={() => open("history", p)}
                      >
                        Histórico
                      </button>{" "}
                      {admin && (
                        <button
                          aria-label={"Mais ações para " + p.name}
                          onClick={() => open("more", p)}
                        >
                          •••
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!visible.length && (
            <div className="empty">
              <div className="cabinet" aria-hidden="true">
                ▤
              </div>
              <h3>
                {!ready
                  ? "Aguardando estoque"
                  : items.length
                  ? "Nenhum material encontrado"
                  : "Seu inventário começa aqui"}
              </h3>
              <p>
                {!ready
                  ? "Carregando os saldos."
                  : items.length
                  ? "Ajuste a busca ou os filtros de categoria e situação."
                  : "Cadastre o primeiro material elétrico e defina quando ele precisa de reposição."}
              </p>
              {ready && !items.length && (
                <button onClick={() => open("create")}>
                  Cadastrar primeiro material
                </button>
              )}
            </div>
          )}
        </section>
      </main>

      {/* Modal / Dialog de Ações e Histórico */}
      <dialog
        ref={dialog}
        className={action.includes("history") ? "history-dialog" : ""}
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        {action === "history" || action === "global_history" ? (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <h2>{titles[action]}</h2>
              <button type="button" onClick={() => dialog.current?.close()}>
                ✕ Fechar
              </button>
            </div>

            {selected && action === "history" && (
              <p style={{ margin: "4px 0 16px" }}>
                <b>{selected.name}</b> · Referência: <code>{selected.code}</code>{" "}
                · Saldo atual: <b>{fmt(selected.quantity)} {selected.unit}</b>
              </p>
            )}

            {loadingMovements ? (
              <p>Carregando movimentações...</p>
            ) : !movements.length ? (
              <p>Nenhuma movimentação registrada até o momento.</p>
            ) : (
              <div className="scroll" style={{ maxHeight: "60vh" }}>
                <table style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Data / Hora</th>
                      {action === "global_history" && <th>Material</th>}
                      <th>Tipo</th>
                      <th>Qtd.</th>
                      <th>Saldo após</th>
                      <th>Responsável</th>
                      <th>Motivo / Ordem de Serviço (OS)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => {
                      const isEntry = m.type === "in" || m.type === "initial";
                      const isOut = m.type === "out";
                      return (
                        <tr key={m.id}>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {new Date(m.createdAt).toLocaleString("pt-BR")}
                          </td>
                          {action === "global_history" && (
                            <td>
                              <b>{m.productName}</b>
                              <code>{m.productCode}</code>
                            </td>
                          )}
                          <td>
                            <span
                              className={`mov-tag ${
                                isEntry
                                  ? "mov-in"
                                  : isOut
                                  ? "mov-out"
                                  : "mov-edit"
                              }`}
                            >
                              {m.type === "in"
                                ? "Entrada"
                                : m.type === "out"
                                ? "Saída"
                                : m.type === "initial"
                                ? "Saldo Inicial"
                                : m.type === "edit"
                                ? "Edição"
                                : m.type}
                            </span>
                          </td>
                          <td>
                            <b>{m.quantity ? fmt(m.quantity) : "—"}</b>
                          </td>
                          <td>{fmt(m.balanceAfter)}</td>
                          <td>{m.userName}</td>
                          <td>{m.reason || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <footer style={{ marginTop: 20 }}>
              <button type="button" onClick={() => dialog.current?.close()}>
                Fechar
              </button>
            </footer>
          </div>
        ) : (
          <form key={action + (selected?.id ?? "")} onSubmit={submit}>
            <h2>{titles[action] ?? "Ações do material"}</h2>

            {selected && action !== "edit" && (
              <p>
                <b>{selected.name}</b> · {selected.code}
                <br />
                Saldo atual: <b>{fmt(selected.quantity)} {selected.unit}</b>
              </p>
            )}

            {action === "more" ? (
              <div className="options">
                <button type="button" onClick={() => setAction("edit")}>
                  ✏️ Editar dados do material
                </button>
                <button type="button" onClick={() => setAction("minimum")}>
                  Alterar apenas estoque mínimo
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => setAction("remove")}
                >
                  Remover material
                </button>
              </div>
            ) : (
              <>
                {/* Formulário para Cadastro OU Edição Completa */}
                {(action === "create" || action === "edit") && (
                  <>
                    <label>
                      Nome do material
                      <input
                        required
                        name="name"
                        maxLength={120}
                        defaultValue={action === "edit" ? selected?.name : ""}
                        placeholder="Ex: Cabo Flexível 2,5mm² 750V"
                      />
                    </label>

                    <label>
                      Código de referência / Part Number
                      <input
                        required
                        name="code"
                        maxLength={120}
                        defaultValue={action === "edit" ? selected?.code : ""}
                        placeholder="Ex: CAB-FLEX-25-AZ"
                      />
                    </label>

                    <label>
                      Marca / Fabricante
                      <input
                        required
                        name="brand"
                        maxLength={120}
                        defaultValue={action === "edit" ? selected?.brand : ""}
                        placeholder="Ex: Sil, Schneider, WEG, Intelli"
                      />
                    </label>

                    <label>
                      Categoria do material
                      <select
                        name="category"
                        defaultValue={
                          action === "edit" ? selected?.category : "Cabos & Fios"
                        }
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Unidade de medida
                      <select
                        name="unit"
                        defaultValue={action === "edit" ? selected?.unit : "un"}
                      >
                        <option value="un">Unidade (un)</option>
                        <option value="m">Metro (m)</option>
                        <option value="cx">Caixa (cx)</option>
                        <option value="rl">Rolo (rl)</option>
                        <option value="par">Par (par)</option>
                      </select>
                    </label>
                  </>
                )}

                {/* Quantidade inicial apenas no cadastro */}
                {action === "create" && (
                  <label>
                    Quantidade inicial
                    <input
                      type="number"
                      name="quantity"
                      min="0"
                      max="1000000000"
                      step=".001"
                      required
                      defaultValue="0"
                    />
                  </label>
                )}

                {/* Estoque mínimo no cadastro, na edição e na ação isolada */}
                {["create", "edit", "minimum"].includes(action) && (
                  <label>
                    Estoque mínimo (alerta de reposição)
                    <input
                      name="minimum"
                      type="number"
                      min="0"
                      max="1000000000"
                      step=".001"
                      defaultValue={selected ? selected.minimum / 1000 : 0}
                      required
                    />
                    <small>
                      Quando o saldo atingir ou ficar abaixo deste valor, o
                      sistema sinalizará como Estoque Baixo.
                    </small>
                  </label>
                )}

                {/* Entrada ou Saída com Rastreabilidade */}
                {["in", "out"].includes(action) && (
                  <>
                    <label>
                      {action === "in"
                        ? "Quantidade de entrada"
                        : "Quantidade de saída"}
                      <input
                        type="number"
                        name="quantity"
                        min="0.001"
                        max={
                          action === "out" && selected
                            ? selected.quantity / 1000
                            : 1e9
                        }
                        step=".001"
                        required
                        placeholder="Informe a quantidade"
                        autoFocus
                      />
                    </label>

                    <label>
                      {action === "in"
                        ? "Motivo / Nota Fiscal / Fornecedor"
                        : "Motivo / Ordem de Serviço (OS) / Destino *"}
                      <input
                        name="reason"
                        maxLength={200}
                        required={action === "out"}
                        placeholder={
                          action === "in"
                            ? "Ex: NF 1042 - Compra reposição"
                            : "Ex: Manutenção Quadro QGBT / OS 142 / Setor Fábrica"
                        }
                      />
                      <small>
                        {action === "out"
                          ? "Obrigatório para registrar a rastreabilidade da saída no almoxarifado."
                          : "Opcional. Ficará registrado no histórico de movimentação."}
                      </small>
                    </label>
                  </>
                )}

                {action === "remove" && (
                  <p style={{ color: "#853927" }}>
                    ⚠️ A remoção excluirá permanentemente o cadastro e o saldo
                    deste material. Confirmar?
                  </p>
                )}

                {formError && <p role="alert">{formError}</p>}
              </>
            )}

            <footer>
              <button
                type="button"
                disabled={busy}
                onClick={() => dialog.current?.close()}
              >
                Fechar
              </button>
              {action !== "more" && (
                <button
                  className={action === "remove" ? "danger" : "primary"}
                  disabled={busy}
                >
                  {busy
                    ? "Salvando…"
                    : action === "remove"
                    ? "Remover"
                    : action === "in"
                    ? "Confirmar Entrada"
                    : action === "out"
                    ? "Confirmar Saída"
                    : "Salvar"}
                </button>
              )}
            </footer>
          </form>
        )}
      </dialog>
    </>
  );
}
