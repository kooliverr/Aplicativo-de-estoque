import { access, authorize, db, ensureSchema, fail } from "../../../lib/stock-access";

export async function POST(req: Request) {
  await ensureSchema();
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return fail("Formato inválido.", 415);
  }

  const user = await access(req);
  const denied = await authorize(req, true);
  if (denied) return denied;

  const rows = await req.json().catch(() => null);
  if (!Array.isArray(rows) || !rows.length || rows.length > 2000) {
    return fail("Importe de 1 a 2.000 linhas por arquivo.");
  }

  const codes = new Set<string>();
  const values: any[] = [];
  const movementValues: any[] = [];
  const validUnits = ["un", "m", "cx", "rl", "par"];
  const now = Date.now();

  for (const [i, p] of rows.entries()) {
    if (
      !p ||
      ![p.name, p.code, p.brand].every(
        (v) => typeof v === "string" && v.trim() && v.length <= 120
      ) ||
      !validUnits.includes(String(p.unit).toLowerCase()) ||
      ![p.quantity, p.minimum].every(
        (v) => Number.isSafeInteger(v) && v >= 0 && v <= 1e12
      )
    ) {
      return fail("Confira os campos do material " + (i + 1) + ".");
    }

    const code = p.code.trim().toUpperCase();
    if (codes.has(code)) {
      return fail("Referência repetida na planilha: " + code);
    }
    codes.add(code);

    const id = crypto.randomUUID();
    const name = p.name.trim();
    const brand = p.brand.trim();
    const category = typeof p.category === "string" && p.category.trim() ? p.category.trim() : "Outros";
    const unit = String(p.unit).toLowerCase();

    values.push([id, name, code, brand, category, unit, p.quantity, p.minimum]);

    if (p.quantity > 0) {
      movementValues.push([
        crypto.randomUUID(),
        id,
        name,
        code,
        "initial",
        p.quantity,
        p.quantity,
        "Importação inicial via planilha Excel",
        user.name || "Administrador",
        user.email,
        now,
      ]);
    }
  }

  const database = db();
  const conflicts = await database
    .prepare("SELECT code FROM products WHERE code IN (SELECT value FROM json_each(?)) LIMIT 5")
    .bind(JSON.stringify([...codes]))
    .all<{ code: string }>();

  if (conflicts.results.length) {
    return fail(
      "Já cadastrado no sistema: " +
        conflicts.results.map((r) => r.code).join(", ") +
        ". Remova as referências existentes da planilha.",
      409
    );
  }

  try {
    // Insere produtos em lote
    await database
      .prepare(
        "INSERT INTO products(id, name, code, brand, category, unit, quantity, minimum) SELECT value->>0, value->>1, value->>2, value->>3, value->>4, value->>5, value->>6, value->>7 FROM json_each(?)"
      )
      .bind(JSON.stringify(values))
      .run();

    // Insere movimentações iniciais em lote
    if (movementValues.length) {
      await database
        .prepare(
          "INSERT INTO movements(id, product_id, product_name, product_code, type, quantity, balance_after, reason, user_name, user_email, created_at) SELECT value->>0, value->>1, value->>2, value->>3, value->>4, value->>5, value->>6, value->>7, value->>8, value->>9, value->>10 FROM json_each(?)"
        )
        .bind(JSON.stringify(movementValues))
        .run();
    }
  } catch (e) {
    console.error("Batch import error:", e);
    return fail("Lote não importado. Confira as referências e tente novamente.", 409);
  }

  return Response.json({ count: values.length });
}
