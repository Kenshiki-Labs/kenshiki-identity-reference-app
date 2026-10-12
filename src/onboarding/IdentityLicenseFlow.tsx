import type { DocumentCheckSnapshot } from '@kenshiki/identity-capture';
import {
  type ComponentProps,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Text } from 'react-native';
import { DocumentCheckContent } from '../identity/DocumentCheckPanel';
import { documentCheckAction } from '../identity/DocumentCheckRecovery';
import { isCompleteDocument, type SavedDocumentCapture } from '../identity/DocumentFlowController';
import { DocumentResultDetails } from '../identity/DocumentResultDetails';
import { DriverLicenseFlow } from '../identity/DriverLicenseFlow';
import { documentRecordAccepted } from '../app/IdentityPrerequisites';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import {
  ControllerCustodyContext,
  createControllerCustody,
  type IdentityCustody,
} from '../ui/ControllerCustody';
import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';
import { styles } from '../ui/styles';
import { useDocumentCheck } from '../identity/useDocumentCheck';

type Props = ComponentProps<typeof DriverLicenseFlow> & {
  onContinue?: (saved: SavedDocumentCapture, checked: DocumentCheckSnapshot) => boolean;
};

/** Guided orchestration only. The existing capture and check controllers own all SDK commands. */
export function IdentityLicenseFlow(props: Props) {
  const shared = useContext(ControllerCustodyContext);
  const custody = useMemo(() => shared ?? createControllerCustody(), [shared]);
  const active = useRef(false);
  const owned = useRef<SavedDocumentCapture | undefined>(undefined);
  const [review, setReview] = useState<SavedDocumentCapture>();
  const [capture, setCapture] = useState({ saved: props.saved, resume: props.resume });
  const release = useCallback(
    (saved: SavedDocumentCapture) => releaseGuidedSession(custody, saved),
    [custody],
  );
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      const saved = owned.current;
      owned.current = undefined;
      if (saved) release(saved);
    };
  }, [release]);
  const { onClaim } = props;
  const claim = useCallback(() => {
    owned.current = undefined;
    onClaim?.();
  }, [onClaim]);
  function captured(saved: SavedDocumentCapture) {
    if (!active.current) {
      release(saved);
      return;
    }
    owned.current = saved;
    // Cancellation can hand back a partial draft or the previous completed document.
    // Neither is proof that this explicit capture attempt completed both sides.
    const previous = capture.saved?.document.front;
    const unchanged =
      capture.resume === 'front' &&
      previous &&
      previous.captureID === saved.document.front?.captureID &&
      previous.sha256 === saved.document.front?.sha256;
    if (!isCompleteDocument(saved.document) || unchanged) {
      owned.current = undefined;
      props.onComplete(saved);
      return;
    }
    setReview(saved);
  }
  function handoff(saved: SavedDocumentCapture) {
    if (!active.current || owned.current !== saved) return;
    owned.current = undefined;
    props.onComplete(saved);
  }
  function retake(saved: SavedDocumentCapture) {
    if (!active.current || owned.current !== saved) return;
    // Keep pending ownership until the capture controller claims it after commit.
    setCapture({ saved, resume: 'front' });
    setReview(undefined);
  }
  if (!review) return <DriverLicenseFlow {...props} {...capture} onComplete={captured} onClaim={claim} />;
  return (
    <LicenseReview
      saved={review}
      configured={!!props.configuration.document?.check}
      onClose={() => handoff(review)}
      onRetake={() => retake(review)}
      {...(props.onContinue
        ? {
            onContinue: (checked: DocumentCheckSnapshot) => {
              if (!active.current || owned.current !== review || !props.onContinue?.(review, checked))
                return false;
              owned.current = undefined;
              return true;
            },
          }
        : {})}
    />
  );
}

function LicenseReview({
  saved,
  configured,
  onClose,
  onRetake,
  onContinue,
}: Readonly<{
  saved: SavedDocumentCapture;
  configured: boolean;
  onClose: () => void;
  onRetake: () => void;
  onContinue?: (checked: DocumentCheckSnapshot) => boolean;
}>) {
  const connection = { session: saved.session, configured, document: saved.document };
  const check = useDocumentCheck(connection);
  const settling = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [settlementFailed, setSettlementFailed] = useState(false);
  const live = useRef(false);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function settle(next: () => unknown) {
    if (settling.current || !check.controller) return;
    settling.current = true;
    setLeaving(true);
    setSettlementFailed(false);
    let cancelFailed = false;
    if (configured) await check.controller.pause();
    else {
      try {
        await saved.session.cancel();
      } catch (error) {
        cancelFailed = true;
        check.controller.fail(error);
      }
    }
    if (!live.current) return;
    if (cancelFailed || (configured && (check.controller.state.failure || check.controller.state.busy))) {
      settling.current = false;
      setLeaving(false);
      setSettlementFailed(true);
      return;
    }
    if (next() === false) {
      settling.current = false;
      setLeaving(false);
      setSettlementFailed(true);
    }
  }
  const { state } = check;
  const accepted =
    configured &&
    !state.busy &&
    !state.failure &&
    !settlementFailed &&
    isCompleteDocument(saved.document) &&
    documentRecordAccepted(saved.document, state.snapshot);
  const unreadable = state.snapshot?.state === 'unreadable';
  const stage = licenseReviewStage(state.busy, accepted, unreadable);
  const retake = () => settle(onRetake);
  const continueToPhone = () => {
    if (!accepted || !onContinue) return;
    const operationID = state.snapshot?.result?.operationID;
    return settle(() => {
      const restored = check.controller?.state.snapshot;
      if (
        !restored ||
        !documentRecordAccepted(saved.document, restored) ||
        restored.result?.operationID !== operationID
      )
        return false;
      return onContinue(restored);
    });
  };
  return (
    <Page
      title={t('onboarding.title')}
      testID="onboarding-license-review"
      onClose={() => settle(onClose)}
      lead={
        <>
          <Text style={styles.eyebrow}>{t('onboarding.preparation.license.step')}</Text>
          <PageLead
            title={t(`onboarding.license.${stage}.title`)}
            description={t(`onboarding.license.${stage}.description`)}
          />
        </>
      }
    >
      {accepted && (
        <Text testID="onboarding-license-accepted" accessibilityLiveRegion="polite" style={styles.body}>
          {t('onboarding.license.next')}
        </Text>
      )}
      {accepted && onContinue && (
        <Action
          label={t('onboarding.choose.continue')}
          testID="onboarding-license-continue"
          disabled={leaving}
          onPress={continueToPhone}
        />
      )}
      {settlementFailed && (
        <Text accessibilityRole="alert" style={styles.body}>
          {t('common.sessionRecovery')}
        </Text>
      )}
      <DocumentCheckContent {...connection} check={check} onRetake={retake} />
      <DocumentResultDetails result={saved} disabled={state.busy || leaving} />
      {documentCheckAction(state.snapshot) !== 'retake' && (
        <Action
          label={t('license.retake')}
          testID="onboarding-license-retake"
          secondary
          disabled={state.busy || leaving}
          onPress={retake}
        />
      )}
    </Page>
  );
}

/** Attach release to the same holder barrier used by every capture controller. */
function releaseGuidedSession(custody: IdentityCustody, saved: SavedDocumentCapture) {
  custody.releasing = Promise.all([custody.releasing, saved.session.release()]);
  custody.releasing.catch(custody.reportFailure);
}

function licenseReviewStage(busy: boolean, accepted: boolean, unreadable: boolean) {
  if (busy) return 'checking';
  if (accepted) return 'matched';
  if (unreadable) return 'unreadable';
  return 'review';
}
