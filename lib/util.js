import crypto from "node:crypto";
export function hashObject(obj) {
  const s = JSON.stringify(obj ?? {});
  return crypto.createHash("sha256").update(s).digest("hex");
}