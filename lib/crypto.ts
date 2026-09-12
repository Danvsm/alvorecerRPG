import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
function key() {
  const value = Buffer.from(
    process.env.CREDENTIAL_ENCRYPTION_KEY || "",
    "base64",
  );
  if (value.length !== 32)
    throw new Error("Configure a chave de criptografia do servidor.");
  return value;
}
export function encrypt(value: string, userId: string) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key(), iv);
  c.setAAD(Buffer.from(userId));
  const out = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), out].map((v) => v.toString("base64")).join(".");
}
export function decrypt(value: string, userId: string) {
  const [iv, tag, data] = value.split(".").map((v) => Buffer.from(v, "base64"));
  const c = createDecipheriv("aes-256-gcm", key(), iv);
  c.setAAD(Buffer.from(userId));
  c.setAuthTag(tag);
  return Buffer.concat([c.update(data), c.final()]).toString("utf8");
}
export function generatePassword() {
  const words = ["goblin", "mago", "dragao", "batata", "runa"];
  const bytes = randomBytes(4);
  return (
    words[bytes[0] % words.length] +
    String(bytes.readUInt16BE(1) % 1000).padStart(3, "0")
  );
}
