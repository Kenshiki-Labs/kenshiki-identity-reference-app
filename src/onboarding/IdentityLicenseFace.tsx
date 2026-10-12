import { IdentityCapturePreview } from '@kenshiki/identity-capture';
import { useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  DocumentFaceController,
  type DocumentFaceState,
  type SavedDocumentFace,
} from '../identity/DocumentFaceController';
import type { SavedDocumentCapture } from '../identity/DocumentFlowController';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import {
  ControllerCustodyContext,
  createControllerCustody,
  type IdentityCustody,
} from '../ui/ControllerCustody';
import { ControllerStartup } from '../ui/ControllerStartup';
import { connectBackground } from '../ui/connectBackground';
import { LoadingCard } from '../ui/LoadingCard';
import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';
import { styles } from '../ui/styles';
import { useControllerState } from '../ui/useControllerState';

const initial: DocumentFaceState = {
  phase: 'intro',
  busy: false,
  ready: false,
  preview: 0,
  snapshot: undefined,
  failure: undefined,
};

/** The native license owner supplies the portrait, camera and comparison; React shows status only. */
export function IdentityLicenseFace({
  saved,
  documentOperationID,
  onClaim,
  onComplete,
  onExit,
  onContinue,
}: Readonly<{
  saved: SavedDocumentCapture;
  documentOperationID: string;
  onClaim?: () => void;
  onComplete: (result: SavedDocumentFace) => void;
  onExit: () => void;
  onContinue?: (value: SavedDocumentFace) => boolean;
}>) {
  const [entry] = useState({ saved, documentOperationID });
  const live = useRef(false);
  const settling = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const shared = useContext(ControllerCustodyContext);
  const custody = useMemo(() => shared ?? createControllerCustody(), [shared]);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const connect = useCallback(
    (publish: (state: DocumentFaceState) => void) => {
      const controller = new DocumentFaceController(entry.saved, publish, entry.documentOperationID);
      onClaim?.();
      controller.open().catch(controller.fail);
      return connectBackground(controller);
    },
    [entry, onClaim],
  );
  const { controller, state, failed, cancelStartup } = useControllerState(initial, connect);
  const acceptContinuation = (result: SavedDocumentFace) =>
    live.current &&
    result.snapshot?.state === 'completed' &&
    result.snapshot.result.outcome === 'pass' &&
    onContinue?.(result) === true;
  async function close(advance = false) {
    if (!controller || settling.current) return false;
    settling.current = true;
    setLeaving(true);
    try {
      const result = await controller.handoff(advance ? acceptContinuation : undefined);
      if (advance) return true;
      if (!live.current) {
        releaseLateFace(custody, result);
        return false;
      }
      onComplete(result);
      return true;
    } catch (error) {
      if (!live.current) return false;
      settling.current = false;
      setLeaving(false);
      controller.fail(error);
      return false;
    }
  }
  const lead = <FaceLead state={state} />;
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
    <Page title={t('onboarding.title')} lead={lead} onClose={() => close()} testID="onboarding-license-face">
      <FaceContent state={state} controller={controller} saved={entry.saved} leaving={leaving} />
      {onContinue &&
        !state.failure &&
        !state.busy &&
        state.snapshot?.state === 'completed' &&
        state.snapshot.result.outcome === 'pass' && (
          <Action
            label={t('onboarding.choose.continue')}
            testID="onboarding-face-continue"
            disabled={leaving}
            onPress={() => close(true)}
          />
        )}
    </Page>
  );
}

const faceOutcomeCopy = {
  pass: { title: 'onboarding.faceStep.passTitle', description: 'onboarding.faceStep.passDescription' },
  fail: { title: 'onboarding.faceStep.failTitle', description: 'onboarding.faceStep.failDescription' },
  manual_review: {
    title: 'onboarding.faceStep.reviewTitle',
    description: 'onboarding.faceStep.reviewDescription',
  },
} as const;

function FaceLead({ state }: Readonly<{ state: DocumentFaceState }>) {
  let title = t('onboarding.faceStep.title');
  let description = t('onboarding.faceStep.description');
  if (!state.failure && state.phase === 'selfie') {
    title = t('onboarding.faceStep.selfieTitle');
    description = t('onboarding.faceStep.selfieDescription');
  } else if (!state.failure && state.phase === 'comparing') {
    title = t('onboarding.faceStep.comparingTitle');
    description = t('onboarding.faceStep.comparingDescription');
  } else if (!state.failure && state.snapshot?.state === 'completed' && !state.busy) {
    const outcome = state.snapshot.result.outcome;
    title = t(faceOutcomeCopy[outcome].title);
    description = t(faceOutcomeCopy[outcome].description);
  }
  return (
    <>
      <Text style={styles.eyebrow}>{t('onboarding.faceStep.step')}</Text>
      <PageLead title={title} description={description} />
    </>
  );
}

function FaceContent({
  state,
  controller,
  saved,
  leaving,
}: Readonly<{
  state: DocumentFaceState;
  controller: DocumentFaceController;
  saved: SavedDocumentCapture;
  leaving: boolean;
}>) {
  const busy = state.busy || leaving;
  if (state.failure)
    return (
      <>
        <Text accessibilityRole="alert" style={styles.body} testID="onboarding-face-failure">
          {t('onboarding.faceStep.failure')}
        </Text>
        {state.failure.code === 'resultSaveFailed' ? (
          <>
            <Text style={styles.body}>{t('onboarding.faceStep.saving')}</Text>
            <Action
              label={t('common.saveResult')}
              onPress={controller.retrySave}
              disabled={busy}
              testID="onboarding-face-save"
            />
          </>
        ) : (
          <Action
            label={t('common.tryAgain')}
            onPress={controller.start}
            disabled={busy}
            testID="onboarding-face-retry"
          />
        )}
      </>
    );
  if (state.phase === 'selfie')
    return (
      <>
        <View style={styles.camera}>
          <IdentityCapturePreview
            key={state.preview}
            session={saved.session}
            kind="selfie"
            style={StyleSheet.absoluteFill}
          />
        </View>
        <Action
          label={t('passport.camera.captureSelfie')}
          onPress={controller.capture}
          disabled={busy || !state.ready}
          testID="onboarding-face-capture"
        />
      </>
    );
  if (busy || state.phase === 'preparing' || state.phase === 'comparing')
    return <LoadingCard message={t('common.pleaseWait')} testID="onboarding-face-loading" />;
  if (state.snapshot?.state === 'completed')
    return (
      <View testID={`onboarding-face-${state.snapshot.result.outcome}`}>
        {state.snapshot.result.outcome !== 'pass' && (
          <Action label={t('common.tryAgain')} onPress={controller.start} testID="onboarding-face-retry" />
        )}
      </View>
    );
  return (
    <>
      <Text style={styles.body}>{t('onboarding.faceStep.prepare')}</Text>
      <Action
        label={t('onboarding.faceStep.start')}
        onPress={controller.start}
        testID="onboarding-face-start"
      />
    </>
  );
}

function releaseLateFace(custody: IdentityCustody, result: SavedDocumentFace) {
  custody.releasing = Promise.all([custody.releasing, result.session.release()]);
  custody.releasing.catch(custody.reportFailure);
}
