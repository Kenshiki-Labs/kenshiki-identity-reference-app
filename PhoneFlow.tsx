import type { Configuration, PhoneCheckReceipt, PhoneProviderObservation } from '@kenshiki/identity-capture';
import { IdentityCaptureSession } from '@kenshiki/identity-capture';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { formatMoment } from './HolderText';
import { t } from './locales/i18n';
import { PhoneFlowController, type PhoneFlowState, type SavedPhoneCheck } from './PhoneFlowController';
import { phoneCheckStopped } from './PhonePolicy';
import { SubscriberResultDetails } from './SubscriberResultDetails';
import { Action } from './ui/Action';
import { ControllerStartup } from './ui/ControllerStartup';
import { connectBackground } from './ui/connectBackground';
import { LoadingCard } from './ui/LoadingCard';
import { NativeSheet, useConfirmation } from './ui/NativeSheet';
import { Page } from './ui/Page';
import { styles } from './ui/styles';
import { useControllerState } from './ui/useControllerState';

const initialState: PhoneFlowState = { busy: false, paused: false, opening: true };

export function PhoneFlow({
  configuration,
  saved,
  onComplete,
  onExit,
  onClaim,
}: Readonly<{
  configuration: Configuration;
  saved?: SavedPhoneCheck | undefined;
  onComplete: (value: SavedPhoneCheck) => void;
  onExit: () => void;
  onClaim?: (() => void) | undefined;
}>) {
  const [leaving, setLeaving] = useState(false);
  const [now, setNow] = useState(Date.now);
  const leavingRef = useRef(false);
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
  const finish = async () => {
    if (!controller || leavingRef.current) return false;
    leavingRef.current = true;
    setLeaving(true);
    try {
      const result = await controller.handoff();
      if (result) onComplete(result);
      else onExit();
      return true;
    } catch (error) {
      // Ownership stays here; the failure is shown in this screen's sheet.
      leavingRef.current = false;
      setLeaving(false);
      if (!controller.state.sheet) controller.fail(error);
      return false;
    }
  };
  const close = () =>
    finish().catch((error: unknown) => {
      controller?.fail(error);
      return false;
    });
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
  if (!controller)
    return (
      <ControllerStartup
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
        <View style={styles.card}>
          <Text style={styles.sheetTitle}>{t('common.saveYourResult')}</Text>
          <Text style={styles.body}>{t('phone.saveBody')}</Text>
          <Action
            label={t('common.saveResult')}
            onPress={activeController.save}
            disabled={busy}
            testID="phone-save"
          />
        </View>
      );
    }
    if (waiting) {
      return (
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {state.paused ? t('common.checkPaused') : t('phone.waitingTitle')}
          </Text>
          <Text style={styles.body}>{t('phone.waitingBody')}</Text>
          {(state.paused || snapshot?.failure) && (
            <Action
              label={t('phone.resume')}
              onPress={activeController.resume}
              disabled={busy}
              testID="phone-resume"
            />
          )}
          {snapshot?.sendAgainAt && (
            <Text style={styles.label}>
              {t('phone.sendAgainAfter', { moment: formatMoment(snapshot.sendAgainAt) })}
            </Text>
          )}
          <Action
            label={t('phone.sendAgain')}
            secondary
            onPress={activeController.send}
            disabled={busy || (!!snapshot?.sendAgainAt && now < Date.parse(snapshot.sendAgainAt))}
            testID="phone-send-again"
          />
        </View>
      );
    }
    if ((!snapshot?.receipt || snapshot.pending) && !terminal) {
      return (
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {t('phone.startTitle')}
          </Text>
          <Text style={styles.body}>{t('phone.startBody')}</Text>
          <Text style={styles.body}>{t('phone.consent')}</Text>
          <Action
            label={t('phone.send')}
            onPress={activeController.send}
            disabled={busy || !snapshot}
            testID="phone-send"
          />
          {snapshot?.challengeReserved && (
            <Action
              label={t('phone.checkExisting')}
              secondary
              onPress={activeController.resume}
              disabled={busy}
              testID="phone-check-existing"
            />
          )}
        </View>
      );
    }
    return null;
  }
  function renderReceipt() {
    if (!snapshot?.receipt) return null;
    return (
      <>
        {snapshot.pending && <Text style={styles.eyebrow}>{t('common.previousCheck')}</Text>}
        <PhoneResultDetails receipt={snapshot.receipt} />
        {stopped
          ? !snapshot.pending && (
              <View testID="phone-stopped" style={styles.group}>
                <Action
                  label={t('common.tryAgain')}
                  onPress={() => activeController.ask('restart')}
                  disabled={busy}
                  testID="phone-retry"
                />
              </View>
            )
          : !snapshot.pending && (
              <Action
                label={t('common.runNewCheck')}
                secondary
                onPress={() => activeController.ask('restart')}
                disabled={busy}
                testID="phone-new"
              />
            )}
      </>
    );
  }
  function renderPhoneSheet() {
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
          onPress={finish}
          disabled={leaving}
          testID="phone-sheet-back"
        />
      </NativeSheet>
    );
  }
  return (
    <Page title={t('hub.phone.title')} onClose={close} covered={!!state.sheet} overlay={renderPhoneSheet()}>
      {renderPhoneStage()}
      <PhoneProgress loading={loading} busy={busy} hasReceipt={!!snapshot?.receipt} />
      {terminal && (
        <Action
          label={t('phone.startNew')}
          onPress={() => activeController.ask('restart')}
          disabled={busy}
          testID="phone-start-new"
        />
      )}
      {renderReceipt()}
      {snapshot && (
        <Action
          label={t('phone.erase')}
          destructive
          onPress={() => activeController.ask('erase')}
          disabled={busy}
          testID="phone-erase"
        />
      )}
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

export function PhoneResultDetails({ receipt }: Readonly<{ receipt: PhoneCheckReceipt }>) {
  const comparison = receipt.subjectComparison;
  const evidence = comparison?.evidence;
  const stopped = phoneCheckStopped(receipt);
  return (
    <View testID="phone-result" style={styles.card}>
      <Text accessibilityRole="header" style={styles.sheetTitle}>
        {stopped ? t('phone.result.stoppedTitle') : t('phone.result.confirmedTitle')}
      </Text>
      {stopped && <Text style={styles.body}>{t('phone.result.stoppedBody')}</Text>}
      <Row
        label={stopped ? t('phone.result.senderStopped') : t('phone.result.senderConfirmed')}
        value={`+${receipt.sender}`}
      />
      <Row label={t('phone.result.received')} value={formatMoment(receipt.receivedAt)} />
      <Row label={t('phone.result.completed')} value={formatMoment(receipt.completedAt)} />
      {!stopped && <Text style={styles.body}>{t('phone.result.possessionOnly')}</Text>}
      <Text accessibilityRole="header" style={styles.sheetTitle}>
        {t('phone.result.comparisonTitle')}
      </Text>
      {receipt.subscriberComparison || receipt.subscriberFailure ? (
        <SubscriberResultDetails result={receipt.subscriberComparison} failure={receipt.subscriberFailure} />
      ) : (
        <>
          <Row
            label={t('common.reportedOutcome')}
            value={comparison ? comparisonStatus[comparison.status] : t('phone.result.noComparison')}
          />
          {comparison && (
            <>
              <Row
                label={t('phone.result.fieldsCounted')}
                value={
                  comparison.fieldsCompared.map(fieldLabel).join(t('common.listSeparator')) ||
                  t('common.noneReported')
                }
              />
              <Row label={t('common.compared')} value={formatMoment(comparison.checkedAt)} />
            </>
          )}
          {evidence ? (
            <>
              {evidence.fields.map((field) => (
                <Row
                  key={`${field.source}:${field.field}`}
                  label={fieldLabel(field.field)}
                  value={gradeLabel(field.grade)}
                />
              ))}
              {!evidence.fields.length && <Text style={styles.body}>{t('phone.result.noFieldGrades')}</Text>}
              {!evidence.providers.length && (
                <Text style={styles.body}>{t('phone.result.noNumberChecks')}</Text>
              )}
              {evidence.providers.map((provider, index) => (
                <NumberCheck key={provider.source} index={index} provider={provider} />
              ))}
            </>
          ) : (
            <Text style={styles.body}>{t('phone.result.noEvidence')}</Text>
          )}
        </>
      )}
      <Row label={t('phone.result.challenge')} value={receipt.challengeID} />
      <Row label={t('phone.result.messageDigest')} value={receipt.messageHash} />
      <Row label={t('phone.result.requestReference')} value={evidence?.requestID} />
      {receipt.subscriberComparison && (
        <>
          <Row
            label={t('phone.result.comparisonReference')}
            value={receipt.subscriberComparison.operationID}
          />
          <Row
            label={t('phone.result.policyVersion')}
            value={receipt.subscriberComparison.evaluation.policyVersion}
          />
          <Row label={t('phone.result.profileVersion')} value={receipt.subscriberComparison.profileVersion} />
        </>
      )}
    </View>
  );
}
/** Observations are labelled by what they measure. Rows appear only for values a check returned. */
function NumberCheck({ provider, index }: Readonly<{ provider: PhoneProviderObservation; index: number }>) {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.sheetTitle}>
        {t('phone.numberCheck.title', { number: index + 1 })}
      </Text>
      <Row label={t('phone.numberCheck.answered')} value={provider.answered} />
      {provider.failure != null && <Row label={t('phone.numberCheck.failure')} value={true} />}
      {provider.carrier != null && <Row label={t('phone.numberCheck.carrier')} value={provider.carrier} />}
      {provider.lineType != null && <Row label={t('phone.numberCheck.lineType')} value={provider.lineType} />}
      {provider.originalCarrier != null && (
        <Row label={t('phone.numberCheck.originalCarrier')} value={provider.originalCarrier} />
      )}
      {provider.carrierChanged != null && (
        <Row label={t('phone.numberCheck.carrierChanged')} value={provider.carrierChanged} />
      )}
      {provider.risk != null && <Row label={t('phone.numberCheck.risk')} value={provider.risk} />}
      {provider.smsFraudRiskScore != null && (
        <Row label={t('phone.numberCheck.messageFraudScore')} value={provider.smsFraudRiskScore} />
      )}
      {provider.riskAdvisorScore != null && (
        <Row label={t('phone.numberCheck.numberRiskScore')} value={provider.riskAdvisorScore} />
      )}
      {provider.numberValid != null && (
        <Row label={t('phone.numberCheck.numberValid')} value={provider.numberValid} />
      )}
      {provider.formatValid != null && (
        <Row label={t('phone.numberCheck.formatValid')} value={provider.formatValid} />
      )}
    </View>
  );
}
function Row({
  label,
  value,
}: Readonly<{ label: string; value: string | number | boolean | null | undefined }>) {
  const text =
    value == null || value === ''
      ? t('common.notReturned')
      : typeof value === 'boolean'
        ? value
          ? t('common.yes')
          : t('common.no')
        : String(value);
  return (
    <View style={styles.detail}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.body}>{text}</Text>
    </View>
  );
}
const comparisonStatus = {
  agreed: t('phone.comparison.agreed'),
  singleSource: t('phone.comparison.singleSource'),
  contradicted: t('phone.comparison.contradicted'),
  unavailable: t('phone.comparison.unavailable'),
  notCompared: t('phone.comparison.notCompared'),
};
const fieldNames: Record<string, string> = {
  givenName: t('phone.field.givenName'),
  given_name: t('phone.field.givenName'),
  familyName: t('phone.field.familyName'),
  family_name: t('phone.field.familyName'),
  birthdate: t('phone.field.birthdate'),
  address: t('phone.field.address'),
  locality: t('phone.field.locality'),
  region: t('phone.field.region'),
  postalCode: t('phone.field.postalCode'),
  postal_code: t('phone.field.postalCode'),
  country: t('phone.field.country'),
  idDocument: t('phone.field.idDocument'),
};
const grades: Record<string, string> = {
  match: t('phone.grade.match'),
  no_match: t('phone.grade.noMatch'),
  partial: t('phone.grade.partial'),
  no_data: t('phone.grade.noData'),
  unknown: t('phone.grade.unknown'),
};
function fieldLabel(value: string) {
  return fieldNames[value] ?? t('common.otherDetail');
}
function gradeLabel(value: string) {
  return grades[value] ?? t('phone.grade.unknown');
}
