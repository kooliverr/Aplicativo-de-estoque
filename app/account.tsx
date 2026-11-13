"use client";
import { useCallback, useEffect, useState } from "react";

type Profile = {
  id: string;
  email: string;
  name: string;
  role: string;
  blocked: number;
  approval: string;
};

type Account = {
  owner: boolean;
  email: string;
  name: string;
  role: string;
  admin: boolean;
  registered: boolean;
  blocked: boolean;
  signedIn: boolean;
  permitted: boolean;
  approval: string;
  hasProfiles?: boolean;
  profiles: Profile[];
};

export default function AccountGate({
  children,
}: {
  children: (admin: boolean, userName: string) => React.ReactNode;
}) {
  const [account, setAccount] = useState<Account | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [register, setRegister] = useState(false);
  const [manage, setManage] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/profile", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Erro ao carregar sessão");
      }
      setAccount(data);
    } catch (err) {
      setAccount({
        owner: false,
        email: "",
        name: "",
        role: "guest",
        admin: false,
        registered: false,
        blocked: false,
        signedIn: false,
        permitted: false,
        approval: "",
        hasProfiles: false,
        profiles: [],
      });
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  async function act(payload: Record<string, unknown>) {
    setMessage("");
    setBusy(true);
    try {
      const r = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Falha na requisição.");
      await refresh();
      if (payload.action === "logout") {
        setRegister(false);
        setManage(false);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Falha ao processar solicitação.");
    } finally {
      setBusy(false);
    }
  }

  const error = message && <p role="alert">{message}</p>;

  // Tela de Login ou Cadastro se não estiver logado ou não tiver permissão
  if (!account || !account.signedIn || !account.permitted) {
    return (
      <main className="login">
        <section>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <img src="/favicon.svg" width="38" alt="" />
            <div>
              <strong style={{ fontSize: 18 }}>Almoxarifado Elétrico</strong>
              <small style={{ display: "block", color: "#5a796a" }}>Controle de Materiais · EPC13</small>
            </div>
          </div>

          {!account ? (
            <p>Carregando sistema...</p>
          ) : account.signedIn && !account.permitted ? (
            <>
              <h2>
                {account.blocked
                  ? "Acesso Bloqueado"
                  : account.approval === "denied"
                  ? "Cadastro Não Aprovado"
                  : "Aguardando Aprovação"}
              </h2>
              <p>
                {account.approval === "pending"
                  ? "Sua solicitação de acesso foi enviada. Assim que o Administrador aprovar, você poderá movimentar o estoque."
                  : "Entre em contato com o responsável pelo almoxarifado para liberar seu acesso."}
              </p>
              <button disabled={busy} onClick={() => act({ action: "logout" })}>
                Sair
              </button>
            </>
          ) : (
            <>
              <h2>{register ? "Criar Cadastro" : "Acessar Estoque"}</h2>

              {!account.hasProfiles && !register && (
                <div style={{ background: "#e8f2ea", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13, color: "#1b4d38" }}>
                  💡 <strong>Primeiro acesso:</strong> Crie um cadastro para iniciar como <b>Administrador</b> do sistema.
                </div>
              )}

              <form
                key={String(register)}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const password = f.get("password") as string;
                  const confirm = f.get("confirm") as string;
                  if (register && password !== confirm) {
                    setMessage("As senhas não coincidem. Digite novamente.");
                    return;
                  }
                  act({
                    action: register ? "register" : "login",
                    email: f.get("email"),
                    name: f.get("name"),
                    password,
                  });
                }}
              >
                {register && (
                  <label>
                    Nome completo
                    <input
                      name="name"
                      autoComplete="name"
                      placeholder="Ex: João da Silva"
                      maxLength={100}
                      required
                    />
                  </label>
                )}
                <label>
                  E-mail
                  <input
                    type="email"
                    name="email"
                    autoComplete="username"
                    placeholder="seu.email@empresa.com"
                    required
                  />
                </label>
                <label>
                  Senha
                  <input
                    type="password"
                    name="password"
                    autoComplete={register ? "new-password" : "current-password"}
                    placeholder="Mínimo 6 caracteres"
                    minLength={6}
                    maxLength={128}
                    required
                  />
                </label>
                {register && (
                  <label>
                    Confirme sua senha
                    <input
                      type="password"
                      name="confirm"
                      autoComplete="new-password"
                      placeholder="Repita a senha"
                      required
                    />
                  </label>
                )}
                <button className="primary" disabled={busy} style={{ width: "100%", marginTop: 8 }}>
                  {busy ? "Processando..." : register ? "Concluir Cadastro" : "Entrar no Sistema"}
                </button>
              </form>

              <div className="login-secondary" style={{ textAlign: "center", marginTop: 14 }}>
                <button
                  type="button"
                  disabled={busy}
                  style={{ background: "transparent", border: "none", cursor: "pointer" }}
                  onClick={() => {
                    setRegister(!register);
                    setMessage("");
                  }}
                >
                  {register ? "Já tem uma conta? Entrar" : "Ainda não tem acesso? Criar cadastro"}
                </button>
              </div>
            </>
          )}
          {error}
        </section>
      </main>
    );
  }

  const pending = account.profiles.filter((p) => p.approval === "pending");

  return (
    <>
      <div className="accountbar">
        <span>
          👤 <strong>{account.name}</strong> ({account.admin ? "Administrador" : "Colaborador"})
        </span>
        {account.admin && (
          <button
            onClick={() => {
              setManage(!manage);
              setMessage("");
            }}
          >
            {manage ? "← Voltar ao Estoque" : `Gerenciar Usuários (${pending.length} pendentes)`}
          </button>
        )}
        <button disabled={busy} onClick={() => act({ action: "logout" })}>
          Sair
        </button>
      </div>
      {error}

      {manage && account.admin ? (
        <main className="accountbox">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h1>Gerenciamento de Cadastros</h1>
            <button onClick={() => setManage(false)}>← Voltar ao Estoque</button>
          </div>

          <h2>Solicitações de Acesso Pendentes</h2>
          {!pending.length && <p>Nenhuma solicitação de acesso pendente no momento.</p>}
          {pending.map((p) => (
            <article className="review" key={p.id}>
              <div>
                <b>{p.name}</b>
                <p>{p.email}</p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => act({ action: "approve", id: p.id })}
                >
                  ✓ Aprovar
                </button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => act({ action: "deny", id: p.id })}
                >
                  ✕ Recusar
                </button>
              </div>
            </article>
          ))}

          <h2 style={{ marginTop: 32 }}>Usuários Ativos / Analisados</h2>
          {account.profiles
            .filter((p) => p.approval !== "pending")
            .map((p) => (
              <article className="review" key={p.id}>
                <div>
                  <b>{p.name}</b>
                  <p>
                    {p.email} · {p.approval === "denied" ? "Recusado" : p.blocked ? "Bloqueado" : "Ativo"} ({p.role === "admin" ? "Administrador" : "Colaborador"})
                  </p>
                </div>
                {p.approval === "approved" && (
                  <button
                    className={p.blocked ? "primary" : "danger"}
                    disabled={busy}
                    onClick={() => act({ action: p.blocked ? "unblock" : "block", id: p.id })}
                  >
                    {p.blocked ? "Liberar Acesso" : "Bloquear Usuário"}
                  </button>
                )}
              </article>
            ))}
        </main>
      ) : (
        children(account.admin, account.name)
      )}
    </>
  );
}
