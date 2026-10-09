import type { Configuration, SSNVerificationReceipt } from '@kenshiki/identity-capture';
import { IdentityCaptureSession } from '@kenshiki/identity-capture';
import { useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, ScrollView, Text, TextInput, View } from 'react-native';
import { formatCalendarDate, formatMoment } from './HolderText';
import { Action, styles } from './IdentityCaptureFlow';
import { t } from './locales/i18n';
import { type SavedSSNCheck, SSNFlowController, type SSNFlowState } from './SSNFlowController';
import { type CancelHandle, useCancel } from './ui/ModalCancel';
import { NativeSheet, useConfirmation } from './ui/NativeSheet';

export function SSNFlow({
  configuration,
  saved,
  onComplete,
  onExit,
  cancelRef,
}: {
  configuration: Configuration;
  saved?: SavedSSNCheck | undefined;
  onComplete: (value: SavedSSNCheck) => void;
  onExit: () => void;
  /** Filled in with this check's own way out, for the navigation bar's Cancel button. */
  cancelRef?: CancelHandle | undefined;
}) {
  const [controller, setController] = useState<SSNFlowController>();
  const [state, setState] = useState<SSNFlowState>({ digits: '', busy: false, editing: false });
  const [finishing, setFinishing] = useState(false);
  // Bumped only when what was typed held something other than digits, so the entry restarts from
  // what the controller kept (see the entry below).
  const [entryGeneration, setEntryGeneration] = useState(0);
  const finishingRef = useRef(false);
  useEffect(() => {
    const active = new SSNFlowController(IdentityCaptureSession.create, configuration, setState, saved);
    setController(active);
    setState(active.state);
    active.open().catch(active.fail);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        Keyboard.dismiss();
        active.pause().catch(active.fail);
      }
    });
    return () => {
      subscription.remove();
      active.dispose().catch(active.fail);
    };
  }, [configuration, saved]);
  const finish = async () => {
    if (!controller || finishingRef.current) return;
    Keyboard.dismiss();
    finishingRef.current = true;
    setFinishing(true);
    try {
      const result = await controller.handoff();
      if (result) onComplete(result);
      else onExit();
    } catch (error) {
      // Ownership stays here; the failure is shown in this screen's sheet.
      finishingRef.current = false;
      setFinishing(false);
      if (!controller.state.sheet) controller.fail(error);
    }
  };
  useCancel(cancelRef, finish, (error) => controller?.fail(error));
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
  if (!controller) return <View style={styles.root} />;
  const activeController = controller;
  const busy = state.busy || finishing;
  const snapshot = state.snapshot;
  const receipt = snapshot?.receipt;
  const needsRecovery = snapshot?.recoveryNeeded;
  const saving = snapshot?.state === 'finishing';
  const confirmation = snapshot?.confirmation;
  const close = (
    <Action
      label={t('common.backToIdentity')}
      secondary
      testID="ssn-back-to-identity"
      onPress={finish}
      disabled={finishing}
    />
  );
  const recovery = state.sheet?.kind === 'recovery' ? state.sheet : undefined;
  function renderSSNStage() {
    if (busy) {
      return (
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          {t('ssn.checking')}
        </Text>
      );
    }
    if (saving) {
      return (
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {t('common.saveYourResult')}
          </Text>
          <Text style={styles.body}>{t('ssn.saveBody')}</Text>
          <Action
            label={t('common.saveResult')}
            testID="ssn-save-result"
            onPress={activeController.recover}
          />
        </View>
      );
    }
    if (needsRecovery && !state.editing) {
      return (
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {t('ssn.notReceivedTitle')}
          </Text>
          <Text style={styles.body}>{t('ssn.notReceivedBody')}</Text>
          <Action label={t('ssn.resend')} testID="ssn-resend-unresolved" onPress={activeController.resend} />
          <Action
            label={t('ssn.enterAgain')}
            testID="ssn-new-attempt"
            onPress={activeController.beginEntry}
          />
        </View>
      );
    }
    if (state.editing) {
      return (
        <>
          <Text style={styles.label}>{t('common.socialSecurityNumber')}</Text>
          {/* Uncontrolled (S-12): the field owns what is typed and JavaScript only reads it. A
              controlled `value` lets a render that lags fast typing push older text back into the
              field, which moves the caret: 000001234 became 000123400. Input that is not only
              digits restarts the field from the digits the controller kept. */}
          <TextInput
            key={entryGeneration}
            testID="ssn-entry"
            accessibilityLabel={t('common.socialSecurityNumber')}
            keyboardType="number-pad"
            autoCorrect={false}
            autoCapitalize="none"
            autoComplete="off"
            importantForAutofill="no"
            autoFocus={entryGeneration > 0}
            maxLength={9}
            defaultValue={state.digits}
            onChangeText={(typed) => {
              activeController.setDigits(typed);
              if (!/^\d*$/.test(typed)) setEntryGeneration((generation) => generation + 1);
            }}
            editable={!busy}
            placeholder={t('ssn.placeholder')}
            style={[styles.card, styles.entry]}
          />
          <Text style={styles.body}>{t('ssn.entryNotice')}</Text>
          <Action
            label={t('ssn.reviewNumber')}
            testID="ssn-review-number"
            disabled={busy || state.digits.length !== 9}
            onPress={() => {
              Keyboard.dismiss();
              activeController.requestConfirmation().catch(activeController.fail);
            }}
          />
        </>
      );
    }
    if (!receipt) {
      return (
        <Action
          label={t('ssn.enter')}
          testID="ssn-begin-entry"
          onPress={activeController.beginEntry}
          disabled={busy || !snapshot}
        />
      );
    }
    return null;
  }
  function renderSSNSheet() {
    if (!state.sheet || state.sheet.kind === 'erase') return null;
    return (
      <NativeSheet testID="ssn-bottom-sheet">
        {renderSheetActions()}
        {close}
      </NativeSheet>
    );
  }
  function renderSheetActions() {
    if (!state.sheet) return null;
    if (state.sheet.kind === 'confirmation' && confirmation) {
      return (
        <>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {t('ssn.confirm.title')}
          </Text>
          <Text style={styles.body}>{t('ssn.confirm.body')}</Text>
          {confirmation.purpose === 'replacementAfterUnknownOutcome' && (
            <Text style={styles.body} testID="ssn-replacement-warning">
              {t('ssn.confirm.replacement')}
            </Text>
          )}
          <Text style={styles.title} testID="ssn-confirmation-number">
            {formatNumber(confirmation.digits)}
          </Text>
          <Action
            label={t('ssn.confirm.action')}
            testID="ssn-confirm"
            onPress={activeController.confirm}
            disabled={busy}
          />
          <Action
            label={t('ssn.confirm.edit')}
            testID="ssn-edit"
            secondary
            onPress={activeController.edit}
            disabled={busy}
          />
        </>
      );
    }
    if (recovery) {
      return (
        <>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {recovery.title}
          </Text>
          <Text style={styles.body}>{recovery.message}</Text>
          {recovery.recovery !== 'exit' && (
            <Action
              label={recoveryLabel()}
              testID="ssn-retry"
              onPress={activeController.retry}
              disabled={busy}
            />
          )}
          {recovery.recovery === 'resend' && (
            <Action
              label={t('ssn.enterAgain')}
              testID="ssn-new-attempt"
              secondary
              onPress={activeController.beginEntry}
              disabled={busy}
            />
          )}
        </>
      );
    }
    return null;
  }
  function recoveryLabel() {
    if (!recovery) return t('common.tryAgain');
    if (recovery.recovery === 'resend') return t('ssn.resend');
    if (recovery.recovery === 'localSave') {
      return t('common.saveResult');
    }
    if (recovery.recovery === 'fresh') {
      return t('ssn.enterAgain');
    }
    return t('common.tryAgain');
  }
  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        accessibilityElementsHidden={!!state.sheet}
        importantForAccessibility={state.sheet ? 'no-hide-descendants' : 'auto'}
      >
        <Text style={styles.body}>{t('ssn.intro')}</Text>
        {renderSSNStage()}
        {receipt && (
          <>
            {needsRecovery && <Text style={styles.eyebrow}>{t('common.previousCheck')}</Text>}
            <SSNResultDetails receipt={receipt} />
            {!needsRecovery && !state.editing && (
              <>
                <Action label={t('common.done')} testID="finish-ssn" onPress={finish} disabled={busy} />
                <Action
                  label={t('common.runNewCheck')}
                  secondary
                  testID="ssn-check-again"
                  onPress={activeController.edit}
                  disabled={busy}
                />
              </>
            )}
          </>
        )}
        {snapshot && (
          <Action
            label={t('ssn.erase')}
            destructive
            testID="ssn-erase"
            onPress={activeController.askErase}
            disabled={busy}
          />
        )}
      </ScrollView>
      {renderSSNSheet()}
    </View>
  );
}

