const resources = ["workspace", "personnel", "assignments", "messages", "documents", "photos"] as const;
export type RealtimeResource = typeof resources[number];
export type RealtimeStatus = "connecting" | "ready" | "disconnected" | "unauthorized" | "closed";
const resourceChangeEvent = "gm-manager-realtime-change";

export function publishRealtimeChange(changed: readonly RealtimeResource[] = resources) {
  window.dispatchEvent(new CustomEvent(resourceChangeEvent, { detail: changed }));
}

export function onRealtimeChange(resource: RealtimeResource, refresh: () => void) {
  const listener = (event: Event) => {
    if ((event as CustomEvent<RealtimeResource[]>).detail?.includes(resource)) refresh();
  };
  window.addEventListener(resourceChangeEvent, listener);
  return () => window.removeEventListener(resourceChangeEvent, listener);
}

type RealtimeOptions = {
  url: string;
  token?: string;
  onInvalidate?: (resources: RealtimeResource[]) => void;
  onStatusChange?: (status: RealtimeStatus) => void;
};

type Reply<T> = { status: number; result: T };
type PendingRequest = {
  wire: string;
  sent: boolean;
  timeout: number;
  finish: (error: RealtimeRequestError | null, reply?: Reply<unknown>) => void;
};

export class RealtimeRequestError extends Error {
  constructor(message: string, public readonly sent: boolean) {
    super(message);
    this.name = "RealtimeRequestError";
  }
}

export type RealtimeClient = ReturnType<typeof connectRealtime>;

export function connectRealtime(options: RealtimeOptions) {
  const endpoint = new URL(options.url);
  const localDevelopment = endpoint.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if ((endpoint.protocol !== "wss:" && !localDevelopment) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("Địa chỉ WebSocket không hợp lệ.");
  }

  let socket: WebSocket | undefined;
  let timer: number | undefined;
  let reconnectAttempt = 0;
  let sequence = 0;
  let status: RealtimeStatus = "disconnected";
  const pending = new Map<string, PendingRequest>();

  function setStatus(next: RealtimeStatus) {
    if (next === status) return;
    status = next;
    options.onStatusChange?.(next);
  }

  function stopTimer() {
    window.clearTimeout(timer);
    timer = undefined;
  }

  function rejectRequests(message: string, sentOnly = false) {
    for (const request of pending.values()) {
      if (!sentOnly || request.sent) request.finish(new RealtimeRequestError(message, request.sent));
    }
  }

  function closeSocket() {
    const previous = socket;
    socket = undefined;
    previous?.close();
  }

  function scheduleReconnect() {
    stopTimer();
    if (!navigator.onLine || status === "closed" || status === "unauthorized") return;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(reconnectAttempt++, 6));
    timer = window.setTimeout(connect, delay * (0.8 + 0.4 * Math.random()));
  }

  function disconnect() {
    closeSocket();
    // A sent request might already have committed. The calling action can
    // reconcile its state or retry with its original idempotency key.
    rejectRequests("Mất kết nối. Máy chủ có thể đã xử lý yêu cầu.", true);
    setStatus("disconnected");
    scheduleReconnect();
  }

  function heartbeat(connection: WebSocket) {
    stopTimer();
    timer = window.setTimeout(() => {
      if (socket !== connection) return;
      try { connection.send(JSON.stringify({ type: "ping" })); }
      catch { disconnect(); return; }
      timer = window.setTimeout(disconnect, 12_000);
    }, 25_000);
  }

  function sendPending() {
    if (status !== "ready" || !socket) return;
    for (const request of pending.values()) {
      if (request.sent) continue;
      try {
        socket.send(request.wire);
        request.sent = true;
      } catch { disconnect(); return; }
    }
  }

  function connect() {
    if (socket || !navigator.onLine || status === "closed" || status === "unauthorized") return;
    stopTimer();
    setStatus("connecting");

    let connection: WebSocket;
    try { connection = new WebSocket(endpoint.href); }
    catch { disconnect(); return; }
    socket = connection;
    timer = window.setTimeout(disconnect, 12_000);

    connection.addEventListener("open", () => {
      if (socket !== connection) return;
      const token = options.token;
      try { connection.send(JSON.stringify(token ? { type: "auth", token } : { type: "auth" })); }
      catch { disconnect(); }
    });

    connection.addEventListener("message", (event) => {
      if (socket !== connection || typeof event.data !== "string") return;
      let frame: Record<string, unknown>;
      try { frame = JSON.parse(event.data); }
      catch { return; }
      if (!frame || typeof frame !== "object") return;

      if (frame.type === "ready" && status === "connecting") {
        reconnectAttempt = 0;
        heartbeat(connection);
        setStatus("ready");
        sendPending();
        return;
      }
      if (status !== "ready") return;

      if (frame.type === "pong") heartbeat(connection);
      if (frame.type === "invalidate" && Array.isArray(frame.resources)) {
        const incoming = frame.resources;
        const changed = resources.filter((resource) => incoming.includes(resource));
        if (changed.length) options.onInvalidate?.(changed);
      }
      if (frame.type === "response" && typeof frame.id === "string" && Object.hasOwn(frame, "result")) {
        const request = pending.get(frame.id);
        if (!request?.sent) return;
        const replyStatus = typeof frame.status === "number" && Number.isInteger(frame.status) && frame.status >= 200 && frame.status <= 599 ? frame.status : 200;
        request.finish(null, { result: frame.result, status: replyStatus });
      }
    });

    connection.addEventListener("close", (event) => {
      if (socket !== connection) return;
      if (event.code === 4401 || event.code === 4403) {
        socket = undefined;
        stopTimer();
        rejectRequests("Phiên đăng nhập không còn được máy chủ chấp nhận.");
        setStatus("unauthorized");
      } else disconnect();
    });
  }

  function onOffline() {
    if (socket) disconnect();
    else stopTimer();
  }

  function request<T>(payload: Record<string, unknown>, settings: { timeoutMs?: number } = {}): Promise<Reply<T>> {
    if (status === "closed" || status === "unauthorized") {
      return Promise.reject(new RealtimeRequestError("Kết nối máy chủ chưa sẵn sàng.", false));
    }
    if (pending.size >= 64) return Promise.reject(new RealtimeRequestError("Đang có quá nhiều yêu cầu tới máy chủ.", false));

    const id = String(++sequence);
    return new Promise((resolve, reject) => {
      const wire = JSON.stringify({ type: "request", id, payload });
      const entry: PendingRequest = {
        wire,
        sent: false,
        timeout: window.setTimeout(() => entry.finish(new RealtimeRequestError("Yêu cầu tới máy chủ đã hết thời gian chờ.", entry.sent)), settings.timeoutMs ?? 30_000),
        finish(error, reply) {
          window.clearTimeout(entry.timeout);
          pending.delete(id);
          if (error) reject(error);
          else resolve(reply as Reply<T>);
        },
      };
      pending.set(id, entry);
      sendPending();
    });
  }

  window.addEventListener("online", connect);
  window.addEventListener("offline", onOffline);
  connect();

  return {
    get status() { return status; },
    request,
    close() {
      if (status === "closed") return;
      stopTimer();
      window.removeEventListener("online", connect);
      window.removeEventListener("offline", onOffline);
      closeSocket();
      rejectRequests("Đã đóng kết nối máy chủ.");
      setStatus("closed");
    },
  };
}
