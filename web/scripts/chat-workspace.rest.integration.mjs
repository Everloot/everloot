import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";

// Real PostgREST response shapes against disposable local fixtures only. Apply the workspace migration first.
const database = new URL(process.env.QUOTA_TEST_DATABASE_URL);
const rest = new URL(process.env.LOCAL_REST_URL);
for (const url of [database, rest]) assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Local fixtures only");
assert.equal(database.pathname, "/intake_quota_test", "Dedicated test database required");
assert.ok(process.env.LOCAL_REST_JWT_SECRET?.length >= 32, "Local fixture JWT secret required");
const pool = new pg.Pool({ connectionString: database.toString() });
const users = [];
const token = (() => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ role: "service_role", exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url");
  const signature = createHmac("sha256", process.env.LOCAL_REST_JWT_SECRET).update(`${header}.${claims}`).digest("base64url");
  return `${header}.${claims}.${signature}`;
})();

async function rpc(name, body, authenticated = true) {
  const response = await fetch(new URL(`/rpc/${name}`, rest), {
    method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}
async function ok(name, body) {
  const response = await rpc(name, body);
  assert.equal(response.status, 200, `${name}: ${JSON.stringify(response.body)}`);
  return response.body;
}

try {
  for (const label of ["a", "b"]) {
    const result = await pool.query("insert into public.users (bnet_id, battletag) values ($1,$2) returning id", [`rest-fixture-${randomUUID()}`, `RestFixture-${label}`]);
    users.push(result.rows[0].id);
  }
  const [owner, other] = users;
  const projectId = randomUUID();
  const saved = await ok("chat_save_project", { p_user_id: owner, p_id: projectId, p_expected_revision: 0, p_name: "REST fixture", p_description: null });
  assert.ok(Array.isArray(saved));
  assert.equal(saved[0].refusal, null);
  assert.equal(saved[0].project.id, projectId);
  assert.equal(saved[0].project.revision, 1);
  assert.equal((await ok("chat_list_projects", { p_user_id: owner })).length, 1);
  assert.deepEqual(await ok("chat_list_projects", { p_user_id: other }), []);
  const anonymous = await rpc("chat_list_projects", { p_user_id: owner }, false);
  assert.ok([401, 403].includes(anonymous.status));

  // The workspace bridge creates privately and passes null flags on edits. Prove the actual RPC keeps them.
  const buildInput = {
    p_user_id: owner, p_id: null, p_slug: randomUUID().replaceAll("-", "").slice(0, 8),
    p_character_id: null, p_name: "Private REST build", p_notes: null,
    p_code: "EL1-warrior-0-1.60.1.70450-MTE6NQ", p_code2: null,
    p_shared: false, p_active: false, p_show_name: false,
  };
  const build = (await ok("save_build", buildInput))[0];
  assert.equal(build.refusal, null);
  const readBuild = async () => (await pool.query("select shared, show_name, active from public.saved_builds where id=$1", [build.build_ref])).rows[0];
  assert.deepEqual(await readBuild(), { shared: false, show_name: false, active: false });
  assert.deepEqual(await ok("shared_build", { p_slug: build.build_slug }), []);
  assert.equal((await ok("save_build", { ...buildInput, p_user_id: other, p_id: build.build_ref }))[0].refusal, "not_found");
  await ok("save_build", { ...buildInput, p_id: build.build_ref, p_name: "Edited private build", p_shared: null, p_active: null, p_show_name: null });
  assert.deepEqual(await readBuild(), { shared: false, show_name: false, active: false });
  await pool.query("update public.saved_builds set shared=true,show_name=true where id=$1", [build.build_ref]);
  await ok("save_build", { ...buildInput, p_id: build.build_ref, p_shared: null, p_active: null, p_show_name: null });
  assert.deepEqual(await readBuild(), { shared: true, show_name: true, active: false });

  const chatId = randomUUID();
  const messages = [{ role: "user", text: "local fixture", at: new Date().toISOString(), model: null, sources: [], pages: [], steps: [] }];
  const chat = await ok("chat_save_conversation", { p_user_id: owner, p_id: chatId, p_expected_revision: 0, p_title: "REST fixture", p_project_id: projectId, p_pinned: false, p_messages: messages });
  assert.equal(chat[0].conversation.id, chatId);
  const fetched = await ok("chat_get_conversation", { p_user_id: owner, p_id: chatId });
  assert.equal(fetched.id, chatId);
  assert.deepEqual(fetched.messages, messages);
  assert.equal(await ok("chat_get_conversation", { p_user_id: other, p_id: chatId }), null);
  const conflict = await ok("chat_save_project", { p_user_id: owner, p_id: projectId, p_expected_revision: 0, p_name: "stale", p_description: null });
  assert.equal(conflict[0].refusal, "revision_conflict");

  const exported = await ok("chat_export", { p_user_id: owner });
  assert.equal(exported.projects[0].id, projectId);
  assert.equal(exported.conversations[0].id, chatId);
  assert.deepEqual(exported.entries, []);
  assert.equal(await ok("chat_delete_project", { p_user_id: other, p_id: projectId, p_expected_revision: 1 }), "not_found");
  assert.equal(await ok("chat_delete_project", { p_user_id: owner, p_id: projectId, p_expected_revision: 1 }), null);
  assert.equal((await ok("chat_get_conversation", { p_user_id: owner, p_id: chatId })).projectId, null);
  assert.equal(await ok("chat_clear_workspace", { p_user_id: owner }), true);
  assert.deepEqual(await ok("chat_export", { p_user_id: owner }), { projects: [], conversations: [], entries: [] });
  console.log("chat workspace real PostgREST integration: ok");
} finally {
  if (users.length) await pool.query("delete from public.users where id=any($1::uuid[])", [users]);
  await pool.end();
}
