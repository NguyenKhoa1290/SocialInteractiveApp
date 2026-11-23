import { useEffect, useRef, useState } from "react";
import { userApi } from "../api/userApi";
import type { PublicUser } from "../types/auth";

// Fetch each sender once per mounted history, in batches rather than per row.
export function useMessageSenders(messages: readonly { senderId: number | null }[]) {
  const [profiles, setProfiles] = useState<Record<number, PublicUser>>({});
  const requested = useRef(new Set<number>());
  const key = [...new Set(messages.flatMap((m) => m.senderId == null ? [] : [m.senderId]))].sort((a, b) => a - b).join(",");
  useEffect(() => {
    const ids = key ? key.split(",").map(Number).filter((id) => !requested.current.has(id)) : [];
    for (const id of ids) requested.current.add(id);
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      void userApi.byIds(batch).then(({ data }) => {
        setProfiles((old) => ({ ...old, ...Object.fromEntries(data.map((p) => [p.id, p])) }));
      }).catch(() => {
        for (const id of batch) requested.current.delete(id);
      });
    }
  }, [key]);
  return profiles;
}
