(() => {
  const SOURCE = "t3-approval-allowlist-page";
  const sockets = new Set();
  let nextRequestId = 900000;
  const forward = (data) => window.postMessage({ source: SOURCE, type: "frame", data }, "*");
  const watch = (socket) => {
    if (sockets.has(socket)) return;
    sockets.add(socket);
    socket.addEventListener("message", (event) => forward(event.data));
    socket.addEventListener("close", () => sockets.delete(socket));
  };
  const NativeWebSocket = window.WebSocket;
  const WrappedWebSocket = function (...args) {
    const socket = new NativeWebSocket(...args);
    watch(socket);
    return socket;
  };
  WrappedWebSocket.prototype = NativeWebSocket.prototype;
  Object.setPrototypeOf(WrappedWebSocket, NativeWebSocket);
  window.WebSocket = WrappedWebSocket;

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== SOURCE || event.data.type !== "request") return;
    const request = { ...event.data.request, _tag: "Request", id: nextRequestId++ };
    for (const socket of sockets) {
      if (socket.readyState === NativeWebSocket.OPEN) {
        socket.send(JSON.stringify(request));
        break;
      }
    }
  });
})();
