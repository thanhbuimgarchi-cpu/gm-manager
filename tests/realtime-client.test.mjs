import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transform } from "esbuild";

const source = await readFile(new URL("../app/realtime-client.ts", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "ts", format: "cjs", target: "es2022" });

function fixture(options = {}) {
  const sockets = [];
  const invalidations = [];
  const statuses = [];
  const navigator = { onLine: true };
  const window = new EventTarget();
  const timers = new Map();
  let now = 0;
  let nextTimer = 0;
  window.setTimeout = (run, delay) => {
    timers.set(++nextTimer, { run, at: now + delay });
    return nextTimer;
  };
  window.clearTimeout = (id) => timers.delete(id);
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      const [id, { run, at }] = next;
      timers.delete(id);
      now = at;
      run();
    }
    now = end;
  }

  class WebSocket extends EventTarget {
    sent = [];
    closed = false;
    constructor(url) {
      super();
      this.url = url;
      sockets.push(this);
    }
    send(payload) { this.sent.push(JSON.parse(payload)); }
    close(code = 1000) {
      if (this.closed) return;
      this.closed = true;
      this.dispatchEvent(Object.assign(new Event("close"), { code }));
    }
    open() { this.dispatchEvent(new Event("open")); }
    receive(frame) {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }));
    }
  }

  const module = { exports: {} };
  vm.runInNewContext(code, { module, JSON, URL, WebSocket, window, navigator });
  const client = module.exports.connectRealtime({
    url: "wss://gm.example.test/realtime",
    token: "private-session",
    onInvalidate: (changed) => invalidations.push(Array.from(changed)),
    onStatusChange: (status) => statuses.push(status),
    ...options,
  });
  return { client, sockets, invalidations, statuses, advance, navigator, window, timers };
}

test("WebSocket RPC sends authentication first and correlates responses and invalidations", async () => {
  const { client, sockets, invalidations, statuses, timers } = fixture();
  const first = client.request({ action: "load-workspace-cache" });
  const second = client.request({ action: "load-personnel" });
  const [socket] = sockets;
  assert.equal(socket.url, "wss://gm.example.test/realtime");
  socket.open();
  assert.deepEqual(socket.sent, [{ type: "auth", token: "private-session" }]);
  socket.receive({ type: "invalidate", resources: ["workspace"] });
  assert.deepEqual(invalidations, []);

  socket.receive({ type: "ready" });
  assert.deepEqual(statuses, ["connecting", "ready"]);
  const [, a, b] = socket.sent;
  socket.receive({ type: "response", id: b.id, status: 403, result: { ok: false } });
  socket.receive({ type: "response", id: a.id, result: { ok: true } });
  assert.deepEqual({ ...(await first) }, { status: 200, result: { ok: true } });
  assert.deepEqual({ ...(await second) }, { status: 403, result: { ok: false } });

  socket.receive({ type: "invalidate", resources: ["documents", "unsafe", "documents", "photos"] });
  assert.deepEqual(invalidations, [["documents", "photos"]]);
  client.close();
  assert.equal(timers.size, 0);
});

test("a sent mutation is ambiguous after disconnect and never resent on reconnection", async () => {
  const { client, sockets, advance } = fixture();
  const [first] = sockets;
  first.open();
  first.receive({ type: "ready" });
  const mutation = client.request({ action: "workflow-command" });
  first.close(1006);
  await assert.rejects(mutation, (error) => error.name === "RealtimeRequestError" && error.sent === true);
  const read = client.request({ action: "load-workspace-cache" });

  advance(1_000);
  const second = sockets[1];
  second.open();
  second.receive({ type: "ready" });
  assert.deepEqual(second.sent.slice(1).map((frame) => frame.payload.action), ["load-workspace-cache"]);
  second.receive({ type: "response", id: second.sent[1].id, result: { ok: true } });
  assert.equal((await read).result.ok, true);
  client.close();
});

test("anonymous authentication and definitive auth refusal do not leak credentials or reconnect", async () => {
  const { client, sockets, advance } = fixture({ token: undefined });
  const [socket] = sockets;
  socket.open();
  assert.deepEqual(socket.sent, [{ type: "auth" }]);
  const request = client.request({ action: "verify-employee-login" });
  socket.close(4401);
  await assert.rejects(request, (error) => error.sent === false);
  advance(60_000);
  assert.equal(client.status, "unauthorized");
  assert.equal(sockets.length, 1);
  client.close();
});

test("missing heartbeat disconnects a dead socket and offline prevents automatic reconnect", async () => {
  const { client, sockets, advance, navigator, window } = fixture();
  const [socket] = sockets;
  socket.open();
  socket.receive({ type: "ready" });
  window.dispatchEvent(new Event("online"));
  advance(25_000);
  assert.deepEqual(socket.sent.at(-1), { type: "ping" });
  socket.receive({ type: "pong" });
  advance(25_000);
  assert.equal(client.status, "ready");
  assert.deepEqual(socket.sent.slice(1), [{ type: "ping" }, { type: "ping" }]);

  navigator.onLine = false;
  advance(12_000);
  assert.equal(client.status, "disconnected");
  advance(60_000);
  assert.equal(sockets.length, 1);
  navigator.onLine = true;
  window.dispatchEvent(new Event("online"));
  assert.equal(sockets.length, 2);
  client.close();
});
