import { access, authorize, db, fail, ensureSchema } from "../../../lib/stock-access";

export const dynamic = "force-dynamic";

const amount = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1e12;

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

export async function GET(req: Request) {
  await ensureSchema();
  const denied = await authorize(req);
  if (denied) return denied;

  const rows = await db()
    .prepare(
      "SELECT id, name, code, brand, category, unit, quantity, minimum, version FROM products ORDER BY name COLLATE NOCASE, code"
    )
    .all();

  return Response.json(rows.results, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  await ensureSchema();
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return fail("Formato inválido.", 415);
  }

  const p = await req.json().catch(() => null);
  if (!p || typeof p.id !== "string" || p.id.length > 80) {
    return fail("Cadastro inválido.");
  }

  // Admin-only actions: remove, minimum, edit
  const adminOnly = ["remove", "minimum", "edit"].includes(p.action);
  const user = await access(req);
  if (!user.signedIn || !user.permitted) {
    return fail("Entre com um perfil autorizado.", 401);
  }
  if (adminOnly && !user.admin) {
    return fail("Apenas o administrador pode realizar esta alteração.", 403);
  }

  const database = db();
  const validUnits = ["un", "m", "cx", "rl", "par"];

  // 1. Cadastrar material
  if (p.action === "create") {
    if (
      ![p.name, p.code, p.brand].every(
        (v) => typeof v === "string" && v.trim() && v.length <= 120
      ) ||
      !validUnits.includes(p.unit) ||
      !amount(p.quantity) ||
      !amount(p.minimum)
    ) {
      return fail("Confira os dados do material.");
    }

    const category = typeof p.category === "string" && p.category.trim() ? p.category.trim() : "Outros";
    const name = p.name.trim();
    const code = p.code.trim().toUpperCase();
    const brand = p.brand.trim();

    const insertResult = await database
      .prepare(
        "INSERT INTO products(id, name, code, brand, category, unit, quantity, minimum, version) VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT DO NOTHING"
      )
      .bind(p.id, name, code, brand, category, p.unit, p.quantity, p.minimum)
      .run();

    if (!insertResult.meta.changes) {
      return fail("Já existe um material com essa referência.", 409);
    }

    if (p.quantity > 0) {
      await database
        .prepare(
          "INSERT INTO movements(id, product_id, product_name, product_code, type, quantity, balance_after, reason, user_name, user_email, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
        )
        .bind(
          crypto.randomUUID(),
          p.id,
          name,
          code,
          "initial",
          p.quantity,
          p.quantity,
          typeof p.reason === "string" && p.reason.trim() ? p.reason.trim() : "Saldo inicial de cadastro",
          user.name || "Administrador",
          user.email,
          Date.now()
        )
        .run();
    }

    return Response.json({ ok: true });
  }

  // 2. Edição completa do material (Nome, Código, Marca, Categoria, Unidade, Mínimo)
  if (p.action === "edit") {
    if (
      ![p.name, p.code, p.brand].every(
        (v) => typeof v === "string" && v.trim() && v.length <= 120
      ) ||
      !validUnits.includes(p.unit) ||
      !amount(p.minimum) ||
      !Number.isSafeInteger(p.version)
    ) {
      return fail("Confira os dados para edição do material.");
    }

    const code = p.code.trim().toUpperCase();
    const name = p.name.trim();
    const brand = p.brand.trim();
    const category = typeof p.category === "string" && p.category.trim() ? p.category.trim() : "Outros";

    // Checar duplicidade de código com outros materiais
    const conflict = await database
      .prepare("SELECT id FROM products WHERE code=? AND id<>?")
      .bind(code, p.id)
      .first();
    if (conflict) {
      return fail("Já existe outro material com esse código de referência.", 409);
    }

    const current = await database
      .prepare("SELECT quantity FROM products WHERE id=? AND version=?")
      .bind(p.id, p.version)
      .first<{ quantity: number }>();

    if (!current) {
      return fail("O material foi alterado por outro usuário. Atualize a página.", 409);
    }

    const updateResult = await database
      .prepare(
        "UPDATE products SET name=?, code=?, brand=?, category=?, unit=?, minimum=?, version=version+1 WHERE id=? AND version=?"
      )
      .bind(name, code, brand, category, p.unit, p.minimum, p.id, p.version)
      .run();

    if (!updateResult.meta.changes) {
      return fail("Falha ao salvar alterações. Atualize a página e tente novamente.", 409);
    }

    await database
      .prepare(
        "INSERT INTO movements(id, product_id, product_name, product_code, type, quantity, balance_after, reason, user_name, user_email, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
      )
      .bind(
        crypto.randomUUID(),
        p.id,
        name,
        code,
        "edit",
        0,
        current.quantity,
        typeof p.reason === "string" && p.reason.trim() ? p.reason.trim() : "Edição dos dados do material",
        user.name || "Administrador",
        user.email,
        Date.now()
      )
      .run();

    return Response.json({ ok: true });
  }

  if (!Number.isSafeInteger(p.version)) return fail("Versão inválida.");

  // 3. Remover material
  if (p.action === "remove") {
    const current = await database
      .prepare("SELECT name, code, quantity FROM products WHERE id=? AND version=?")
      .bind(p.id, p.version)
      .first<{ name: string; code: string; quantity: number }>();

    const stmt = database
      .prepare("DELETE FROM products WHERE id=? AND version=?")
      .bind(p.id, p.version);
    const result = await stmt.run();

    if (result.meta.changes && current) {
      await database
        .prepare(
          "INSERT INTO movements(id, product_id, product_name, product_code, type, quantity, balance_after, reason, user_name, user_email, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
        )
        .bind(
          crypto.randomUUID(),
          p.id,
          current.name,
          current.code,
          "remove",
          current.quantity,
          0,
          "Remoção do material do estoque",
          user.name || "Administrador",
          user.email,
          Date.now()
        )
        .run();
    }

    return result.meta.changes
      ? Response.json({ ok: true })
      : fail("O material já foi alterado ou removido.", 409);
  }

  // 4. Alterar apenas estoque mínimo
  if (p.action === "minimum" && amount(p.minimum)) {
    const stmt = database
      .prepare("UPDATE products SET minimum=?, version=version+1 WHERE id=? AND version=?")
      .bind(p.minimum, p.id, p.version);
    const result = await stmt.run();
    return result.meta.changes
      ? Response.json({ ok: true })
      : fail("O estoque foi alterado por outro usuário.", 409);
  }

  // 5. Entrada ou Saída com Rastreabilidade
  if (["in", "out"].includes(p.action) && amount(p.quantity) && p.quantity > 0) {
    const current = await database
      .prepare("SELECT name, code, quantity FROM products WHERE id=? AND version=?")
      .bind(p.id, p.version)
      .first<{ name: string; code: string; quantity: number }>();

    if (!current) {
      return fail("O material foi alterado por outro usuário. Atualize o estoque.", 409);
    }

    const delta = p.action === "in" ? p.quantity : -p.quantity;
    const newQuantity = current.quantity + delta;

    if (newQuantity < 0) {
      return fail("Quantidade solicitada ultrapassa o saldo disponível em estoque.", 400);
    }

    const reason = typeof p.reason === "string" && p.reason.trim()
      ? p.reason.trim()
      : p.action === "in"
      ? "Entrada de material"
      : "Saída de material";

    const updateStmt = database
      .prepare(
        "UPDATE products SET quantity=?, version=version+1 WHERE id=? AND version=?"
      )
      .bind(newQuantity, p.id, p.version);

    const result = await updateStmt.run();
    if (!result.meta.changes) {
      return fail("O saldo mudou. Confira o estoque atualizado e tente novamente.", 409);
    }

    // Registra a movimentação no histórico
    await database
      .prepare(
        "INSERT INTO movements(id, product_id, product_name, product_code, type, quantity, balance_after, reason, user_name, user_email, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
      )
      .bind(
        crypto.randomUUID(),
        p.id,
        current.name,
        current.code,
        p.action,
        p.quantity,
        newQuantity,
        reason,
        user.name || "Colaborador",
        user.email,
        Date.now()
      )
      .run();

    return Response.json({ ok: true, balance: newQuantity });
  }

  return fail("Informe uma ação e quantidade válidas.");
}
