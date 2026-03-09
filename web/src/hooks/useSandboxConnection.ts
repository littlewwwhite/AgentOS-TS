// input: Studio store dispatch, WebSocket event subscription
// output: Auto-connecting WebSocket hook
// pos: Lifecycle glue — mounts/unmounts WebSocket subscription with React

import { useEffect } from "react";
import { useStudioStore } from "@/stores/studio";
import { connectWebSocket } from "@/lib/api";

export function useSandboxConnection() {
  const dispatch = useStudioStore((s) => s.dispatchEvent);

  useEffect(() => {
    return connectWebSocket(dispatch);
  }, [dispatch]);
}
