import { useCallback } from 'react';
import { AppState } from 'react-native';
import {
  DocumentCheckController,
  type DocumentCheckPort,
  type DocumentCheckState,
} from './DocumentCheckController';
import { useControllerState } from './ui/useControllerState';

export type DocumentCheckProps = Readonly<{
  session: DocumentCheckPort;
  configured: boolean;
  onRetake?: () => void;
  onState?: (session: DocumentCheckPort, state: DocumentCheckState) => void;
}>;

const initialState: DocumentCheckState = {
  snapshot: undefined,
  busy: false,
  loaded: false,
  failure: undefined,
};

/** Restore local evidence once per connection. Opening results never dispatches a provider check. */
export function useDocumentCheck({ session, configured, onState }: DocumentCheckProps) {
  const connect = useCallback(
    (publish: (state: DocumentCheckState) => void) => {
      const active = new DocumentCheckController(session, (next) => {
        publish(next);
        onState?.(session, next);
      });
      if (configured) active.restore().catch(active.fail);
      const listener = AppState.addEventListener('change', (next) => {
        if (configured && next === 'background') active.pause().catch(active.fail);
      });
      return {
        controller: active,
        initialState: active.state,
        dispose: (): undefined => {
          active.dispose();
          listener.remove();
        },
      };
    },
    [session, configured, onState],
  );
  return useControllerState(initialState, connect);
}