/** States what the checking service reported. Issuance is never presented as verification. */
export function ssnSummary(receipt: SSNVerificationReceipt): string {
  return receipt.issuance === 'issued'
    ? t('ssn.summary.issued')
    : receipt.issuance === 'notIssued'
      ? t('ssn.summary.notIssued')
      : t('ssn.summary.unavailable');
}
export function SSNResultDetails({ receipt }: { receipt: SSNVerificationReceipt }) {
  const details = receipt.details;
  const reported = (value?: string | null) => value?.trim() || t('common.notReturned');
  return (
    <View style={styles.card} testID="ssn-result">
      <Text accessibilityRole="header" style={styles.sheetTitle}>
        {ssnSummary(receipt)}
      </Text>
      <ResultRow
        label={t('ssn.result.reportedLabel')}
        value={
          receipt.issuance === 'issued'
            ? t('ssn.result.issued')
            : receipt.issuance === 'notIssued'
              ? t('ssn.result.notIssued')
              : t('ssn.result.unavailable')
        }
      />
      {details ? (
        <>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {t('ssn.result.findings')}
          </Text>
          <ResultRow label={t('ssn.result.region')} value={reported(details.region)} />
          <ResultRow
            label={t('ssn.result.issueStart')}
            value={details.issueStart ? formatCalendarDate(details.issueStart) : t('common.notReturned')}
          />
          <ResultRow
            label={t('ssn.result.issueEnd')}
            value={details.issueEnd ? formatCalendarDate(details.issueEnd) : t('common.notReturned')}
          />
          <ResultRow label={t('ssn.result.classification')} value={reported(details.codeDescription)} />
          <ResultRow label={t('ssn.result.classificationCode')} value={reported(details.code)} />
          <ResultRow label={t('ssn.result.reportedStatus')} value={reported(details.reportedStatus)} />
          <ResultRow
            label={t('ssn.result.responseCode')}
            value={details.responseCode == null ? t('common.notReturned') : String(details.responseCode)}
          />
        </>
      ) : (
        <Text style={styles.body}>{t('ssn.result.issuanceOnly')}</Text>
      )}
      <ResultRow label={t('ssn.result.checked')} value={formatMoment(receipt.checkedAt)} />
      <Text style={styles.body}>{t('ssn.result.ownership')}</Text>
    </View>
  );
}
function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.body}>{value}</Text>
    </View>
  );
}
export function formatNumber(digits: string): string {
  return [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5, 9)].filter(Boolean).join('-');
}
