// Server-Sent Events hub: one channel per form, broadcasts throttled so a burst of
// answers produces at most one update per THROTTLE_MS.
const THROTTLE_MS = 250;
const HEARTBEAT_MS = 25000;

export function createHub(buildPayload) {
  const channels = new Map(); // formId -> { clients: Set<res>, timer }

  function send(res, payload) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  function subscribe(formId, req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    let ch = channels.get(formId);
    if (!ch) channels.set(formId, (ch = { clients: new Set(), timer: null }));
    ch.clients.add(res);
    send(res, buildPayload(formId));

    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
      ch.clients.delete(res);
      if (ch.clients.size === 0 && !ch.timer) channels.delete(formId);
    });
  }

  function notify(formId) {
    const ch = channels.get(formId);
    if (!ch || ch.timer) return;
    ch.timer = setTimeout(() => {
      ch.timer = null;
      if (ch.clients.size === 0) return channels.delete(formId);
      const payload = buildPayload(formId);
      if (!payload) return; // form was deleted
      for (const res of ch.clients) send(res, payload);
    }, THROTTLE_MS);
  }

  return { subscribe, notify };
}
