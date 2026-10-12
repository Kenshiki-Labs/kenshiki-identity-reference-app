import type { Configuration } from '@kenshiki/identity-capture';
import { IdentityCaptureSession } from '@kenshiki/identity-capture';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { formatMoment } from '../app/HolderText';
import { t } from '../locales/i18n';
import { PhoneFlowController, type PhoneFlowState, type SavedPhoneCheck } from './PhoneFlowController';
import { phoneCheckComplete, phoneCheckStopped } from './PhonePolicy';
import { PhoneResultDetails } from './PhoneResultDetails';
import { Action } from '../ui/Action';
import { type IdentityCustody, useControllerRouteLifetime } from '../ui/ControllerCustody';
import { ControllerStartup } from '../ui/ControllerStartup';
import { connectBackground } from '../ui/connectBackground';
import { ContentRow, ListSection, TextRow } from '../ui/List';
import { LoadingCard } from '../ui/LoadingCard';
import { NativeSheet, useConfirmation } from '../ui/NativeSheet';
import { Page, usePageExit } from '../ui/Page';
import { PageLead } from '../ui/PageLead';
import { styles } from '../ui/styles';
import { useControllerState } from '../ui/useControllerState';

const initialState: PhoneFlowState = { session: undefined, busy: false, paused: false, opening: true };

