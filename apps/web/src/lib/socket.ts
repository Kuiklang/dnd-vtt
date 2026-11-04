import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

/** Shared Socket.IO connection (cookie-authenticated, auto-reconnecting). */
export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });
  }
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}

export type AckResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export function emitAck<T = unknown>(event: string, payload: unknown, timeoutMs = 8000): Promise<T> {
  const s = getSocket();
  return new Promise<T>((resolve, reject) => {
    s.timeout(timeoutMs).emit(event, payload, (err: Error | null, res: AckResult<T>) => {
      if (err) return reject(new Error("The server didn't respond. Check your connection."));
      if (!res.ok) return reject(new Error(res.error));
      resolve(res.data);
    });
  });
}
