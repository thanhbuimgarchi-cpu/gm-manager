export type WorkflowIdentity = { account: string; scriptUrl: string; token: string };
export type WorkflowResult = { ok?: boolean; error?: string; code?: string; status?: number; [key: string]: unknown };
export type WorkflowOutboxEntry = {
  requestId: string; account: string; scriptUrl: string; scope: string; logicalKey: string;
  payload: Record<string, unknown>; state: "queued" | "sending" | "retrying" | "blocked" | "conflict";
  attempts: number; createdAt: number; nextAttemptAt: number; error?: string; code?: string;
  sequence?: number;
};
type StoragePort = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "key" | "length" | "removeItem">>;
type ClientOptions = {
  storage: StoragePort; storageKey?: string;
  send: (payload: Record<string, unknown>, identity: WorkflowIdentity) => Promise<WorkflowResult>;
  onChange?: (entries: WorkflowOutboxEntry[]) => void;
  onResult?: (entry: WorkflowOutboxEntry, result: WorkflowResult) => void;
  onError?: (error: unknown) => void;
  now?: () => number; makeId?: () => string; isOnline?: () => boolean;
};
export type WorkflowClient = ReturnType<typeof createWorkflowClient>;
export class WorkflowCommandError extends Error {
  constructor(message: string, public entry: WorkflowOutboxEntry, public result?: WorkflowResult) {
    super(message); this.name = "WorkflowCommandError";
  }
  get state() { return this.entry.state; }
}
const OUTBOX_KEY = "gm-manager-workflow-outbox-v1";
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const accountKey = (value: string) => value.trim().toLowerCase();

