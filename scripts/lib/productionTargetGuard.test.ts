import assert from "node:assert/strict";
import { test } from "node:test";
import { PRODUCTION_PROJECT_REF, verifyProductionEnvironment, verifyProductionTarget } from "./productionTargetGuard";

test("accepts NODE_ENV=production", () => {
  assert.equal(verifyProductionEnvironment("production").ok, true);
});

test("rejects NODE_ENV=development, test, or unset", () => {
  assert.equal(verifyProductionEnvironment("development").ok, false);
  assert.equal(verifyProductionEnvironment("test").ok, false);
  assert.equal(verifyProductionEnvironment(undefined).ok, false);
});

test("accepts a direct connection string pointed at the Production project", () => {
  const result = verifyProductionTarget(`postgresql://postgres:s3cr3t@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`);
  assert.equal(result.ok, true);
});

test("accepts a pooled connection string with the Production ref in the username", () => {
  const result = verifyProductionTarget(`postgresql://postgres.${PRODUCTION_PROJECT_REF}:s3cr3t@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`);
  assert.equal(result.ok, true);
});

test("rejects the Preview project even though it parses fine", () => {
  const result = verifyProductionTarget("postgresql://postgres:s3cr3t@db.tofdgndrrpnnyhbuurbx.supabase.co:5432/postgres");
  assert.equal(result.ok, false);
  assert.match(result.reason, /Unrecognized/);
});

test("rejects an unrecognized project reference (fail closed)", () => {
  const result = verifyProductionTarget("postgresql://postgres:s3cr3t@db.someotherprojectref123456.supabase.co:5432/postgres");
  assert.equal(result.ok, false);
  assert.match(result.reason, /Unrecognized/);
});

test("rejects a missing connection string", () => {
  assert.equal(verifyProductionTarget(undefined).ok, false);
  assert.equal(verifyProductionTarget(null).ok, false);
  assert.equal(verifyProductionTarget("").ok, false);
});

test("rejects an unparseable connection string", () => {
  const result = verifyProductionTarget("not-a-connection-string");
  assert.equal(result.ok, false);
  assert.match(result.reason, /Could not parse/);
});

test("never includes the password in the verification result", () => {
  const result = verifyProductionTarget(`postgresql://postgres:super-secret-password@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`);
  assert.equal(JSON.stringify(result).includes("super-secret-password"), false);
});


test("rejects Preview and read-only execution contexts", () => {
  assert.equal(verifyProductionEnvironment("production", { vercelEnv: "preview", readOnlyMode: false }).ok, false);
  assert.equal(verifyProductionEnvironment("production", { vercelEnv: "production", readOnlyMode: true }).ok, false);
});

test("rejects project-reference lookalikes and host suffix spoofing", () => {
  assert.equal(verifyProductionTarget("postgresql://postgres:pw@db." + PRODUCTION_PROJECT_REF + ".supabase.co.evil.example:5432/postgres").ok, false);
  assert.equal(verifyProductionTarget("postgresql://postgres." + PRODUCTION_PROJECT_REF + "@aws-0-ap-southeast-1.pooler.supabase.com.evil.example:6543/postgres").ok, false);
  assert.equal(verifyProductionTarget("postgresql://postgres." + PRODUCTION_PROJECT_REF + "x@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres").ok, false);
});

test("does not accept the retired Preview project as a Production target", () => {
  const result = verifyProductionTarget("postgresql://postgres:pw@db.tofdgndrrpnnyhbuurbx.supabase.co:5432/postgres");
  assert.equal(result.ok, false);
  assert.match(result.reason, /Unrecognized/);
});
