declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    STOCK_OWNER_EMAIL?: string;
    STOCK_ADMIN_PASSWORD?: string;
    BUCKET?: R2Bucket;
  }
}