export function PhoneFlow({
  configuration,
  saved,
  onComplete,
  onExit,
  onClaim,
  onContinue,
  guided = false,
}: Readonly<{
  configuration: Configuration;
  guided?: boolean;
  saved?: SavedPhoneCheck | undefined;
  onComplete: (value: SavedPhoneCheck) => void;
  onContinue?: (value: SavedPhoneCheck) => boolean;
  onExit: () => void;
  onClaim?: (() => void) | undefined;
}>) {
  const [leaving, setLeaving] = useState(false);
  const [releaseFailed, setReleaseFailed] = useState(false);
  const [now, setNow] = useState(Date.now);
  const leavingRef = useRef(false);
  const { live, custody } = useControllerRouteLifetime();

  // The route adopts its input once. Publishing a completed handoff clears the workspace's
  // pending input before native Back removes this route; that must not open a replacement owner.
  const [entry] = useState({ configuration, saved });
  const source = entry.configuration === configuration ? entry.saved : saved;
  const connect = useCallback(
    (publish: (state: PhoneFlowState) => void) => {
      const active = new PhoneFlowController(IdentityCaptureSession.create, configuration, publish, source);
      onClaim?.();
      active.open().catch(active.fail);
      return connectBackground(active);
    },
    [configuration, source, onClaim],
  );
  const { controller, state, failed, cancelStartup } = useControllerState(initialState, connect);
  useEffect(() => {
    if (!state.snapshot?.sendAgainAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.snapshot?.sendAgainAt]);
  const acceptContinuation = (value: SavedPhoneCheck, challenge: string | undefined) =>
    live.current &&
    phoneCheckComplete(value.snapshot) &&
    value.snapshot.receipt?.challengeID === challenge &&
    onContinue?.(value) === true;
  const finishFailed = (error: unknown) => {
    if (!live.current || !controller) return false;
    if (controller.disposalStarted) {
      setReleaseFailed(true);
      return false;
    }
    leavingRef.current = false;
    setLeaving(false);
    if (!controller.state.sheet) controller.fail(error);
    return false;
  };
  const finish = async (advance = false) => {
    if (!controller || leavingRef.current) return false;
    leavingRef.current = true;
    setLeaving(true);
    try {
      const challenge = controller.state.snapshot?.receipt?.challengeID;
      const result = await controller.handoff(
        advance ? (value) => acceptContinuation(value, challenge) : undefined,
      );
      // A successful continuation already transferred custody synchronously to the workspace.
      if (advance && result) return true;
      if (!live.current) {
        if (result) releaseLatePhone(custody, result);
        return false;
      }
      if (result) onComplete(result);
      else onExit();
      return true;
    } catch (error) {
      return finishFailed(error);
    }
  };
  const close = () =>
    finish().catch((error: unknown) => {
      controller?.fail(error);
      return false;
    });
  const exit = usePageExit(() => finish());
  const choice = state.sheet?.kind === 'error' ? undefined : state.sheet?.kind;
  useConfirmation(
    controller && choice
      ? {
          key: choice,
          title: choice === 'erase' ? t('phone.sheet.eraseTitle') : t('phone.sheet.restartTitle'),
          message: choice === 'erase' ? t('phone.sheet.eraseBody') : t('phone.sheet.restartBody'),
          confirm: choice === 'erase' ? t('common.eraseChecks') : t('phone.sheet.startNew'),
          keep: t('phone.sheet.keepCurrent'),
          onConfirm: () => {
            controller.confirm().catch(controller.fail);
          },
          onKeep: controller.dismiss,
        }
      : undefined,
  );
  const confirmed = phoneFlowConfirmed(state, leaving);
  const lead = <PhoneLead guided={guided} confirmed={confirmed} />;
  if (!controller)
    return (
      <ControllerStartup
        lead={lead}
        title={t('hub.phone.title')}
        onClose={onExit}
        failed={failed}
        loadingMessage={t('phone.loading')}
        cancelStartup={cancelStartup}
      />
    );
  const activeController = controller;
  const snapshot = state.opening ? undefined : state.snapshot;
  const busy = state.busy || leaving;
  const loading = state.opening || (!snapshot && busy);
  const waiting = snapshot?.stage === 'waiting';
  const saving = snapshot?.stage === 'finishing';
  const terminal = ['expired', 'unknownChallenge', 'conflict', 'refused', 'receiptUnavailable'].includes(
    snapshot?.failure ?? '',
  );
  const stopped = !!snapshot?.receipt && phoneCheckStopped(snapshot.receipt);
  function renderPhoneStage() {
    if (!snapshot) return null;
    if (saving) {
      return (
        <ListSection header={t('common.saveYourResult')}>
          <TextRow text={t('phone.saveBody')} />
          <Action
            grouped
            label={t('common.saveResult')}
            onPress={activeController.save}
            disabled={busy}
            testID="phone-save"
          />
        </ListSection>
      );
    }
    if (waiting) {
      return (
        <ListSection header={state.paused ? t('common.checkPaused') : t('phone.waitingTitle')}>
          <TextRow text={t('phone.waitingBody')} />
          {(state.paused || snapshot?.failure) && (
            <Action
              grouped
              label={t('phone.resume')}
              onPress={activeController.resume}
              disabled={busy}
              testID="phone-resume"
            />
          )}
          {snapshot?.sendAgainAt && (
            <TextRow text={t('phone.sendAgainAfter', { moment: formatMoment(snapshot.sendAgainAt) })} />
          )}
          <Action
            grouped
            label={t('phone.sendAgain')}
            secondary
            onPress={activeController.send}
            disabled={busy || (!!snapshot?.sendAgainAt && now < Date.parse(snapshot.sendAgainAt))}
            testID="phone-send-again"
          />
        </ListSection>
      );
    }
    if ((!snapshot?.receipt || snapshot.pending) && !terminal) {
      return (
        <ListSection header={t('phone.startTitle')}>
          <ContentRow>
            <Text style={styles.body}>{t('phone.startBody')}</Text>
            <Text style={styles.body}>{t('phone.consent')}</Text>
          </ContentRow>
          <Action
            grouped
            label={t('phone.send')}
            onPress={activeController.send}
            disabled={busy || !snapshot}
            testID="phone-send"
          />
          {snapshot?.challengeReserved && (
            <Action
              grouped
              label={t('phone.checkExisting')}
              secondary
              onPress={activeController.resume}
              disabled={busy}
              testID="phone-check-existing"
            />
          )}
        </ListSection>
      );
    }
    return null;
  }
  function renderReceipt() {
    if (!snapshot?.receipt) return null;
    return (
      <>
        {snapshot.pending && <Text style={styles.eyebrow}>{t('common.previousCheck')}</Text>}
        <PhoneResultDetails
          receipt={snapshot.receipt}
          {...(state.session ? { session: state.session } : {})}
          disabled={busy}
        />
      </>
    );
  }
  function renderPhoneSheet() {
    if (releaseFailed)
      return (
        <NativeSheet title={t('common.checkNeedsAttention')} testID="phone-release-failure">
          <Text accessibilityRole="alert" style={styles.body}>
            {t('common.sessionRecovery')}
          </Text>
        </NativeSheet>
      );
    if (state.sheet?.kind !== 'error') return null;
    return (
      <NativeSheet title={t('common.checkNeedsAttention')} testID="phone-bottom-sheet">
        <Text style={styles.body}>{state.sheet.message}</Text>
        <Action
          label={t('phone.sheet.backToCheck')}
          secondary
          onPress={activeController.dismiss}
          disabled={busy}
          testID="phone-sheet-dismiss"
        />
        <Action
          label={t('common.backToIdentity')}
          secondary
          onPress={exit}
          disabled={leaving}
          testID="phone-sheet-back"
        />
      </NativeSheet>
    );
  }
  function restartAction() {
    if (terminal) return { label: t('phone.startNew'), testID: 'phone-start-new' };
    if (stopped) return { label: t('common.tryAgain'), testID: 'phone-retry' };
    return { label: t('common.runNewCheck'), testID: 'phone-new' };
  }
  function renderActions() {
    if (!snapshot) return null;
    const restart = restartAction();
    return (
      <ListSection testID={stopped ? 'phone-stopped' : undefined}>
        {guided && onContinue && confirmed && (
          <Action
            grouped
            label={t('onboarding.choose.continue')}
            onPress={() => finish(true)}
            disabled={busy}
            testID="onboarding-phone-continue"
          />
        )}
        {(terminal || (snapshot.receipt && !snapshot.pending)) && (
          <Action
            grouped
            label={restart.label}
            onPress={() => activeController.ask('restart')}
            disabled={busy}
            testID={restart.testID}
          />
        )}
        {!guided && (
          <Action
            grouped
            label={t('phone.erase')}
            destructive
            onPress={() => activeController.ask('erase')}
            disabled={busy}
            testID="phone-erase"
          />
        )}
      </ListSection>
    );
  }
  return (
    <Page
      lead={lead}
      title={t('hub.phone.title')}
      onClose={close}
      covered={releaseFailed || !!state.sheet}
      overlay={renderPhoneSheet()}
    >
      {renderPhoneStage()}
      <PhoneProgress loading={loading} busy={busy} hasReceipt={!!snapshot?.receipt} />
      {renderReceipt()}
      {renderActions()}
    </Page>
  );
}

/** Background handoff work must not insert a row above a mounted receipt. */
function PhoneProgress({
  loading,
  busy,
  hasReceipt,
}: Readonly<{ loading: boolean; busy: boolean; hasReceipt: boolean }>) {
  if (loading) return <LoadingCard message={t('phone.loading')} testID="phone-loading" />;
  if (!busy || hasReceipt) return null;
  return (
    <Text accessibilityLiveRegion="polite" style={styles.body}>
      {t('common.pleaseWait')}
    </Text>
  );
}

function releaseLatePhone(custody: IdentityCustody, result: SavedPhoneCheck) {
  custody.releasing = Promise.all([custody.releasing, result.session.release()]);
  custody.releasing.catch(custody.reportFailure);
}

function phoneFlowConfirmed(state: PhoneFlowState, leaving: boolean): boolean {
  return !state.opening && !state.busy && !state.sheet && !leaving && phoneCheckComplete(state.snapshot);
}
function PhoneLead({ guided, confirmed }: Readonly<{ guided: boolean; confirmed: boolean }>) {
  if (!guided)
    return <PageLead title={t('pageLead.phone.title')} description={t('pageLead.phone.description')} />;
  return (
    <>
      <Text style={styles.eyebrow}>{t('onboarding.phoneStep.step')}</Text>
      <PageLead
        title={t(confirmed ? 'onboarding.phoneStep.confirmedTitle' : 'onboarding.phoneStep.title')}
        description={t(
          confirmed ? 'onboarding.phoneStep.confirmedDescription' : 'onboarding.phoneStep.description',
        )}
      />
      {confirmed && (
        <Text testID="onboarding-phone-confirmed" accessibilityLiveRegion="polite" style={styles.body}>
          {t('phone.result.possessionOnly')}
        </Text>
      )}
    </>
  );
}
