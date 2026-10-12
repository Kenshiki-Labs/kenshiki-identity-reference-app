import type { Configuration } from '@kenshiki/identity-capture';
import {
  IdentityCaptureImage,
  IdentityCapturePreview,
  IdentityCaptureSession,
} from '@kenshiki/identity-capture';
import { useCallback, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import {
  DocumentFlowController,
  type DocumentFlowState,
  type SavedDocumentCapture,
} from './DocumentFlowController';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import { ControllerStartup } from '../ui/ControllerStartup';
import { connectBackground } from '../ui/connectBackground';
import { ListSection, TextRow } from '../ui/List';
import { NativeSheet } from '../ui/NativeSheet';
import { Page } from '../ui/Page';
import { styles } from '../ui/styles';
import { useCaptureHandoff } from '../ui/useCaptureHandoff';
import { useControllerState } from '../ui/useControllerState';

const initialState: DocumentFlowState = {
  phase: 'loading',
  busy: false,
  capturing: false,
  ready: false,
  preview: 0,
  saved: [],
};

export function DriverLicenseFlow({
  configuration,
  saved,
  resume,
  onComplete,
  onExit,
  onClaim,
}: Readonly<{
  configuration: Configuration;
  saved?: SavedDocumentCapture | undefined;
  resume?: ('front' | 'back') | undefined;
  onComplete: (result: SavedDocumentCapture) => void;
  onExit: () => void;
  onClaim?: (() => void) | undefined;
}>) {
  const [finishing, setFinishing] = useState(false);
  const [releaseFailed, setReleaseFailed] = useState(false);
  const finishingRef = useRef(false);
  const connect = useCallback(
    (publish: (state: DocumentFlowState) => void) => {
      const active = new DocumentFlowController(IdentityCaptureSession.create, configuration, publish, saved);
      onClaim?.();
      if (resume === 'front') active.startFront().catch(active.fail);
      else if (resume === 'back') active.startBack().catch(active.fail);
      else active.open().catch(active.fail);
      return connectBackground(active);
    },
    [configuration, saved, resume, onClaim],
  );
  const { controller, state, failed, cancelStartup } = useControllerState(initialState, connect);
  const finish = async () => {
    if (!controller || finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    try {
      const result = await controller.handoff();
      if (result) onComplete(result);
      else onExit();
    } catch (error) {
      // Ownership stays here; the failed settlement is shown in this screen's bottom sheet.
      finishingRef.current = false;
      setFinishing(false);
      if (!controller.state.sheet) controller.fail(error);
    }
  };
  useCaptureHandoff(
    state.completed,
    state.phase === 'result' && !state.busy && !state.sheet,
    finish,
    (error) => controller?.fail(error),
  );
  const exit = async () => {
    if (!controller || finishingRef.current) return;
    if (state.completed || state.draft?.front) {
      await finish();
      return;
    }
    finishingRef.current = true;
    setFinishing(true);
    try {
      await controller.dispose();
    } catch {
      // Disposal has fenced this controller. Preserve failed custody and explain recovery;
      // neither another capture nor a second release is safe from this closed controller.
      setReleaseFailed(true);
      return;
    }
    onExit();
  };
  const dismiss = () => exit().catch((error: unknown) => controller?.fail(error));
  if (!controller)
    return (
      <ControllerStartup
        title={t('license.title.default')}
        onClose={onExit}
        failed={failed}
        cancelStartup={cancelStartup}
      />
    );
  const activeController = controller;
  const camera = state.phase === 'front' || state.phase === 'back';
  const action = (label: string, press: () => unknown, id?: string, secondary = false, disabled = false) => (
    <Action
      label={label}
      onPress={press}
      testID={id}
      secondary={secondary}
      disabled={state.busy || finishing || disabled}
    />
  );
  const close = (
    <Action
      label={t('common.backToIdentity')}
      secondary
      testID="document-back-to-identity"
      disabled={finishing}
      onPress={exit}
    />
  );
  const title =
    state.phase === 'front'
      ? t('license.title.front')
      : state.phase === 'back'
        ? t('license.title.back')
        : state.phase === 'frontReview'
          ? t('license.title.frontReview')
          : state.phase === 'result'
            ? t('license.title.result')
            : state.phase === 'saved'
              ? t('license.title.saved')
              : t('license.title.default');
  function renderCaptureStage() {
    if (camera) {
      return (
        <View style={styles.camera}>
          {state.session && (
            <IdentityCapturePreview
              key={`document-${state.preview}`}
              session={state.session}
              kind="document"
              style={StyleSheet.absoluteFill}
            />
          )}
          <View style={styles.cameraTop}>
            <Text style={[styles.eyebrow, styles.white]}>
              {t('license.step', { step: state.phase === 'front' ? 1 : 2, total: 2 })}
            </Text>
            <Text style={[styles.body, styles.white]}>{t('license.cameraHint')}</Text>
          </View>
          <View style={styles.cameraBottom}>
            <Text style={[styles.body, styles.white]} accessibilityLiveRegion="polite">
              {documentHint(state)}
            </Text>
            {action(
              state.phase === 'front' ? t('license.captureFront') : t('license.captureBack'),
              activeController.capture,
              'capture-document',
              false,
              !state.ready || state.capturing,
            )}
          </View>
        </View>
      );
    }
    return (
      <>
        {state.phase === 'loading' && (
          <Text style={styles.body} accessibilityLiveRegion="polite">
            {t('license.loading')}
          </Text>
        )}
        {state.phase === 'intro' && (
          <>
            <Text style={styles.body}>{t('license.intro.body')}</Text>
            <Text style={styles.body}>{t('license.intro.privacy')}</Text>
            {action(t('license.intro.start'), activeController.startFront, 'start-document-front')}
          </>
        )}
        {renderSavedDocuments()}
        {state.phase === 'frontReview' && state.draft?.front && state.session && (
          <>
            <Text style={styles.eyebrow}>{t('license.stepComplete', { step: 1, total: 2 })}</Text>
            <IdentityCaptureImage
              session={state.session}
              image="documentFront"
              sha256={state.draft.front.sha256}
              accessibilityLabel={t('license.result.frontImage')}
              style={styles.documentPreview}
            />
            <Text style={styles.body}>{t('license.frontReview.body')}</Text>
            {action(t('license.frontReview.scanBack'), activeController.startBack, 'start-document-back')}
            {action(
              t('license.frontReview.retakeFront'),
              activeController.startFront,
              'retake-document-front',
              true,
            )}
          </>
        )}
        {state.busy && state.phase !== 'loading' && (
          <Text style={styles.body} accessibilityLiveRegion="polite">
            {t('common.pleaseWait')}
          </Text>
        )}
      </>
    );
  }
  function renderRecovery() {
    if (releaseFailed)
      return (
        <NativeSheet title={t('common.checkNeedsAttention')} testID="document-release-failure">
          <Text accessibilityRole="alert" style={styles.body}>
            {t('common.sessionRecovery')}
          </Text>
        </NativeSheet>
      );
    if (!state.sheet) return null;
    return (
      <NativeSheet title={state.sheet.title} testID="document-bottom-sheet">
        <Text style={styles.body}>{state.sheet.message}</Text>
        {state.sheet.recovery === 'details' ? (
          close
        ) : (
          <>
            {state.sheet.recovery === 'settings' &&
              action(t('common.openSettings'), () => Linking.openSettings(), 'document-open-settings')}
            {action(
              state.sheet.recovery === 'settings' ? t('common.tryCameraAgain') : t('common.tryAgain'),
              activeController.retry,
              'retry-document',
            )}
            {close}
          </>
        )}
      </NativeSheet>
    );
  }
  function renderSavedDocuments() {
    if (!(state.phase === 'saved')) return null;
    return (
      <View style={styles.list} testID="saved-documents-list">
        <ListSection>
          <TextRow text={t('license.saved.choose')} />
        </ListSection>
        {state.saved.map((choice, index) => (
          <ListSection key={choice.workflowID} header={t('license.saved.title', { number: index + 1 })}>
            <TextRow text={choice.hasBack ? t('license.saved.complete') : t('license.saved.frontOnly')} />
            <Action
              grouped
              label={choice.hasBack ? t('license.saved.view') : t('license.saved.continue')}
              onPress={() => activeController.recoverSaved(choice.captureID)}
              testID={`saved-document-${index}`}
              disabled={state.busy || finishing}
            />
          </ListSection>
        ))}
        <ListSection>
          <Action
            grouped
            label={t('license.saved.scanAnother')}
            onPress={activeController.startFront}
            testID="start-document-front"
            disabled={state.busy || finishing}
          />
        </ListSection>
      </View>
    );
  }
  return (
    <Page
      title={title}
      mode={camera ? 'camera' : 'scroll'}
      onClose={dismiss}
      covered={releaseFailed || !!state.sheet}
      overlay={renderRecovery()}
    >
      {renderCaptureStage()}
    </Page>
  );
}

function documentHint(state: DocumentFlowState): string {
  if (state.capturing) return t('license.hint.capturing');
  if (state.ready) return t('license.hint.ready');
  const hints: Record<string, string> = {
    consentRequired: t('license.hint.consentRequired'),
    locationRequired: t('license.hint.locationRequired'),
    captureFailed: t('license.hint.captureFailed'),
    cameraUnavailable: t('license.hint.cameraUnavailable'),
    nativeControlsPaused: t('license.hint.nativeControlsPaused'),
  };
  return hints[state.issue ?? ''] ?? t('license.hint.other');
}
