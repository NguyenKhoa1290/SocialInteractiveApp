import type { Message } from "../types/chat";

// Keep root messages chronological, with replies (including replies to replies)
// ordered underneath their root. Missing parents stay visible until history is
// loaded; malformed cycles cannot hide messages or loop forever.
export function meetingThreads(messages: readonly Message[], query = "") {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const roots = new Map<number, number>();
  const rootOf = (message: Message) => {
    const path: number[] = [];
    const seen = new Set<number>();
    let current = message;
    let root: number;
    while (true) {
      if (roots.has(current.id)) { root = roots.get(current.id)!; break; }
      if (seen.has(current.id)) { root = Math.min(...path); break; }
      path.push(current.id); seen.add(current.id);
      const parent = current.replyToId == null ? undefined : byId.get(current.replyToId);
      if (!parent) { root = current.id; break; }
      current = parent;
    }
    for (const id of path) roots.set(id, root);
    return root;
  };
  const buckets = new Map<number, Message[]>();
  for (const message of messages) {
    const root = rootOf(message);
    const bucket = buckets.get(root) ?? [];
    bucket.push(message); buckets.set(root, bucket);
  }
  const order = new Map(messages.map((m, i) => [m.id, i]));
  const q = query.trim().toLowerCase();
  return [...buckets].sort(([a], [b]) => order.get(a)! - order.get(b)!)
    .filter(([, thread]) => !q || thread.some((m) =>
      (m.content ?? "").toLowerCase().includes(q) || (m.senderDisplayName ?? "").toLowerCase().includes(q)))
    .flatMap(([rootId, thread]) => {
      const root = byId.get(rootId)!;
      return [root, ...thread.filter((m) => m.id !== rootId)].map((message) => ({
        message, rootId, isReply: message.id !== rootId,
        parentLoaded: message.replyToId != null && byId.has(message.replyToId),
      }));
    });
}
