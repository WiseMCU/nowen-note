/**
 * @nowen/sdk — Nowen Note TypeScript SDK
 *
 * 用法：
 * ```ts
 * import { NowenClient } from "@nowen/sdk";
 *
 * const client = new NowenClient({
 *   baseUrl: "http://localhost:3001",
 *   username: "admin",
 *   password: "admin123",
 * });
 *
 * const notebooks = await client.listNotebooks();
 * ```
 */

export { NowenClient } from "./client.js";
export type * from "./types.js";
