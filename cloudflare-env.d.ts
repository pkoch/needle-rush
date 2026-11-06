declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    OWNER_USER_ID?: string;
    BOOTSTRAP_ENABLED?: string;
    CONNECTOR_SECRET?: string;
    BUCKET?: R2Bucket;
  }
}
