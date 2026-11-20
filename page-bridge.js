(() => {
  const SOURCE = "t3-approval-allowlist-page";
  const sockets = new Set();
  const shellRequested = new WeakSet();
  let nextRequestId = 900000;
  const forward = (data) => window.postMessage({ source: SOURCE, type: "frame", data }, "*");
  const sendShellSubscription = (socket) => {
    if (shellRequested.has(socket) || socket.readyState !== NativeWebSocket.OPEN) return;
    shellRequested.add(socket);
    socket.send(JSON.stringify({ _tag: "Request", id: nextRequestId++, tag: "orchestration.subscribeShell", payload: { afterSequence: 0, httpSnapshotFallback: true, requestCompletionMarker: true, omitIdleSubagents: true, omitOlderSettled: true }, traceId: crypto.randomUUID(), spanId: crypto.randomUUID(), sampled: false, headers: [] }));
  };
  const watch = (socket) => {
    if (sockets.has(socket)) return;
    sockets.add(socket);
    socket.addEventListener("message", (event) => forward(event.data));
    socket.addEventListener("open", () => sendShellSubscription(socket));
    socket.addEventListener("close", () => sockets.delete(socket));
    sendShellSubscription(socket);
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
