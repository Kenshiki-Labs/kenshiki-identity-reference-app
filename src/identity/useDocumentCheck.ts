import type { DocumentObservation } from '@kenshiki/identity-capture';
import { useCallback } from 'react';
import { AppState } from 'react-native';
import {
  DocumentCheckController,
  type DocumentCheckPort,
  type DocumentCheckState,
} from './DocumentCheckController';
import { useControllerState } from '../ui/useControllerState';

export type DocumentCheckProps = Readonly<{
  session: DocumentCheckPort;
  configured: boolean;
  document?: DocumentObservation;
  onRetake?: () => unknown;
  onState?: (session: DocumentCheckPort, state: DocumentCheckState) => void;
}>;

const initialState: DocumentCheckState = {
  snapshot: undefined,
  busy: false,
  loaded: false,
  failure: undefined,
};

/** Restore local evidence once per connection. Opening results never dispatches a provider check. */
export function useDocumentCheck({ session, configured, onState, document }: DocumentCheckProps) {
  const connect = useCallback(
    (publish: (state: DocumentCheckState) => void) => {
      const active = new DocumentCheckController(
        session,
        (next) => {
          publish(next);
          onState?.(session, next);
        },
        document,
      );
      if (configured) active.restore().catch(active.fail);
      const listener = AppState.addEventListener('change', (next) => {
        if (configured && next === 'background') active.pause().catch(active.fail);
      });
      return {
        controller: active,
        initialState: active.state,
        dispose: async () => {
          listener.remove();
          await active.dispose();
        },
      };
    },
    [session, configured, onState, document],
  );
  return useControllerState(initialState, connect);
}
