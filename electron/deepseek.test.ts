// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { DeepSeekConnection } from "./deepseek";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

// OS encryption is checked through real Electron in the desktop acceptance test.
const encryption = {
  isAvailable: () => true,
  encrypt: (text: string) => Buffer.from(text).reverse(),
  decrypt: (bytes: Buffer) => Buffer.from(bytes).reverse().toString(),
};
async function setup(fetcher: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" } }] }))) {
  const directory = await mkdtemp(join(tmpdir(), "framemind-t19-"));
  directories.push(directory);
  const path = join(directory, "deepseek.credentials");
  return { connection: new DeepSeekConnection(path, encryption, fetcher), path };
}

test("credentials persist separately and settings never return a key", async () => {
  const { connection, path } = await setup();
  expect(await connection.getSettings()).toMatchObject({ configured: false, model: "deepseek-flash" });
  const saved = await connection.save({ model: "deepseek-flash", apiKey: "sk-private-test-key" });
  expect(saved.status).toBe("saved");
  expect(JSON.stringify(saved)).not.toContain("sk-private-test-key");
  expect((await readFile(path)).toString()).not.toContain("sk-private-test-key");
  const reopened = new DeepSeekConnection(path, encryption);
  expect(await reopened.getSettings()).toMatchObject({ configured: true, model: "deepseek-flash" });
  expect((await reopened.save({ model: "deepseek-v4-pro", apiKey: "" })).status).toBe("saved");
  expect((await reopened.remove()).status).toBe("removed");
  expect(await reopened.getSettings()).toMatchObject({ configured: false });
  expect((await reopened.testConnection()).status).toBe("not-configured");
});

test("connection tests use only the saved model and a small fixed request without project data", async () => {
  const requests: { url: unknown; init?: RequestInit }[] = [];
  const { connection } = await setup(async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" } }] }));
  });
  await connection.save({ model: "deepseek-flash", apiKey: "sk-first" });
  expect((await connection.testConnection()).status).toBe("success");
  await connection.save({ model: "deepseek-v4-pro", apiKey: "sk-replacement" });
  expect((await connection.testConnection()).status).toBe("success");
  expect(requests[0].url).toBe("https://api.deepseek.com/chat/completions");
  expect(requests[0].init).toMatchObject({ method: "POST", redirect: "error", headers: { Authorization: "Bearer sk-first" } });
  expect(JSON.parse(requests[0].init!.body as string)).toEqual({ model: "deepseek-flash", messages: [{ role: "user", content: "Reply OK." }], thinking: { type: "disabled" }, stream: false, max_tokens: 8 });
  expect(requests[1].init).toMatchObject({ headers: { Authorization: "Bearer sk-replacement" } });
  expect(JSON.parse(requests[1].init!.body as string).model).toBe("deepseek-v4-pro");
});

test.each([[401, "authentication"], [403, "authentication"], [402, "balance"], [429, "rate-limit"],
  [500, "service"], [503, "service"], [422, "invalid-response"], [302, "service"]])("HTTP %s produces safe feedback", async (status, expected) => {
  const secret = "sk-secret-in-error-body";
  const { connection } = await setup(async () => new Response(JSON.stringify({ error: { message: secret } }), { status: status as number }));
  await connection.save({ model: "deepseek-flash", apiKey: secret });
  const result = await connection.testConnection();
  expect(result.status).toBe(expected);
  expect(result.settings.configured).toBe(true);
  expect(JSON.stringify(result)).not.toContain(secret);
});

test.each(["not json", "null", "{}", '{"choices":[{"message":{"role":"assistant","content":""}}]}'])("malformed success response is rejected: %s", async (body) => {
  const { connection } = await setup(async () => new Response(body));
  await connection.save({ model: "deepseek-flash", apiKey: "sk-test" });
  expect((await connection.testConnection()).status).toBe("invalid-response");
});

test("network exceptions are not forwarded to the renderer", async () => {
  const { connection } = await setup(async () => { throw new Error("socket failure with sk-secret"); });
  await connection.save({ model: "deepseek-flash", apiKey: "sk-secret" });
  const result = await connection.testConnection();
  expect(result.status).toBe("network");
  expect(JSON.stringify(result)).not.toContain("sk-secret");
});

test("the timeout covers a response whose body never finishes", async () => {
  const { path } = await setup();
  const connection = new DeepSeekConnection(path, encryption, async () => new Response(new ReadableStream({ start() {} })), 20);
  await connection.save({ model: "deepseek-flash", apiKey: "sk-test" });
  expect((await connection.testConnection()).status).toBe("timeout");
});

test.each(["save", "remove", "test"])("a pending test is invalidated by %s", async (action) => {
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => {
    started();
    return new Promise(() => undefined);
  }).mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" } }] })));
  const { connection } = await setup(fetcher);
  await connection.save({ model: "deepseek-flash", apiKey: "sk-test" });
  const pending = connection.testConnection();
  await requestStarted;
  if (action === "save") await connection.save({ model: "deepseek-v4-pro", apiKey: "sk-new" });
  else if (action === "remove") await connection.remove();
  else expect((await connection.testConnection()).status).toBe("success");
  expect((await pending).status).toBe("cancelled");
});

test("unavailable encryption never writes plaintext credentials", async () => {
  const { path } = await setup();
  const connection = new DeepSeekConnection(path, { ...encryption, isAvailable: () => false });
  expect((await connection.save({ model: "deepseek-flash", apiKey: "sk-test" })).status).toBe("storage-unavailable");
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
});

test("invalid inputs preserve the existing credential", async () => {
  const { connection, path } = await setup();
  await connection.save({ model: "deepseek-flash", apiKey: "sk-original" });
  const before = await readFile(path);
  for (const input of [null, {}, { model: "unknown", apiKey: "sk-test" }, { model: "deepseek-flash", apiKey: "sk-test\r\nheader" }]) {
    expect((await connection.save(input)).status).toBe("invalid-input");
  }
  expect(await readFile(path)).toEqual(before);
});

test("failed encrypted replacement keeps the previous credential", async () => {
  const { connection, path } = await setup();
  await connection.save({ model: "deepseek-flash", apiKey: "sk-original" });
  const before = await readFile(path);
  const broken = new DeepSeekConnection(path, { ...encryption, encrypt: () => { throw new Error("sk-new"); } });
  const result = await broken.save({ model: "deepseek-v4-pro", apiKey: "sk-new" });
  expect(result.status).toBe("storage-error");
  expect(JSON.stringify(result)).not.toContain("sk-new");
  expect(await readFile(path)).toEqual(before);
});

test("corrupt credentials and filesystem failures return safe storage feedback", async () => {
  const { path } = await setup();
  await writeFile(path, "corrupt-sk-secret");
  const connection = new DeepSeekConnection(path, encryption);
  expect(await connection.getSettings()).toMatchObject({ configured: false, issue: "storage-error" });
  expect((await connection.testConnection()).status).toBe("storage-error");
  expect((await connection.remove()).status).toBe("removed");
  await mkdir(path);
  expect((await connection.save({ model: "deepseek-flash", apiKey: "sk-test" })).status).toBe("storage-error");
  expect((await connection.remove()).status).toBe("storage-error");
});
