import type { Configuration } from '@kenshiki/identity-capture';
import { IdentityCaptureSession } from '@kenshiki/identity-capture';
import { useCallback, useRef, useState } from 'react';
import { Text } from 'react-native';
import { t } from '../locales/i18n';
import { ssnCustodyPresentation } from './SSNCustodyPresentation';
import { type SavedSSNCheck, SSNFlowController, type SSNFlowState } from './SSNFlowController';
import { ssnCheckComplete } from './SSNPolicy';
import { SSNResultDetails } from './SSNResultDetails';
import { Action } from '../ui/Action';
import { type IdentityCustody, useControllerRouteLifetime } from '../ui/ControllerCustody';
import { ControllerStartup } from '../ui/ControllerStartup';
import { connectBackground } from '../ui/connectBackground';
import { ListSection, TextRow } from '../ui/List';
import { LoadingCard } from '../ui/LoadingCard';
import { NativeSheet, useConfirmation } from '../ui/NativeSheet';
import { Page, usePageExit } from '../ui/Page';
import { PageLead } from '../ui/PageLead';
import { styles } from '../ui/styles';
import { useControllerState } from '../ui/useControllerState';

const initialState: SSNFlowState = { busy: false, opening: true };
const presentation = ssnCustodyPresentation();

/** Native entry owns digits and exact-number confirmation; React renders only safe status. */
export function SSNFlow({
  configuration,
  saved,
  onComplete,
  onExit,
  onClaim,
  guided = false,
  onContinue,
}: Readonly<{
  configuration: Configuration;
  saved?: SavedSSNCheck | undefined;
  onComplete: (value: SavedSSNCheck) => void;
  onExit: () => void;
  onClaim?: (() => void) | undefined;
  guided?: boolean;
  onContinue?: (value: SavedSSNCheck) => boolean;
}>) {
  const [finishing, setFinishing] = useState(false);
  const [releaseFailed, setReleaseFailed] = useState(false);
  const finishingRef = useRef(false);
  const { live, custody } = useControllerRouteLifetime();

  const [entry] = useState({ configuration, saved });
  const source = entry.configuration === configuration ? entry.saved : saved;
  const connect = useCallback(
    (publish: (state: SSNFlowState) => void) => {
      const active = new SSNFlowController(
        IdentityCaptureSession.create,
        configuration,
        publish,
        source,
        presentation,
      );
      onClaim?.();
      active.open().catch(active.fail);
      return connectBackground(active);
    },
    [configuration, source, onClaim],
  );
  const { controller, state, failed, cancelStartup } = useControllerState(initialState, connect);
  function finishFailed(error: unknown) {
    if (!live.current || !controller) return false;
    if (controller.disposalStarted) {
      setReleaseFailed(true);
      return false;
    }
    finishingRef.current = false;
    setFinishing(false);
    if (!controller.state.sheet) controller.fail(error);
    return false;
  }
  function acceptContinuation(value: SavedSSNCheck, operation: string | undefined) {
    return (
      live.current &&
      ssnCheckComplete(value.snapshot) &&
      value.snapshot.receipt?.operationID === operation &&
      onContinue?.(value) === true
    );
  }
  async function finish(advance = false) {
    if (!controller || finishingRef.current) return false;
    finishingRef.current = true;
    setFinishing(true);
    try {
      const operation = controller.state.snapshot?.receipt?.operationID;
      const value = await controller.handoff(
        advance ? (result) => acceptContinuation(result, operation) : undefined,
      );
      if (advance && value) return true;
      if (!live.current) {
        if (value) releaseLateSSN(custody, value);
        return false;
      }
      if (value) onComplete(value);
      else onExit();
      return true;
    } catch (error) {
      return finishFailed(error);
    }
  }
  const close = () => finish();
  const exit = usePageExit(close);
  useConfirmation(
    controller && state.sheet?.kind === 'erase'
      ? {
          key: 'erase',
          title: t('ssn.eraseSheet.title'),
          message: t('ssn.eraseSheet.body'),
          confirm: t('common.eraseChecks'),
          keep: t('ssn.eraseSheet.keep'),
          onConfirm: () => {
            controller.erase().catch(controller.fail);
          },
          onKeep: controller.dismiss,
        }
      : undefined,
  );
  const confirmed =
    !state.opening && !state.busy && !state.sheet && !finishing && ssnCheckComplete(state.snapshot);
  const lead = <SSNLead guided={guided} confirmed={confirmed} />;
  if (!controller)
    return (
      <ControllerStartup
        lead={lead}
        title={t('common.socialSecurityNumber')}
        onClose={onExit}
        failed={failed}
        loadingMessage={t('ssn.loading')}
        cancelStartup={cancelStartup}
      />
    );
  const busy = state.busy || finishing;
  const snapshot = state.opening ? undefined : state.snapshot;
  const recovery = state.sheet?.kind === 'recovery' ? state.sheet : undefined;
  function overlay() {
    if (releaseFailed)
      return (
        <NativeSheet title={t('common.checkNeedsAttention')} testID="ssn-release-failure">
          <Text accessibilityRole="alert" style={styles.body}>
            {t('common.sessionRecovery')}
          </Text>
        </NativeSheet>
      );
    if (!recovery || !controller) return null;
    return (
      <NativeSheet title={recovery.title} testID="ssn-bottom-sheet">
        <Text style={styles.body}>{recovery.message}</Text>
        {recovery.recovery !== 'exit' && (
          <Action
            label={recovery.recovery === 'resend' ? t('ssn.resend') : t('common.tryAgain')}
            testID="ssn-retry"
            onPress={controller.retry}
            disabled={busy}
          />
        )}
        <Action
          label={t('common.backToIdentity')}
          secondary
          testID="ssn-back-to-identity"
          onPress={exit}
          disabled={finishing}
        />
      </NativeSheet>
    );
  }
  return (
    <Page
      lead={lead}
      title={t('common.socialSecurityNumber')}
      onClose={close}
      covered={releaseFailed || !!state.sheet}
      overlay={overlay()}
    >
      {state.opening && <LoadingCard message={t('ssn.loading')} testID="ssn-loading" />}
      {busy && !state.opening && (
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          {t('common.pleaseWait')}
        </Text>
      )}
      {snapshot?.recoveryNeeded && (
        <ListSection header={t('ssn.notReceivedTitle')}>
          <TextRow text={t('ssn.notReceivedBody')} />
          <Action
            grouped
            label={t('ssn.resend')}
            testID="ssn-resend-unresolved"
            onPress={controller.recover}
            disabled={busy}
          />
        </ListSection>
      )}
      {snapshot && !snapshot.receipt && !snapshot.recoveryNeeded && (
        <ListSection>
          <TextRow text={t('ssn.entryNotice')} />
          <Action
            grouped
            label={t('ssn.enter')}
            testID="ssn-begin-entry"
            onPress={controller.beginEntry}
            disabled={busy}
          />
        </ListSection>
      )}
      {snapshot?.receipt && (
        <>
          {snapshot.recoveryNeeded && <Text style={styles.eyebrow}>{t('common.previousCheck')}</Text>}
          <SSNResultDetails
            receipt={snapshot.receipt}
            {...(state.session ? { session: state.session } : {})}
            disabled={busy}
          />
          <ListSection>
            {guided && confirmed && onContinue && (
              <Action
                grouped
                label={t('onboarding.choose.continue')}
                testID="onboarding-ssn-continue"
                onPress={() => finish(true)}
                disabled={busy}
              />
            )}
            {!snapshot.recoveryNeeded && (
              <Action
                grouped
                label={t('common.runNewCheck')}
                secondary
                testID="ssn-check-again"
                onPress={controller.beginEntry}
                disabled={busy}
              />
            )}
            {!guided && (
              <Action
                grouped
                label={t('ssn.erase')}
                destructive
                testID="ssn-erase"
                onPress={controller.askErase}
                disabled={busy}
              />
            )}
          </ListSection>
        </>
      )}
    </Page>
  );
}
function SSNLead({ guided, confirmed }: Readonly<{ guided: boolean; confirmed: boolean }>) {
  if (!guided)
    return <PageLead title={t('pageLead.ssn.title')} description={t('pageLead.ssn.description')} />;
  return (
    <>
      <Text style={styles.eyebrow}>{t('onboarding.ssnStep.step')}</Text>
      <PageLead
        title={t(confirmed ? 'onboarding.ssnStep.completedTitle' : 'onboarding.ssnStep.title')}
        description={t(
          confirmed ? 'onboarding.ssnStep.completedDescription' : 'onboarding.ssnStep.description',
        )}
      />
    </>
  );
}
function releaseLateSSN(custody: IdentityCustody, value: SavedSSNCheck) {
  custody.releasing = Promise.all([custody.releasing, value.session.release()]);
  custody.releasing.catch(custody.reportFailure);
}
