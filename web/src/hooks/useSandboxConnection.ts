// input: Studio store dispatch, SSE event subscription
// output: Auto-connecting SSE hook
// pos: Lifecycle glue — mounts/unmounts SSE subscription with React

import { useEffect } from "react";
import { useStudioStore } from "@/stores/studio";
import { subscribeToEvents } from "@/lib/api";

export function useSandboxConnection() {
  const dispatch = useStudioStore((s) => s.dispatchEvent);

  useEffect(() => {
    return subscribeToEvents(dispatch);
  }, [dispatch]);
}
