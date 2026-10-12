import type { EnvironmentCheckSnapshot } from '@kenshiki/identity-capture';
import { useCallback, useRef, useState } from 'react';
import { Text } from 'react-native';
import { CaptureFlowError } from '../identity/CaptureFlowError';
import {
  EnvironmentCheckController,
  type EnvironmentCheckState,
  type SavedEnvironmentCheck,
} from './EnvironmentCheckController';
import { environmentAirText } from './EnvironmentCheckText';
import { t } from '../locales/i18n';
import type { SavedSSNCheck } from '../identity/SSNFlowController';
import { Action } from '../ui/Action';
import { type IdentityCustody, useControllerRouteLifetime } from '../ui/ControllerCustody';
import { ControllerStartup } from '../ui/ControllerStartup';
import { connectBackground } from '../ui/connectBackground';
import { LoadingCard } from '../ui/LoadingCard';
import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';
import { styles } from '../ui/styles';
import { useControllerState } from '../ui/useControllerState';

const initial: EnvironmentCheckState = {
  busy: false,
  opening: true,
  snapshot: undefined,
  failure: undefined,
};
export function IdentityEnvironmentCheck({
  saved,
  onClaim,
  onComplete,
  onExit,
  beforeFinish,
  onFinish,
}: Readonly<{
  saved: SavedSSNCheck;
  onClaim?: () => void;
  onComplete: (value: SavedEnvironmentCheck) => void;
  onExit: () => void;
  beforeFinish?: () => Promise<boolean>;
  onFinish?: (value: SavedEnvironmentCheck) => boolean;
}>) {
  const [entry] = useState(saved);
  const { live, custody } = useControllerRouteLifetime();
  const leaving = useRef(false);
  const [settling, setSettling] = useState(false);

  const connect = useCallback(
    (publish: (state: EnvironmentCheckState) => void) => {
      const controller = new EnvironmentCheckController(entry, publish);
      onClaim?.();
      controller.open().catch(controller.fail);
      return connectBackground(controller);
    },
    [entry, onClaim],
  );
  const { controller, state, failed, cancelStartup } = useControllerState(initial, connect);
  const accept = (value: SavedEnvironmentCheck, attemptID: string | null | undefined) =>
    live.current &&
    reviewable(value.environment) &&
    !!attemptID &&
    value.environment.attemptID === attemptID &&
    onFinish?.(value) === true;
  async function finish(advance = false) {
    if (!controller || leaving.current) return false;
    leaving.current = true;
    setSettling(true);
    try {
      const attemptID = controller.state.snapshot?.attemptID;
      if (advance && (!beforeFinish || !(await beforeFinish()))) throw new CaptureFlowError('contextChanged');
      if (!live.current) return false;
      const value = await controller.handoff(advance ? (result) => accept(result, attemptID) : undefined);
      if (advance) return true;
      if (!live.current) {
        releaseLateEnvironment(custody, value);
        return false;
      }
      onComplete(value);
      return true;
    } catch (error) {
      if (live.current) {
        leaving.current = false;
        setSettling(false);
        controller.fail(error);
      }
      return false;
    }
  }
  const lead = (
    <>
      <Text style={styles.eyebrow}>{t('onboarding.environment.step')}</Text>
      <PageLead
        title={t('onboarding.environment.title')}
        description={t('onboarding.environment.description')}
      />
    </>
  );
  if (!controller)
    return (
      <ControllerStartup
        title={t('onboarding.title')}
        lead={lead}
        failed={failed}
        cancelStartup={cancelStartup}
        onClose={onExit}
        loadingMessage={t('common.pleaseWait')}
      />
    );
  return (
    <Page title={t('onboarding.title')} lead={lead} onClose={() => finish()} testID="onboarding-environment">
      <EnvironmentContent state={state} controller={controller} settling={settling} />
      {!state.busy &&
        !state.failure &&
        !settling &&
        reviewable(state.snapshot) &&
        onFinish &&
        beforeFinish && (
          <Action
            label={t('onboarding.environment.finish')}
            onPress={() => finish(true)}
            testID="onboarding-environment-finish"
          />
        )}
      <Text style={styles.body}>{t('onboarding.environment.note')}</Text>
    </Page>
  );
}
function EnvironmentContent({
  state,
  controller,
  settling,
}: Readonly<{
  state: EnvironmentCheckState;
  controller: EnvironmentCheckController;
  settling: boolean;
}>) {
  if (state.busy || state.opening || settling)
    return <LoadingCard message={t('common.pleaseWait')} testID="onboarding-environment-loading" />;
  const snapshot = state.snapshot;
  return (
    <>
      {state.failure && (
        <Text accessibilityRole="alert" style={styles.body} testID="onboarding-environment-failure">
          {t('common.sessionRecovery')}
        </Text>
      )}
      {snapshot && (
        <>
          {(['location', 'motion'] as const).map(
            (permission) =>
              snapshot.permissions[permission] !== 'given' && (
                <Action
                  key={permission}
                  label={t(
                    permission === 'location'
                      ? 'onboarding.environment.locationPermission'
                      : 'onboarding.environment.motionPermission',
                  )}
                  onPress={() => controller.permission(permission)}
                  testID={`onboarding-environment-permission-${permission}`}
                />
              ),
          )}
          {snapshot.location !== 'notChecked' && (
            <Text style={styles.body} testID={`onboarding-environment-location-${snapshot.location}`}>
              {t(
                snapshot.location === 'observed'
                  ? 'onboarding.environment.locationObserved'
                  : 'onboarding.environment.locationUnavailable',
              )}
            </Text>
          )}
          {snapshot.air !== 'notChecked' && (
            <Text
              accessibilityLiveRegion="polite"
              style={styles.body}
              testID={`onboarding-environment-air-${snapshot.air}`}
            >
              {environmentAirText(snapshot.air)}
            </Text>
          )}
        </>
      )}
      <Action
        label={t(
          snapshot?.state === 'idle' ? 'onboarding.environment.start' : 'onboarding.environment.retry',
        )}
        onPress={controller.check}
        testID="onboarding-environment-run"
      />
    </>
  );
}
function releaseLateEnvironment(custody: IdentityCustody, value: SavedEnvironmentCheck) {
  custody.releasing = Promise.all([custody.releasing, value.session.release()]);
  custody.releasing.catch(custody.reportFailure);
}

function reviewable(snapshot: EnvironmentCheckSnapshot | undefined): snapshot is EnvironmentCheckSnapshot {
  return (
    snapshot?.state === 'completed' &&
    snapshot.location === 'observed' &&
    (snapshot.air === 'consistent' || snapshot.air === 'divergent') &&
    snapshot.reason === null
  );
}
