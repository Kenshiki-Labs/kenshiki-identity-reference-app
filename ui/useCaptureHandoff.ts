import { useEffect, useRef } from 'react';

/** A completed capture returns to its detail route without a second Done action. A failed
 * handoff stays with its owner for explicit recovery rather than retrying on every render. */
export function useCaptureHandoff(
  evidence: object | undefined,
  ready: boolean,
  finish: () => Promise<unknown>,
  fail: (error: unknown) => void,
) {
  const attempted = useRef<object | undefined>(undefined);
  useEffect(() => {
    if (!evidence || !ready || attempted.current === evidence) return;
    attempted.current = evidence;
    finish().catch(fail);
  }, [evidence, ready, finish, fail]);
}
