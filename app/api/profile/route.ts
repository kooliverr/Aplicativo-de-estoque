import { env } from "cloudflare:workers";
import {
  access,
  createSessionCookie,
  db,
  digest,
  ensureSchema,
  fail,
  hex,
  random,
  COOKIE_NAME,
} from "../../../lib/stock-access";

async function hash(password: string, salt: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return hex(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: encoder.encode(salt),
        iterations: 100000,
        hash: "SHA-256",
      },
      key,
      256
    )
  );
}

export async function GET(req: Request) {
  await ensureSchema();
  const a = await access(req);

  if (!a.signedIn) {
    const countRow = await db()
      .prepare("SELECT COUNT(*) as count FROM profiles")
      .first<{ count: number }>();
    return Response.json(
      {
        signedIn: false,
        permitted: false,
        admin: false,
        hasProfiles: (countRow?.count ?? 0) > 0,
        profiles: [],
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const profiles = a.admin
    ? (
        await db()
          .prepare(
            "SELECT id, email, name, role, blocked, approval FROM profiles WHERE id<>? ORDER BY name"
          )
          .bind(a.id)
          .all()
      ).results
    : [];

  return Response.json(
    {
      owner: a.admin,
      email: a.email,
      name: a.name,
      role: a.role,
      registered: true,
      signedIn: a.signedIn,
      permitted: a.permitted,
      admin: a.admin,
      approval: a.approval,
      blocked: a.blocked,
      profiles,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  await ensureSchema();
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return fail("Formato inválido.", 415);
  }

  const p = await req.json().catch(() => null);
  if (!p || typeof p.action !== "string") {
    return fail("Requisição inválida.");
  }

  const a = await access(req);
  const isSecure = new URL(req.url).protocol === "https:";

  if (p.action === "logout") {
    if (a.signedIn && a.id) {
      await db()
        .prepare("UPDATE profiles SET session=NULL WHERE id=?")
        .bind(a.id)
        .run();
    }
    return Response.json(
      { ok: true },
      { headers: { "Set-Cookie": createSessionCookie("", 0, isSecure) } }
    );
  }

  // Admin user management actions
  if (["approve", "deny", "block", "unblock"].includes(p.action)) {
    if (!a.admin || typeof p.id !== "string" || p.id === a.id) {
      return fail("Apenas o administrador pode gerenciar cadastros.", 403);
    }
    const review = ["approve", "deny"].includes(p.action);
    const stmt = review
      ? db()
          .prepare("UPDATE profiles SET approval=? WHERE id=? AND approval='pending'")
          .bind(p.action === "approve" ? "approved" : "denied", p.id)
      : db()
          .prepare(
            "UPDATE profiles SET blocked=?, session=NULL WHERE id=? AND approval='approved' AND blocked=?"
          )
          .bind(
            Number(p.action === "block"),
            p.id,
            Number(p.action === "unblock")
          );
    const result = await stmt.run();
    return result.meta.changes
      ? Response.json({ ok: true })
      : fail("Este cadastro já foi atualizado. Confira a lista.", 409);
  }

  if (p.action === "register") {
    const email = typeof p.email === "string" ? p.email.trim().toLowerCase() : "";
    const name = typeof p.name === "string" ? p.name.trim() : "";
    const password = typeof p.password === "string" ? p.password : "";

    if (!email || !email.includes("@")) return fail("Informe um e-mail válido.");
    if (!name || name.length < 2 || name.length > 100) return fail("Informe seu nome completo.");
    if (password.length < 6 || password.length > 128) return fail("A senha deve ter no mínimo 6 caracteres.");

    const existing = await db()
      .prepare("SELECT id FROM profiles WHERE LOWER(email)=?")
      .bind(email)
      .first();
    if (existing) return fail("Já existe um cadastro com este e-mail. Utilize Entrar.", 409);

    const countRow = await db()
      .prepare("SELECT COUNT(*) as count FROM profiles")
      .first<{ count: number }>();
    const isFirstUser = (countRow?.count ?? 0) === 0;
    const isOwnerEmail = env.STOCK_OWNER_EMAIL && email === env.STOCK_OWNER_EMAIL.toLowerCase();
    const isAdmin = isFirstUser || Boolean(isOwnerEmail);
    const approval = isAdmin ? "approved" : "pending";
    const role = isAdmin ? "admin" : "user";

    const salt = random();
    const encoded = await hash(password, salt);
    const id = crypto.randomUUID();
    const token = random();
    const sessionDigest = await digest(token);
    const expires = Date.now() + 8 * 3600 * 1000;

    await db()
      .prepare(
        "INSERT INTO profiles(id, email, name, role, approval, salt, hash, session, expires) VALUES(?,?,?,?,?,?,?,?,?)"
      )
      .bind(id, email, name, role, approval, salt, encoded, sessionDigest, expires)
      .run();

    return Response.json(
      { ok: true, admin: isAdmin, approval, name },
      { headers: { "Set-Cookie": createSessionCookie(token, 8 * 3600, isSecure) } }
    );
  }

  if (p.action === "login") {
    const email = typeof p.email === "string" ? p.email.trim().toLowerCase() : "";
    const password = typeof p.password === "string" ? p.password : "";

    if (!email || !password) return fail("Informe e-mail e senha.");

    const profile = await db()
      .prepare("SELECT * FROM profiles WHERE LOWER(email)=?")
      .bind(email)
      .first<any>();

    if (!profile || !profile.salt || !profile.hash) {
      // Support bootstrap admin if env.STOCK_ADMIN_PASSWORD & STOCK_OWNER_EMAIL are set
      if (
        env.STOCK_OWNER_EMAIL &&
        email === env.STOCK_OWNER_EMAIL.toLowerCase() &&
        env.STOCK_ADMIN_PASSWORD &&
        password === env.STOCK_ADMIN_PASSWORD
      ) {
        const id = profile?.id ?? crypto.randomUUID();
        const salt = random();
        const encoded = await hash(password, salt);
        const token = random();
        const sessionDigest = await digest(token);
        const expires = Date.now() + 8 * 3600 * 1000;

        await db()
          .prepare(
            "INSERT INTO profiles(id, email, name, role, approval, salt, hash, session, expires) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET session=?, expires=?, role='admin', approval='approved'"
          )
          .bind(id, email, "Administrador", "admin", "approved", salt, encoded, sessionDigest, expires, sessionDigest, expires)
          .run();

        return Response.json(
          { ok: true, admin: true },
          { headers: { "Set-Cookie": createSessionCookie(token, 8 * 3600, isSecure) } }
        );
      }
      return fail("E-mail ou senha incorretos.", 403);
    }

    if (profile.blocked) return fail("Este perfil está bloqueado pelo administrador.", 403);

    const now = Date.now();
    // Brute-force protection: max 8 attempts per 10 minutes
    const attempt = await db()
      .prepare(
        "UPDATE profiles SET attempts=CASE WHEN window<=? THEN 1 ELSE attempts+1 END, window=CASE WHEN window<=? THEN ? ELSE window END WHERE id=? AND (window<=? OR attempts<8)"
      )
      .bind(now, now, now + 600000, profile.id, now)
      .run();

    if (!attempt.meta.changes) {
      return fail("Muitas tentativas sem sucesso. Aguarde dez minutos.", 429);
    }

    const calculatedHash = await hash(password, profile.salt);
    if (calculatedHash !== profile.hash) {
      return fail("E-mail ou senha incorretos.", 403);
    }

    const token = random();
    const sessionDigest = await digest(token);
    const expires = Date.now() + 8 * 3600 * 1000;

    await db()
      .prepare("UPDATE profiles SET session=?, expires=?, attempts=0 WHERE id=?")
      .bind(sessionDigest, expires, profile.id)
      .run();

    const isAdmin = profile.role === "admin" || (env.STOCK_OWNER_EMAIL && email === env.STOCK_OWNER_EMAIL.toLowerCase());

    return Response.json(
      { ok: true, admin: Boolean(isAdmin), approval: profile.approval },
      { headers: { "Set-Cookie": createSessionCookie(token, 8 * 3600, isSecure) } }
    );
  }

  return fail("Operação indisponível.");
}
