import { createContext, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import { Alert } from 'react-native';
import { t } from '../locales/i18n';

/** The next holder waits for every controller owned by the previous holder to close. A failed
 * release remains rejected so the workspace can present recovery before any new acquisition. */
export type IdentityCustody = {
  releasing: Promise<unknown>;
  reportFailure: (error: unknown) => void;
};

/** The reporter survives holder changes and presents one recovery notice for a failed custody
 * lifetime. No native error text or payload is included in the user-facing message. */
export function createControllerCustody(): IdentityCustody {
  let reported = false;
  return {
    releasing: Promise.resolve(),
    reportFailure: (_error: unknown) => {
      if (reported) return;
      reported = true;
      Alert.alert(t('common.checkNeedsAttention'), t('common.sessionRecovery'));
    },
  };
}

export const ControllerCustodyContext = createContext<IdentityCustody | undefined>(undefined);

/** Fences late route callbacks while retaining the shared native-release barrier. */
export function useControllerRouteLifetime() {
  const shared = useContext(ControllerCustodyContext);
  const custody = useMemo(() => shared ?? createControllerCustody(), [shared]);
  const live = useRef(false);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  return { live, custody };
}