/** Durable intents only; a queued or retried command is never a domain success. */
export function createWorkflowClient(options: ClientOptions) {
  const now = options.now ?? Date.now;
  const makeId = options.makeId ?? (() => `workflow-${crypto.randomUUID()}`);
  const key = options.storageKey ?? OUTBOX_KEY;
  const recordStore = typeof options.storage.key === "function" && typeof options.storage.length === "number" && typeof options.storage.removeItem === "function";
  const prefix = `${key}:command:`;
  const valid = (entry: WorkflowOutboxEntry) => entry?.requestId && entry.account && entry.scriptUrl && entry.scope && entry.payload && typeof entry.payload.operation === "string";
  const invalidQueue = () => new Error("Hàng đợi công việc bị lỗi. Hãy giữ dữ liệu và liên hệ quản trị viên.");
  const readStored = (): WorkflowOutboxEntry[] => {
    const raw = options.storage.getItem(key);
    let legacy: WorkflowOutboxEntry[] = [];
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.version !== 1 || !Array.isArray(saved.entries) || saved.entries.some((entry: WorkflowOutboxEntry) => !valid(entry))) throw invalidQueue();
      legacy = saved.entries;
    }
    if (!recordStore) return legacy;
    // Each record is an atomic Storage write. Two tabs cannot replace one
    // another's unrelated intents by saving separate whole-array snapshots.
    if (legacy.length) legacy.forEach((entry) => {
      if (!options.storage.getItem(prefix + entry.requestId)) options.storage.setItem(prefix + entry.requestId, JSON.stringify({ version: 1, entry }));
    });
    if (raw) options.storage.removeItem!(key);
    const stored: WorkflowOutboxEntry[] = [];
    for (let index = 0; index < options.storage.length!; index++) {
      const recordKey = options.storage.key!(index);
      if (!recordKey?.startsWith(prefix)) continue;
      const rawRecord = options.storage.getItem(recordKey);
      // A peer tab can acknowledge this record between key() and getItem().
      // A disappeared key is settled intent, not evidence of corrupt storage.
      if (rawRecord === null) continue;
      const record = JSON.parse(rawRecord);
      if (record?.version !== 1 || !valid(record.entry) || recordKey !== prefix + record.entry.requestId) throw invalidQueue();
      stored.push(record.entry);
    }
    return stored.sort((a, b) => a.createdAt - b.createdAt || (a.sequence ?? 0) - (b.sequence ?? 0) || a.requestId.localeCompare(b.requestId));
  };
  let entries = readStored().map((entry): WorkflowOutboxEntry => ({ ...entry, state: entry.state === "sending" ? "queued" : entry.state }));
  let identity: WorkflowIdentity | null = null;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lanes = new Map<string, Promise<void>>();
  const outcomes = new Map<string, WorkflowResult | WorkflowCommandError>();
  const matches = (entry: WorkflowOutboxEntry, actor = identity) => Boolean(actor && entry.account === actor.account && entry.scriptUrl === actor.scriptUrl);
  const pending = () => copy(entries);
  const notify = () => { try { options.onChange?.(pending()); } catch (error) { options.onError?.(error); } };
  const commit = (next: WorkflowOutboxEntry[]) => {
    // Do not start or acknowledge a request until its durable write succeeds.
    if (recordStore) {
      next.forEach((entry) => {
        const prior = entries.find((item) => item.requestId === entry.requestId);
        if (!prior || JSON.stringify(prior) !== JSON.stringify(entry)) options.storage.setItem(prefix + entry.requestId, JSON.stringify({ version: 1, entry }));
      });
      entries.filter((entry) => !next.some((item) => item.requestId === entry.requestId)).forEach((entry) => options.storage.removeItem!(prefix + entry.requestId));
    } else options.storage.setItem(key, JSON.stringify({ version: 1, entries: next }));
    entries = next; notify();
  };
  const update = (requestId: string, patch: Partial<WorkflowOutboxEntry>) => commit(entries.map((entry) => entry.requestId === requestId ? { ...entry, ...patch } : entry));
  const remember = (id: string, outcome: WorkflowResult | WorkflowCommandError) => {
    outcomes.set(id, outcome);
    if (outcomes.size > 100) outcomes.delete(outcomes.keys().next().value!);
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (disposed || !identity || options.isOnline?.() === false) return;
    const heads = new Map<string, WorkflowOutboxEntry>();
    entries.filter((entry) => matches(entry)).forEach((entry) => { if (!heads.has(entry.scope)) heads.set(entry.scope, entry); });
    const due = [...heads.values()].filter((entry) => !["blocked", "conflict", "sending"].includes(entry.state) && !lanes.has(entry.scope));
    if (!due.length) return;
    timer = setTimeout(() => { timer = undefined; void flush(); }, Math.max(0, Math.min(...due.map((entry) => entry.nextAttemptAt)) - now()));
    (timer as unknown as { unref?: () => void }).unref?.();
  };
  const sendEntry = async (entry: WorkflowOutboxEntry, actor: WorkflowIdentity) => {
    if (recordStore && !options.storage.getItem(prefix + entry.requestId)) {
      // Another tab confirmed/discarded this exact intent. Do not resurrect it.
      entries = entries.filter((item) => item.requestId !== entry.requestId); notify();
      remember(entry.requestId, new WorkflowCommandError("Yêu cầu đã được xử lý ở cửa sổ khác. Hãy nạp dữ liệu mới.", { ...entry, state: "blocked", code: "ALREADY_SETTLED" }));
      return true;
    }
    const attempt = entry.attempts + 1;
    update(entry.requestId, { state: "sending", attempts: attempt, error: "", code: "" });
    let response: WorkflowResult;
    try {
      response = await options.send({ ...copy(entry.payload), action: "workflow-command", requestId: entry.requestId, workflowSessionToken: actor.token }, { ...actor });
    } catch (error) {
      const failure = error as { message?: string; status?: number; code?: string };
      response = { ok: false, error: failure?.message || "Mất kết nối. Công việc vẫn được giữ trong hàng đợi.", status: failure?.status, code: failure?.code || (failure?.status ? "HTTP_ERROR" : "NETWORK_ERROR") };
    }
    if (!response || typeof response !== "object") response = { ok: false, code: "INVALID_RESPONSE", error: "Máy chủ trả phản hồi không hợp lệ. Hãy cập nhật ứng dụng trước khi thử lại." };
    if (response.ok === true) {
      commit(entries.filter((item) => item.requestId !== entry.requestId));
      remember(entry.requestId, response);
      // A late reply from a previous login must not paint another user's UI.
      if (matches(entry)) { try { options.onResult?.(copy(entry), response); } catch (error) { options.onError?.(error); } }
      return true;
    }
    const terminal = ["AUTH_REQUIRED", "UNAUTHORIZED", "FORBIDDEN", "VALIDATION", "CONFLICT", "NOT_FOUND", "UPGRADE_REQUIRED"].includes(response.code || "");
    const retryable = !terminal && (response.code === "NETWORK_ERROR" || (Number(response.status) >= 500 && Number(response.status) <= 599) || ["TEMPORARY_UNAVAILABLE", "SERVER_ERROR", "RETRYABLE"].includes(response.code || ""));
    const state = response.code === "CONFLICT" ? "conflict" : retryable && attempt < 8 ? "retrying" : "blocked";
    const patch: Partial<WorkflowOutboxEntry> = { state, error: response.error || "Máy chủ chưa xác nhận thao tác.", code: retryable && attempt >= 8 ? "RETRY_LIMIT" : response.code || "VALIDATION", nextAttemptAt: now() + Math.min(60_000, 1000 * 2 ** Math.min(attempt - 1, 6)) };
    update(entry.requestId, patch);
    const failed = entries.find((item) => item.requestId === entry.requestId)!;
    remember(entry.requestId, new WorkflowCommandError(failed.error!, copy(failed), response));
    return false;
  };
  const runLane = (scope: string): Promise<void> => {
    if (lanes.has(scope)) return lanes.get(scope)!;
    const run = (async () => {
      while (!disposed && identity && options.isOnline?.() !== false) {
        const entry = entries.find((item) => item.scope === scope && matches(item));
        if (!entry || entry.state === "blocked" || entry.state === "conflict" || entry.nextAttemptAt > now()) break;
        if (!(await sendEntry(entry, { ...identity }))) break;
      }
    })().catch((error) => {
      // A quota error after a successful server write leaves the original ID
      // durable. Stop here; manual retry safely replays that ID after cleanup.
      const failed = entries.find((entry) => entry.scope === scope && matches(entry));
      if (failed) {
        const blocked: WorkflowOutboxEntry = { ...failed, state: "blocked", code: "LOCAL_STORAGE", error: "Không thể cập nhật hàng đợi trên thiết bị. Hãy giải phóng bộ nhớ rồi thử lại; yêu cầu gốc vẫn được giữ." };
        entries = entries.map((entry) => entry.requestId === failed.requestId ? blocked : entry);
        remember(failed.requestId, new WorkflowCommandError(blocked.error!, copy(blocked)));
        notify();
      }
      options.onError?.(error);
    }).finally(() => { lanes.delete(scope); schedule(); });
    lanes.set(scope, run);
    // Automatic flushes are best-effort. execute() still receives storage errors.
    void run.catch(() => undefined);
    return run;
  };
  async function flush() {
    if (disposed || !identity || options.isOnline?.() === false) return;
    const scopes = [...new Set(entries.filter((entry) => matches(entry)).map((entry) => entry.scope))];
    await Promise.allSettled(scopes.map(runLane));
    schedule();
  }
  function enqueue(scope: string, payload: Record<string, unknown>, logicalKey = "") {
    if (disposed || !identity?.token) throw new Error("Hãy đăng nhập trước khi giao hoặc hoàn thành công việc.");
    if (!scope.trim() || typeof payload.operation !== "string") throw new Error("Thiếu phạm vi hoặc thao tác công việc.");
    refresh();
    const safePayload = copy(payload);
    ["workflowSessionToken", "adminSessionToken", "requestId", "action"].forEach((name) => delete safePayload[name]);
    const logical = logicalKey || JSON.stringify(safePayload);
    const previous = entries.find((entry) => matches(entry) && entry.scope === scope && entry.logicalKey === logical);
    if (previous) {
      if (JSON.stringify(previous.payload) !== JSON.stringify(safePayload)) throw new WorkflowCommandError("Thao tác trước vẫn đang chờ xác nhận. Hãy xử lý hoặc bỏ yêu cầu cũ trong hàng đợi trước khi gửi nội dung khác.", copy(previous));
      return copy(previous);
    }
    if (entries.length >= 300) throw new Error("Hàng đợi đã đầy. Hãy đồng bộ các công việc đang chờ trước.");
    const requestId = makeId();
    if (!requestId || entries.some((entry) => entry.requestId === requestId)) throw new Error("Mã yêu cầu bị trùng. Hãy thử lại thao tác.");
    const entry: WorkflowOutboxEntry = { requestId, scope, payload: safePayload, logicalKey: logical, account: identity.account, scriptUrl: identity.scriptUrl, state: "queued", attempts: 0, createdAt: now(), nextAttemptAt: now(), sequence: Math.max(0, ...entries.map((item) => item.sequence ?? 0)) + 1 };
    commit([...entries, entry]); schedule(); return copy(entry);
  }
  async function execute(requestId: string) {
    const entry = entries.find((item) => item.requestId === requestId);
    if (entry && !matches(entry)) throw new WorkflowCommandError("Công việc thuộc tài khoản hoặc kết nối khác. Hãy đăng nhập đúng tài khoản để tiếp tục.", copy(entry));
    if (entry && options.isOnline?.() !== false) await runLane(entry.scope);
    const outcome = outcomes.get(requestId);
    if (outcome instanceof WorkflowCommandError) throw outcome;
    if (outcome) return outcome;
    const waiting = entries.find((item) => item.requestId === requestId);
    if (waiting) throw new WorkflowCommandError(waiting.error || "Công việc đã lưu trên thiết bị, đang chờ máy chủ xác nhận.", copy(waiting));
    throw new Error("Không tìm thấy yêu cầu công việc.");
  }
  function retry(requestId: string) {
    const entry = entries.find((item) => item.requestId === requestId);
    if (!entry || entry.state === "sending" || !matches(entry)) return false;
    outcomes.delete(requestId);
    update(requestId, { state: "queued", attempts: 0, error: "", code: "", nextAttemptAt: now() });
    schedule(); return true;
  }
  function discard(requestId: string) {
    const entry = entries.find((item) => item.requestId === requestId);
    if (!entry || entry.state === "sending" || !matches(entry)) return false;
    commit(entries.filter((item) => item.requestId !== requestId)); outcomes.delete(requestId); schedule(); return true;
  }
  function resumeForAccount(next: WorkflowIdentity | null) {
    identity = next?.token && accountKey(next.account) && next.scriptUrl.trim() ? { account: accountKey(next.account), scriptUrl: next.scriptUrl.trim(), token: next.token } : null;
    refresh();
  }
  function refresh() {
    const stored = readStored();
    entries = stored.map((entry): WorkflowOutboxEntry => {
      const inFlight = entries.find((item) => item.requestId === entry.requestId && item.state === "sending");
      return inFlight || { ...entry, state: entry.state === "sending" ? "queued" : entry.state };
    }).concat(entries.filter((entry) => entry.state === "sending" && !stored.some((item) => item.requestId === entry.requestId)));
    schedule(); notify();
  }
  function dispose() { disposed = true; identity = null; if (timer) clearTimeout(timer); }
  return { enqueue, execute, pending, retry, discard, flush, resumeForAccount, refresh, dispose };
}

