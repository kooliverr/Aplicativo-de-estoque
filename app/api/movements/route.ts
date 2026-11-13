import { access, authorize, db, ensureSchema, fail } from "../../../lib/stock-access";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensureSchema();
  const denied = await authorize(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const productId = url.searchParams.get("productId");
  const limit = Math.min(Number(url.searchParams.get("limit") || "100"), 500);

  const database = db();
  let rows;

  if (productId) {
    rows = await database
      .prepare(
        "SELECT id, product_id as productId, product_name as productName, product_code as productCode, type, quantity, balance_after as balanceAfter, reason, user_name as userName, user_email as userEmail, created_at as createdAt FROM movements WHERE product_id=? ORDER BY created_at DESC LIMIT ?"
      )
      .bind(productId, limit)
      .all();
  } else {
    rows = await database
      .prepare(
        "SELECT id, product_id as productId, product_name as productName, product_code as productCode, type, quantity, balance_after as balanceAfter, reason, user_name as userName, user_email as userEmail, created_at as createdAt FROM movements ORDER BY created_at DESC LIMIT ?"
      )
      .bind(limit)
      .all();
  }

  return Response.json(rows.results, {
    headers: { "Cache-Control": "no-store" },
  });
}
