import { useEffect } from 'react';

/** The navigation bar's Cancel button over a full-screen check. The check fills it in with the same
 * way out as its own close action, so Cancel never skips a handoff or a session release. */
export type CancelHandle = { current: (() => void) | undefined };

export function useCancel(
  handle: CancelHandle | undefined,
  leave: () => Promise<unknown>,
  fail: (error: unknown) => void,
) {
  useEffect(() => {
    if (!handle) return;
    handle.current = () => {
      leave().catch(fail);
    };
    return () => {
      handle.current = undefined;
    };
  });
}