export function parseWorkflowDate(value: string): number | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value || "");
  if (!match) return null;
  const [day, month, year] = match.slice(1).map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? Math.floor(date.getTime() / 86_400_000) : null;
}
const vietnamDateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });
export function vietnamDayNumber(now = Date.now()): number {
  const parts = vietnamDateFormatter.formatToParts(new Date(now));
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return parseWorkflowDate(`${part("day")}/${part("month")}/${part("year")}`)!;
}
export function workflowStatus(task: { acceptedAt?: string; dueDate?: string; plannedDate?: string }, now = Date.now()): "Đen" | "Xanh" | "Cam" | "Đỏ" | "Tím" {
  if (!task.acceptedAt) return "Đen";
  const due = parseWorkflowDate(task.dueDate || task.plannedDate || "");
  if (due === null) return "Đen";
  const days = due - vietnamDayNumber(now);
  return days < 0 ? "Tím" : days <= 3 ? "Đỏ" : days <= 7 ? "Cam" : "Xanh";
}
export function keepCompletedWorkflow(task: { completedAt?: string; archivedAt?: string; archiveStatus?: string; archivePending?: boolean }, now = Date.now(), retentionMs = 2 * 86_400_000) {
  if (!task.completedAt || task.archivePending || (!task.archivedAt && task.archiveStatus !== "done")) return true;
  const completed = Date.parse(task.completedAt);
  return !Number.isFinite(completed) || now - completed < retentionMs;
}
export type WorkflowSnapshot<T> = { revision: number; items: T[]; deleted?: { id: string; revision: number }[] };
export function mergeWorkflowSnapshot<T extends { id: string; revision?: number }>(current: WorkflowSnapshot<T>, incoming: WorkflowSnapshot<T>): WorkflowSnapshot<T> {
  if (incoming.revision < current.revision) return current;
  const tombstones = new Map<string, number>();
  [...current.deleted || [], ...incoming.deleted || []].forEach((item) => tombstones.set(item.id, Math.max(item.revision, tombstones.get(item.id) ?? -1)));
  const items = incoming.items.filter((item) => (tombstones.get(item.id) ?? -1) < (item.revision ?? incoming.revision));
  return { revision: incoming.revision, items, deleted: [...tombstones].map(([id, revision]) => ({ id, revision })) };
}
