import { env } from "cloudflare:workers";

export const db = () => env.DB!;
export const fail = (error: string, status = 400) => Response.json({ error }, { status });

export type Profile = {
  id: string;
  email: string;
  name: string;
  role: string;
  approval: string;
  blocked: number;
  salt: string | null;
  hash: string | null;
  session: string | null;
  expires: number | null;
  attempts: number;
  window: number;
};

export const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, "0")).join("");

export const random = () => hex(crypto.getRandomValues(new Uint8Array(32)).buffer);

export const digest = async (s: string) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

export const COOKIE_NAME = "stock_session";

export function createSessionCookie(value: string, maxAgeSeconds: number, isSecure = false): string {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecure) parts.push("Secure");
  return parts.join("; ");
}

let schemaReady = false;
export async function ensureSchema(database = db()) {
  if (schemaReady || !database) return;
  try {
    await database.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        code text NOT NULL UNIQUE,
        brand text NOT NULL,
        category text DEFAULT 'Geral' NOT NULL,
        unit text NOT NULL,
        quantity integer NOT NULL,
        minimum integer NOT NULL,
        version integer DEFAULT 1 NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profiles (
        id text PRIMARY KEY NOT NULL,
        email text NOT NULL UNIQUE,
        name text NOT NULL,
        role text DEFAULT 'user' NOT NULL,
        approval text DEFAULT 'approved' NOT NULL,
        blocked integer DEFAULT 0 NOT NULL,
        salt text,
        hash text,
        session text,
        expires integer,
        attempts integer DEFAULT 0 NOT NULL,
        window integer DEFAULT 0 NOT NULL
      );
      CREATE TABLE IF NOT EXISTS movements (
        id text PRIMARY KEY NOT NULL,
        product_id text NOT NULL,
        product_name text NOT NULL,
        product_code text NOT NULL,
        type text NOT NULL,
        quantity integer NOT NULL,
        balance_after integer NOT NULL,
        reason text DEFAULT '' NOT NULL,
        user_name text NOT NULL,
        user_email text NOT NULL,
        created_at integer NOT NULL
      );
    `);
    try { await database.exec("ALTER TABLE products ADD COLUMN category text DEFAULT 'Geral' NOT NULL;"); } catch {}
    try { await database.exec("ALTER TABLE profiles ADD COLUMN role text DEFAULT 'user' NOT NULL;"); } catch {}
    try { await database.exec("ALTER TABLE profiles ADD COLUMN approval text DEFAULT 'approved' NOT NULL;"); } catch {}
    schemaReady = true;
  } catch (err) {
    console.error("ensureSchema error:", err);
  }
}

export async function access(req: Request) {
  await ensureSchema();
  const cookieHeader = req.headers.get("cookie") || "";
  const tokenMatch = cookieHeader.match(new RegExp(`(?:^|;\\s*)(?:${COOKIE_NAME}|__Host-stock-admin)=([0-9a-f]{64})(?:;|$)`));
  const token = tokenMatch?.[1];

  if (token) {
    const hashed = await digest(token);
    const now = Date.now();
    const profile = await db()
      .prepare("SELECT * FROM profiles WHERE session=? AND expires>?")
      .bind(hashed, now)
      .first<Profile>();

    if (profile) {
      const isOwnerEmail = env.STOCK_OWNER_EMAIL && profile.email.toLowerCase() === env.STOCK_OWNER_EMAIL.toLowerCase();
      const isAdmin = profile.role === "admin" || Boolean(isOwnerEmail);
      const isBlocked = Boolean(profile.blocked);
      const isApproved = profile.approval === "approved" || isAdmin;
      const isPermitted = !isBlocked && isApproved;

      return {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        role: isAdmin ? "admin" : "user",
        owner: isAdmin,
        profile,
        signedIn: true,
        permitted: isPermitted,
        admin: isAdmin && isPermitted,
        blocked: isBlocked,
        approval: profile.approval,
      };
    }
  }

  // Fallback for ChatGPT / Sites environment headers if present:
  const oaiId = req.headers.get("oai-authenticated-user-id");
  const oaiEmail = req.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (oaiId && oaiEmail) {
    const profile = await db().prepare("SELECT * FROM profiles WHERE id=?").bind(oaiId).first<Profile>();
    const isOwnerEmail = env.STOCK_OWNER_EMAIL && oaiEmail === env.STOCK_OWNER_EMAIL.toLowerCase();
    const isAdmin = profile?.role === "admin" || Boolean(isOwnerEmail);
    if (profile) {
      return {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        role: isAdmin ? "admin" : "user",
        owner: isAdmin,
        profile,
        signedIn: true,
        permitted: !profile.blocked && (isAdmin || profile.approval === "approved"),
        admin: isAdmin && !profile.blocked,
        blocked: Boolean(profile.blocked),
        approval: profile.approval,
      };
    }
  }

  return {
    id: "",
    email: "",
    name: "",
    role: "guest",
    owner: false,
    profile: null,
    signedIn: false,
    permitted: false,
    admin: false,
    blocked: false,
    approval: "",
  };
}

export async function authorize(req: Request, adminOnly = false) {
  const a = await access(req);
  if (!a.signedIn || !a.permitted) {
    return fail("Entre com um perfil autorizado.", 401);
  }
  if (adminOnly && !a.admin) {
    return fail("Apenas o administrador pode realizar esta ação.", 403);
  }
  return null;
}
