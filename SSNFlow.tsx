import type { Configuration } from '@kenshiki/identity-capture';
import { IdentityCaptureSession } from '@kenshiki/identity-capture';
import { useCallback, useRef, useState } from 'react';
import { AppState, Keyboard, Text, TextInput, View } from 'react-native';
import { t } from './locales/i18n';
import { type SavedSSNCheck, SSNFlowController, type SSNFlowState } from './SSNFlowController';
import { SSNResultDetails } from './SSNResultDetails';
import { Action } from './ui/Action';
import { ControllerStartup } from './ui/ControllerStartup';
import { LoadingCard } from './ui/LoadingCard';
import { NativeSheet, useConfirmation } from './ui/NativeSheet';
import { Page } from './ui/Page';
import { styles } from './ui/styles';
import { useControllerState } from './ui/useControllerState';

const initialState: SSNFlowState = { digits: '', busy: false, editing: false, opening: true };

export function SSNFlow({
  configuration,
  saved,
  onComplete,
  onExit,
  onClaim,
}: Readonly<{
  configuration: Configuration;
  saved?: SavedSSNCheck | undefined;
  onComplete: (value: SavedSSNCheck) => void;
  onExit: () => void;
  onClaim?: (() => void) | undefined;
}>) {
  const [finishing, setFinishing] = useState(false);
  // Bumped only when what was typed held something other than digits, so the entry restarts from
  // what the controller kept (see the entry below).
  const [entryGeneration, setEntryGeneration] = useState(0);
  const finishingRef = useRef(false);
  const connect = useCallback(
    (publish: (state: SSNFlowState) => void) => {
      const active = new SSNFlowController(IdentityCaptureSession.create, configuration, publish, saved);
      onClaim?.();
      active.open().catch(active.fail);
      const subscription = AppState.addEventListener('change', (next) => {
        if (next !== 'active') {
          Keyboard.dismiss();
          active.pause().catch(active.fail);
        }
      });
      return {
        controller: active,
        initialState: active.state,
        dispose: () => {
          subscription.remove();
          return active.dispose();
        },
      };
    },
    [configuration, saved, onClaim],
  );
  const { controller, state, failed, cancelStartup } = useControllerState(initialState, connect);
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
  const dismiss = () => finish().catch((error: unknown) => controller?.fail(error));
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
  if (!controller)
    return (
      <ControllerStartup
        title={t('common.socialSecurityNumber')}
        onClose={onExit}
        failed={failed}
        cancelStartup={cancelStartup}
        loadingMessage={t('ssn.loading')}
      />
    );
  const activeController = controller;
  const busy = state.busy || finishing;
  const snapshot = state.opening ? undefined : state.snapshot;
  const receipt = snapshot?.receipt;
  const needsRecovery = snapshot?.recoveryNeeded;
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
    if (state.opening) return <LoadingCard message={t('ssn.loading')} testID="ssn-loading" />;
    if (busy) {
      if (receipt && !state.editing && !needsRecovery) return null;
      return (
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          {t('ssn.checking')}
        </Text>
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
        </View>
      );
    }
    if (confirmation) {
      return (
        <View style={styles.card} testID="ssn-confirmation">
          <Text style={styles.body}>{t('ssn.confirm.body')}</Text>
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
        </View>
      );
    }
    if (state.editing) {
      return (
        <>
          <Text style={styles.label}>{t('common.socialSecurityNumber')}</Text>
          <SSNEntry
            key={entryGeneration}
            initialDigits={state.digits}
            autoFocus={entryGeneration > 0}
            onChangeText={(typed) => {
              activeController.setDigits(typed);
              if (!/^\d*$/.test(typed)) setEntryGeneration((generation) => generation + 1);
            }}
            editable={!busy}
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
    if (!receipt && snapshot) {
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
    if (!recovery) return null;
    return (
      <NativeSheet title={recovery.title} testID="ssn-bottom-sheet">
        {renderSheetActions()}
        {close}
      </NativeSheet>
    );
  }
  function renderSheetActions() {
    if (!state.sheet) return null;
    if (recovery) {
      return (
        <>
          <Text style={styles.body}>{recovery.message}</Text>
          {recovery.recovery !== 'exit' && (
            <Action
              label={recoveryLabel()}
              testID="ssn-retry"
              onPress={activeController.retry}
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
    return t('common.tryAgain');
  }
  return (
    <Page
      title={t('common.socialSecurityNumber')}
      onClose={dismiss}
      covered={!!recovery || state.sheet?.kind === 'erase'}
      overlay={renderSSNSheet()}
    >
      {state.editing && !confirmation && <Text style={styles.body}>{t('ssn.intro')}</Text>}
      {renderSSNStage()}
      {receipt && !state.editing && !confirmation && (
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
      {snapshot?.receipt && !state.editing && !confirmation && (
        <Action
          label={t('ssn.erase')}
          destructive
          testID="ssn-erase"
          onPress={activeController.askErase}
          disabled={busy}
        />
      )}
    </Page>
  );
}

/** React Native forwards defaultValue as native text on every render. Keep the seed fixed
 * for this mounted entry so delayed JavaScript updates cannot rewrite newer native keystrokes.
 * A sanitized paste explicitly remounts it; ordinary edits are owned by the native field. */
function SSNEntry({
  initialDigits,
  autoFocus,
  editable,
  onChangeText,
}: Readonly<{
  initialDigits: string;
  autoFocus: boolean;
  editable: boolean;
  onChangeText: (text: string) => void;
}>) {
  const [seed] = useState(initialDigits);
  return (
    <TextInput
      testID="ssn-entry"
      accessibilityLabel={t('common.socialSecurityNumber')}
      keyboardType="number-pad"
      autoCorrect={false}
      autoCapitalize="none"
      autoComplete="off"
      importantForAutofill="no"
      autoFocus={autoFocus}
      maxLength={9}
      defaultValue={seed}
      onChangeText={onChangeText}
      editable={editable}
      placeholder={t('ssn.placeholder')}
      style={[styles.card, styles.entry]}
    />
  );
}

function formatNumber(digits: string): string {
  return [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5, 9)].filter(Boolean).join('-');
}
