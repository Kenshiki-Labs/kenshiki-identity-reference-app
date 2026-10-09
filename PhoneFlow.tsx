import type { Configuration, PhoneCheckReceipt, PhoneProviderObservation } from '@kenshiki/identity-capture';
import { IdentityCaptureSession } from '@kenshiki/identity-capture';
import { useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, Text, View } from 'react-native';
import { formatMoment } from './HolderText';
import { Action, styles } from './IdentityCaptureFlow';
import { t } from './locales/i18n';
import { PhoneFlowController, type PhoneFlowState, type SavedPhoneCheck } from './PhoneFlowController';
import { phoneCheckStopped } from './PhonePolicy';
import { SubscriberResultDetails } from './SubscriberResultDetails';

export function PhoneFlow({
  configuration,
  saved,
  onComplete,
  onExit,
}: {
  configuration: Configuration;
  saved?: SavedPhoneCheck | undefined;
  onComplete: (value: SavedPhoneCheck) => void;
  onExit: () => void;
}) {
  const [controller, setController] = useState<PhoneFlowController>();
  const [state, setState] = useState<PhoneFlowState>({ busy: false, paused: false });
  const [leaving, setLeaving] = useState(false);
  const [now, setNow] = useState(Date.now());
  const leavingRef = useRef(false);
  useEffect(() => {
    const active = new PhoneFlowController(IdentityCaptureSession.create, configuration, setState, saved);
    setController(active);
    setState(active.state);
    active.open().catch(active.fail);
    const subscription = AppState.addEventListener('change', (next) => {
      // Apple's message composer can make the app inactive. Only backgrounding cancels it.
      if (next === 'background') active.pause().catch(active.fail);
    });
    return () => {
      subscription.remove();
      active.dispose().catch(active.fail);
    };
  }, [configuration, saved]);
  useEffect(() => {
    if (!state.snapshot?.sendAgainAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.snapshot?.sendAgainAt]);
  if (!controller) return <View style={styles.root} />;
  const activeController = controller;
  const finish = async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    try {
      const result = await activeController.handoff();
      if (result) onComplete(result);
      else onExit();
    } catch (error) {
      // Ownership stays here; the failure is shown in this screen's sheet.
      leavingRef.current = false;
      setLeaving(false);
      if (!activeController.state.sheet) activeController.fail(error);
    }
  };
  const snapshot = state.snapshot;
  const busy = state.busy || leaving;
  const waiting = snapshot?.stage === 'waiting';
  const saving = snapshot?.stage === 'finishing';
  const terminal = ['expired', 'unknownChallenge', 'conflict', 'refused'].includes(snapshot?.failure ?? '');
  const stopped = !!snapshot?.receipt && phoneCheckStopped(snapshot.receipt);
  function renderPhoneStage() {
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
        {stopped ? (
          !snapshot.pending && (
            <View testID="phone-stopped" style={styles.group}>
              <Action
                label={t('common.tryAgain')}
                onPress={() => activeController.ask('restart')}
                disabled={busy}
                testID="phone-retry"
              />
            </View>
          )
        ) : (
          <>
            <Action label={t('common.done')} onPress={finish} disabled={leaving} testID="phone-done" />
            {!snapshot.pending && (
              <Action
                label={t('common.runNewCheck')}
                secondary
                onPress={() => activeController.ask('restart')}
                disabled={busy}
                testID="phone-new"
              />
            )}
          </>
        )}
      </>
    );
  }
  function renderPhoneSheet() {
    if (!state.sheet) return null;
    return (
      <View style={styles.scrim}>
        <View style={styles.sheet} accessibilityViewIsModal testID="phone-bottom-sheet">
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              {state.sheet.kind === 'error'
                ? t('common.checkNeedsAttention')
                : state.sheet.kind === 'erase'
                  ? t('phone.sheet.eraseTitle')
                  : t('phone.sheet.restartTitle')}
            </Text>
            <Text style={styles.body}>
              {state.sheet.kind === 'error'
                ? state.sheet.message
                : state.sheet.kind === 'erase'
                  ? t('phone.sheet.eraseBody')
                  : t('phone.sheet.restartBody')}
            </Text>
            {state.sheet.kind !== 'error' && (
              <Action
                label={state.sheet.kind === 'erase' ? t('common.eraseChecks') : t('phone.sheet.startNew')}
                onPress={activeController.confirm}
                disabled={busy}
                testID="phone-confirm"
              />
            )}
            <Action
              label={
                state.sheet.kind === 'error' ? t('phone.sheet.backToCheck') : t('phone.sheet.keepCurrent')
              }
              secondary
              onPress={activeController.dismiss}
              disabled={busy}
            />
            <Action
              label={t('common.backToIdentity')}
              secondary
              onPress={finish}
              disabled={leaving}
              testID="phone-sheet-back"
            />
          </ScrollView>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        accessibilityElementsHidden={!!state.sheet}
        importantForAccessibility={state.sheet ? 'no-hide-descendants' : 'auto'}
      >
        <Text style={styles.eyebrow}>{t('common.eyebrow')}</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {t('phone.title')}
        </Text>
        {renderPhoneStage()}
        {busy && (
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            {t('common.pleaseWait')}
          </Text>
        )}
        {terminal && (
          <Action
            label={t('phone.startNew')}
            onPress={() => activeController.ask('restart')}
            disabled={busy}
          />
        )}
        {renderReceipt()}
        <Action
          label={t('common.backToIdentity')}
          secondary
          onPress={finish}
          disabled={leaving}
          testID="phone-back"
        />
        {snapshot && (
          <Action
            label={t('phone.erase')}
            secondary
            onPress={() => activeController.ask('erase')}
            disabled={busy}
            testID="phone-erase"
          />
        )}
      </ScrollView>
      {renderPhoneSheet()}
    </View>
  );
}

export function PhoneResultDetails({ receipt }: { receipt: PhoneCheckReceipt }) {
  const [showReceipt, setShowReceipt] = useState(false);
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
      <Action
        label={showReceipt ? t('phone.result.hideReceipt') : t('phone.result.showReceipt')}
        secondary
        onPress={() => setShowReceipt((value) => !value)}
        testID="phone-receipt-details"
      />
      {showReceipt && (
        <>
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
              <Row
                label={t('phone.result.profileVersion')}
                value={receipt.subscriberComparison.profileVersion}
              />
            </>
          )}
        </>
      )}
    </View>
  );
}
/** Observations are labelled by what they measure. Rows appear only for values a check returned. */
function NumberCheck({ provider, index }: { provider: PhoneProviderObservation; index: number }) {
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
function Row({ label, value }: { label: string; value?: (string | number | boolean | null) | undefined }) {
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
