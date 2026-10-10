import { useContext, useMemo, useSyncExternalStore } from 'react';
import { ControllerCustodyContext, createControllerCustody, type IdentityCustody } from './ControllerCustody';

type Connection<State, Controller> = {
  controller: Controller;
  initialState: State;
  dispose: () => undefined | Promise<unknown>;
};
type Snapshot<State, Controller> = { controller: Controller | undefined; state: State; failed: boolean };
type Connect<State, Controller> = (
  publish: (state: State) => void,
) => Connection<State, Controller> | undefined;

/** Adapts a native controller to React's external-store contract. The connection starts after
 * commit, when React subscribes; constructing a store during render never opens a native session.
 * A replaced connection cannot publish into its successor, and the controller's immutable state
 * is the rendering snapshot rather than a second copy maintained by a component effect. */
export function useControllerState<State, Controller>(
  initialState: State,
  connect: Connect<State, Controller>,
) {
  const sharedCustody = useContext(ControllerCustodyContext);
  const custody = useMemo(() => sharedCustody ?? createControllerCustody(), [sharedCustody]);
  const store = useMemo(
    () => controllerStore(initialState, connect, custody),
    [initialState, connect, custody],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getInitialSnapshot);
  return { ...snapshot, cancelStartup: store.cancelStartup };
}

function controllerStore<State, Controller>(
  initialState: State,
  connect: Connect<State, Controller>,
  custody: IdentityCustody,
) {
  const initial: Snapshot<State, Controller> = { controller: undefined, state: initialState, failed: false };
  let snapshot = initial;
  let disconnect: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => snapshot,
    getInitialSnapshot: () => initial,
    cancelStartup() {
      if (snapshot.controller !== undefined) return;
      disconnect?.();
      disconnect = undefined;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        let live = true;
        let published = false;
        let connection: Connection<State, Controller> | undefined;
        const fail = (error: unknown) => {
          custody.reportFailure(error);
          if (!live) return;
          snapshot = { ...snapshot, failed: true };
          notify();
        };
        const start = () => {
          if (!live) return;
          try {
            connection = connect((state) => {
              if (!live) return;
              published = true;
              if (state === snapshot.state) return;
              snapshot = { ...snapshot, state };
              notify();
            });
          } catch (error) {
            custody.releasing = Promise.reject(error);
            custody.releasing.catch(custody.reportFailure);
            fail(error);
            return;
          }
          if (connection) {
            snapshot = {
              controller: connection.controller,
              state: published ? snapshot.state : connection.initialState,
              failed: false,
            };
            notify();
          }
        };
        // Another controller can extend custody between subscription and this microtask. Always
        // join that newer release before acquisition, including cleanup from the same commit.
        const waitForCustody = () => {
          const releasing = custody.releasing;
          releasing.then(() => {
            if (!live) return;
            if (releasing !== custody.releasing) waitForCustody();
            else start();
          }, fail);
        };
        waitForCustody();
        disconnect = () => {
          live = false;
          // Immediate async invocation calls dispose synchronously and awaits its cleanup.
          // A synchronous throw rejects the same promise as an asynchronous release failure.
          const release = (async () => {
            await connection?.dispose();
          })();
          custody.releasing = Promise.all([custody.releasing, release]);
          // Observe immediately, and retain the rejection so a later owner cannot open.
          custody.releasing.catch(custody.reportFailure);
          snapshot = initial;
        };
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          disconnect?.();
          disconnect = undefined;
        }
      };
    },
  };
}
