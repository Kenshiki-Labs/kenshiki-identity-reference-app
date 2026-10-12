import {
  type CaptureSession,
  type Configuration,
  type DocumentCheckSnapshot,
  type EnvironmentCheckSnapshot,
  IdentityCaptureSession,
} from '@kenshiki/identity-capture';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CaptureFlowController, type CompletedCapture } from '../identity/CaptureFlowController';
import type { DocumentCheckPort, DocumentCheckState } from '../identity/DocumentCheckController';
import type { SavedDocumentFace } from '../identity/DocumentFaceController';
import {
  DocumentFlowController,
  isCompleteDocument,
  type SavedDocumentCapture,
} from '../identity/DocumentFlowController';
import type { SavedEnvironmentCheck } from '../onboarding/EnvironmentCheckController';
import { type ErrorText, errorCode, errorText } from './HolderText';
import { documentRecordAccepted, phonePrerequisite, ssnPrerequisite } from './IdentityPrerequisites';
import type { VerificationReview } from '../onboarding/IdentityVerificationDetail';
import { t } from '../locales/i18n';
import { PhoneFlowController, type SavedPhoneCheck } from '../identity/PhoneFlowController';
import { phoneCheckComplete } from '../identity/PhonePolicy';
import type { SavedSSNCheck } from '../identity/SSNFlowController';
import { ssnCheckComplete } from '../identity/SSNPolicy';
import type { IdentityCustody } from '../ui/ControllerCustody';

export type IdentityFlow =
  | 'passport'
  | 'license'
  | 'ssn'
  | 'phone'
  | 'licenseFace'
  | 'environment'
  | 'verificationResult';
type ClearTarget = 'passport' | 'document';
type ClearRequest = { target: ClearTarget; session: CaptureSession | undefined };

const clearErrors: ErrorText = {
  busy: t('hub.clearError.busy'),
  sessionUnavailable: t('hub.clearError.sessionUnavailable'),
  resultsNotConfigured: t('hub.clearError.resultsNotConfigured'),
  resultIntegrityFailure: t('hub.clearError.resultIntegrityFailure'),
  documentCustodyFailed: t('hub.clearError.documentCustodyFailed'),
  storageUnavailable: t('hub.clearError.storageUnavailable'),
};
const restoreErrors: ErrorText = {
  sessionUnavailable: t('hub.restoreError.sessionUnavailable'),
  busy: t('hub.restoreError.busy'),
};

/** Owns one holder's retained sessions. Flow controllers own active checks; this hook receives
 * completed handoffs, restores saved evidence and releases it on holder change or unmount.
 * The stable callbacks describe navigation intent without importing any navigator or view. */
export function useIdentityWorkspace(
  configuration: Configuration,
  onHome: () => void,
  openFlow: (flow: IdentityFlow, guided?: boolean) => void,
  custody: IdentityCustody,
) {
  const [review, setReview] = useState<VerificationReview>();
  const active = useRef(false);
  const retainedReleaseFailed = useRef(false);
  const pending = useRef<Partial<Record<IdentityFlow, CaptureSession>>>({});
  const claimPassport = useCallback(() => {
    delete pending.current.passport;
  }, []);
  const documentOpening = useRef(false);
  const claimDocument = useCallback(() => {
    delete pending.current.license;
  }, []);
  const claimSSN = useCallback(() => {
    delete pending.current.ssn;
  }, []);
  const claimPhone = useCallback(() => {
    delete pending.current.phone;
  }, []);
  const [result, setResult] = useState<CompletedCapture>();
  const owned = useRef<CompletedCapture | undefined>(undefined);
  const [input, setInput] = useState<{
    completed?: CompletedCapture | undefined;
    resume?: ('read' | 'selfie') | undefined;
  }>({});
  const claimFace = useCallback(() => {
    delete pending.current.licenseFace;
  }, []);
  const guidedJourney = useRef<
    | {
        phase: 'face' | 'ssn' | 'environment' | 'result';
        saved: SavedDocumentCapture;
        checked: DocumentCheckSnapshot;
        phone: SavedPhoneCheck;
        face?: SavedDocumentFace['snapshot'];
        ssn?: SavedSSNCheck;
      }
    | undefined
  >(undefined);
  const reviewPermit = useRef<
    { journey: NonNullable<typeof guidedJourney.current>; epoch: number } | undefined
  >(undefined);
  const [environmentInput, setEnvironmentInput] = useState<SavedSSNCheck>();
  const [verificationResult, setVerificationResult] = useState<EnvironmentCheckSnapshot>();
  const claimEnvironment = useCallback(() => {
    delete pending.current.environment;
  }, []);
  const [faceInput, setFaceInput] = useState<{ saved: SavedDocumentCapture; documentOperationID: string }>();
  const [document, setDocument] = useState<SavedDocumentCapture>();
  const ownedDocument = useRef<SavedDocumentCapture | undefined>(undefined);
  const [documentInput, setDocumentInput] = useState<{
    saved?: SavedDocumentCapture | undefined;
    resume?: ('front' | 'back') | undefined;
  }>({});
  const [ssn, setSSN] = useState<SavedSSNCheck>();
  const ownedSSN = useRef<SavedSSNCheck | undefined>(undefined);
  const [ssnInput, setSSNInput] = useState<SavedSSNCheck>();
  const [phone, setPhone] = useState<SavedPhoneCheck>();
  // A changed document requires native revalidation before this phone result unlocks SSN.
  const [phoneDocument, setPhoneDocument] = useState<string>();
  const [checkedDocument, setCheckedDocument] = useState<{
    owner: SavedDocumentCapture;
    snapshot: DocumentCheckSnapshot;
  }>();
  const documentCheckEpoch = useRef(0);
  const documentRestoring = useRef(false);
  const documentRestoration = useRef<Promise<void>>(Promise.resolve());
  const documentCheckChanged = useCallback((session: DocumentCheckPort, state: DocumentCheckState) => {
    const owner = ownedDocument.current;
    if (!active.current || !owner || owner.session !== session) return;
    ++documentCheckEpoch.current;
    setCheckedDocument(
      !state.busy && !state.failure && state.snapshot ? { owner, snapshot: state.snapshot } : undefined,
    );
  }, []);
  const currentDocumentCheck =
    checkedDocument?.owner === document &&
    [document?.document.front, document?.document.back].some(
      (side) =>
        side &&
        side.captureID === checkedDocument?.snapshot.captureID &&
        side.sha256 === checkedDocument?.snapshot.sourceSHA256,
    )
      ? checkedDocument?.snapshot
      : undefined;
  const phoneBlocked = phonePrerequisite(configuration, document?.document, currentDocumentCheck);
  const checkedCaptureID = phoneBlocked ? undefined : checkedDocument?.snapshot.captureID;
  // The phone session owns its own lifecycle. It receives only the accepted capture's opaque
  // reference; native code resolves that reference against the retained document owner's custody.
  const phoneConfiguration = useMemo<Configuration>(() => {
    if (!checkedCaptureID || !configuration.phone) return configuration;
    return { ...configuration, phone: { ...configuration.phone, checkedDocumentID: checkedCaptureID } };
  }, [configuration, checkedCaptureID]);
  const documentRevision = documentEvidenceRevision(document, currentDocumentCheck);
  const renderedCheckEpoch = documentCheckEpoch.current;
  // Read only: restoring acceptance never starts a provider check. Late answers from an
  // old capture cannot enable the replacement document or survive unmount.
  useEffect(() => {
    // Startup restores the document and its dependent phone receipt as one owned sequence.
    // Do not race a second document command against that sequence.
    if (opening.current) return;
    let current = true;
    const epoch = ++documentCheckEpoch.current;
    if (document && configuration.document?.check) {
      documentRestoring.current = true;
      documentRestoration.current = document.session
        .documentCheckRestore()
        .then((snapshot) => {
          if (current && epoch === documentCheckEpoch.current)
            setCheckedDocument({ owner: document, snapshot });
        })
        .catch(() => {
          if (current && epoch === documentCheckEpoch.current) setCheckedDocument(undefined);
        })
        .finally(() => {
          if (current) documentRestoring.current = false;
        });
    }
    return () => {
      current = false;
      documentRestoring.current = false;
    };
  }, [document, configuration.document?.check]);
  const ssnBlocked = ssnPrerequisite(
    configuration,
    phoneDocument === documentRevision ? phone?.snapshot : undefined,
    phoneBlocked === undefined,
  );
  const ownedPhone = useRef<SavedPhoneCheck | undefined>(undefined);
  const [phoneInput, setPhoneInput] = useState<SavedPhoneCheck>();
  const [clearRequest, setClearRequest] = useState<ClearRequest>();
  const [clearFailure, setClearFailure] = useState<{ target: ClearTarget; message: string }>();
  const [clearing, setClearing] = useState(false);
  const clearPending = useRef(false);
  const [openingResults, setOpeningResults] = useState(true);
  const opening = useRef(true);
  const [savedCount, setSavedCount] = useState(0);
  const [restoreFailure, setRestoreFailure] = useState<string>();
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const latestRestoreAttempt = useRef(0);
  // AppContainer mounts a fresh owner for every configuration. Invalidate callbacks before
  // passive cleanup, and make the next owner's startup wait for retained-session release.
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      const previous = new Set([
        owned.current?.session,
        ownedDocument.current?.session,
        ownedSSN.current?.session,
        ownedPhone.current?.session,
        ...Object.values(pending.current),
      ]);
      pending.current = {};
      owned.current = undefined;
      ownedDocument.current = undefined;
      ownedSSN.current = undefined;
      ownedPhone.current = undefined;
      custody.releasing = Promise.all([
        custody.releasing,
        ...[...previous].flatMap((session) => (session ? [session.release()] : [])),
      ]);
      // Keep a failed release in the shared barrier for the next owner's recovery screen.
      custody.releasing.catch(custody.reportFailure);
    };
  }, [custody]);
  useEffect(() => {
    const previousRelease = custody.releasing;
    let transferredRelease: Promise<void> = Promise.resolve();
    // A successful handoff has left its controller but may arrive after this owner unmounts.
    // Keep that release in restoration completion without waiting on our own cleanup barrier.
    const releaseTransferred = (session: CaptureSession) => {
      transferredRelease = Promise.resolve().then(() => session.release());
      return transferredRelease;
    };
    let restoring = true;
    const isActive = () => active.current && restoring && latestRestoreAttempt.current === restoreAttempt;
    const controller = new CaptureFlowController(IdentityCaptureSession.create, configuration, () => {});
    const documentController = new DocumentFlowController(
      IdentityCaptureSession.create,
      configuration,
      () => {},
    );
    let phoneController: PhoneFlowController | undefined;
    async function restorePhone(restored: SavedDocumentCapture, checked: DocumentCheckSnapshot) {
      if (phonePrerequisite(configuration, restored.document, checked) || !configuration.phone) return;
      phoneController = new PhoneFlowController(
        IdentityCaptureSession.create,
        { ...configuration, phone: { ...configuration.phone, checkedDocumentID: checked.captureID } },
        () => {},
      );
      // Read the encrypted receipt through its native owner. Opening and handing off never
      // sends a text or reconciles an unresolved provider request.
      await phoneController.open();
      if (!isActive()) return;
      const sheet = phoneController.state.sheet;
      if (sheet?.kind === 'error') setRestoreFailure(sheet.message);
      if (sheet || !phoneController.state.snapshot) return;
      const saved = await phoneController.handoff();
      if (!saved) return;
      if (!isActive()) {
        await releaseTransferred(saved.session);
        return;
      }
      ownedPhone.current = saved;
      setPhone(saved);
      setPhoneDocument(documentEvidenceRevision(restored, checked));
    }
    async function restoreDocumentSelection() {
      await documentController.restoreSelected();
      if (!isActive()) return;
      if (documentController.state.sheet) {
        setRestoreFailure(documentController.state.sheet.message);
        return;
      }
      if (!documentController.state.completed && !documentController.state.draft) return;
      const restored = await documentController.handoff();
      if (!restored) return;
      if (!isActive()) {
        await releaseTransferred(restored.session);
        return;
      }
      ownedDocument.current = restored;
      setDocument(restored);
      return restored;
    }
    async function restoreDocument() {
      const restored = ownedDocument.current ?? (await restoreDocumentSelection());
      if (!isActive() || !restored || !configuration.document?.check) return;
      const checked = await restored.session.documentCheckRestore();
      if (!isActive()) return;
      setCheckedDocument({ owner: restored, snapshot: checked });
      if (!ownedPhone.current) await restorePhone(restored, checked);
    }
    const reportRestoreFailure = (error: unknown) => {
      if (isActive())
        setRestoreFailure(errorText(errorCode(error), restoreErrors, t('hub.restoreError.other')));
    };
    async function restoreSavedResult() {
      await controller.open();
      if (!isActive()) return;
      if (controller.state.sheet) {
        setRestoreFailure(controller.state.sheet.message);
        return;
      }
      setSavedCount(controller.state.saved?.length ?? (controller.state.passport ? 1 : 0));
      if (controller.state.passport) {
        const restored = await controller.handoff();
        if (!isActive()) {
          await releaseTransferred(restored.session);
          return;
        }
        owned.current = restored;
        setResult(restored);
      }
    }
    const disposeRestoreControllers = () =>
      Promise.all([controller.dispose(), documentController.dispose(), phoneController?.dispose()]);
    const restore = async () => {
      try {
        await previousRelease;
        if (!isActive()) return;
        setRestoreFailure(undefined);
        if (configuration.results && !owned.current) await restoreSavedResult();
        if (isActive() && configuration.document) await restoreDocument();
      } catch (error) {
        reportRestoreFailure(error);
      } finally {
        await Promise.all([disposeRestoreControllers(), transferredRelease]);
        if (isActive()) {
          opening.current = false;
          setOpeningResults(false);
        }
      }
    };
    const restoration = restore();
    restoration.catch(reportRestoreFailure);
    return () => {
      restoring = false;
      custody.releasing = Promise.all([custody.releasing, disposeRestoreControllers(), restoration]);
      custody.releasing.catch(custody.reportFailure);
    };
  }, [configuration, custody, restoreAttempt]);
  function canStart() {
    return active.current && !clearPending.current && !opening.current && !retainedReleaseFailed.current;
  }
  function receive(flow: IdentityFlow, session: CaptureSession) {
    if (active.current) {
      delete pending.current[flow];
      return true;
    }
    custody.releasing = Promise.all([custody.releasing, session.release()]);
    custody.releasing.catch(custody.reportFailure);
    return false;
  }
  function accept(completed: CompletedCapture) {
    if (!receive('passport', completed.session)) return;
    owned.current = completed;
    setResult(completed);
    setInput({});
    onHome();
  }
  function start(resume?: 'read' | 'selfie') {
    if (!canStart()) return;
    const completed = result;
    if (completed) pending.current.passport = completed.session;
    owned.current = undefined;
    setResult(undefined);
    setInput({ completed, resume });
    openFlow('passport');
  }
  async function openSavedResults() {
    if (!canStart()) return;
    opening.current = true;
    setOpeningResults(true);
    const session = owned.current?.session;
    try {
      await releaseRetainedSession(session);
      if (!active.current || owned.current?.session !== session) return;
      owned.current = undefined;
      setResult(undefined);
      setInput({});
      openFlow('passport');
    } finally {
      if (active.current) {
        opening.current = false;
        setOpeningResults(false);
      }
    }
  }
  function acceptDocument(saved: SavedDocumentCapture) {
    if (!receive('license', saved.session)) return;
    documentOpening.current = false;
    ownedDocument.current = saved;
    setDocument(saved);
    setDocumentInput({});
    onHome();
  }
  function startDocument(resume?: 'front' | 'back', guided = false) {
    if (!canStart() || documentOpening.current) return;
    documentOpening.current = true;
    transferDocument(resume, guided).catch(() => {
      documentOpening.current = false;
      if (active.current) setRestoreFailure(t('hub.closeFailed.check'));
    });
  }
  async function transferDocument(resume: 'front' | 'back' | undefined, guided: boolean) {
    // Finish the workspace's read-only restore before transferring the same native session.
    await documentRestoration.current;
    if (!canStart()) {
      documentOpening.current = false;
      return;
    }
    const saved = ownedDocument.current;
    if (saved) pending.current.license = saved.session;
    ownedDocument.current = undefined;
    setDocument(undefined);
    setDocumentInput({ saved, resume });
    openFlow('license', guided);
  }
  function openSSN() {
    if (ssnBlocked) return;
    if (!canStart()) return;
    if (ssn) pending.current.ssn = ssn.session;
    ownedSSN.current = undefined;
    setSSNInput(ssn);
    setSSN(undefined);
    openFlow('ssn');
  }
  function acceptSSN(value: SavedSSNCheck) {
    guidedJourney.current = undefined;
    if (!receive('ssn', value.session)) return;
    ownedSSN.current = value;
    setSSN(value);
    setSSNInput(undefined);
    onHome();
  }
  function continueToPhone(saved: SavedDocumentCapture, checked: DocumentCheckSnapshot): boolean {
    if (
      !canStart() ||
      !documentOpening.current ||
      !configuration.phone ||
      !isCompleteDocument(saved.document) ||
      !documentRecordAccepted(saved.document, checked)
    )
      return false;
    if (!receive('license', saved.session)) return false;
    documentOpening.current = false;
    ownedDocument.current = saved;
    setDocument(saved);
    setDocumentInput({});
    ++documentCheckEpoch.current;
    setCheckedDocument({ owner: saved, snapshot: checked });
    if (ownedPhone.current) pending.current.phone = ownedPhone.current.session;
    setPhoneInput(ownedPhone.current);
    ownedPhone.current = undefined;
    setPhone(undefined);
    openFlow('phone', true);
    return true;
  }
  function continueToFace(value: SavedPhoneCheck): boolean {
    const saved = ownedDocument.current;
    const checked = currentDocumentCheck;
    const operation = checked?.result?.operationID;
    if (
      !canStart() ||
      renderedCheckEpoch !== documentCheckEpoch.current ||
      documentOpening.current ||
      documentRestoring.current ||
      !saved ||
      !checked ||
      saved !== document ||
      !operation ||
      !isCompleteDocument(saved.document) ||
      !documentRecordAccepted(saved.document, checked) ||
      !phoneCheckComplete(value.snapshot)
    )
      return false;
    if (!receive('phone', value.session)) return false;
    ownedPhone.current = value;
    setPhone(value);
    setPhoneDocument(documentRevision);
    setPhoneInput(undefined);
    guidedJourney.current = { phase: 'face', saved, checked, phone: value };
    pending.current.licenseFace = saved.session;
    ownedDocument.current = undefined;
    setDocument(undefined);
    setFaceInput({ saved, documentOperationID: operation });
    openFlow('licenseFace', true);
    return true;
  }
  function continueToSSN(saved: SavedDocumentFace): boolean {
    const journey = guidedJourney.current;
    const face = saved.snapshot;
    if (
      !canStart() ||
      !configuration.ssn ||
      journey?.phase !== 'face' ||
      saved.session !== journey.saved.session ||
      ownedPhone.current !== journey.phone ||
      !phoneCheckComplete(journey.phone.snapshot) ||
      face?.state !== 'completed' ||
      face.result.outcome !== 'pass' ||
      face.captureID !== saved.document.front?.captureID ||
      face.sourceSHA256 !== saved.document.front.sha256 ||
      face.documentOperationID !== journey.checked.result?.operationID ||
      !documentRecordAccepted(saved.document, journey.checked)
    )
      return false;
    if (!receive('licenseFace', saved.session)) return false;
    ownedDocument.current = saved;
    setDocument(saved);
    setFaceInput(undefined);
    ++documentCheckEpoch.current;
    setCheckedDocument({ owner: saved, snapshot: journey.checked });
    setPhoneDocument(documentEvidenceRevision(saved, journey.checked));
    guidedJourney.current = { ...journey, phase: 'ssn', saved, face };
    if (ownedSSN.current) pending.current.ssn = ownedSSN.current.session;
    setSSNInput(ownedSSN.current);
    ownedSSN.current = undefined;
    setSSN(undefined);
    openFlow('ssn', true);
    return true;
  }
  function continueToEnvironment(value: SavedSSNCheck): boolean {
    const journey = guidedJourney.current;
    const receipt = value.snapshot.receipt;
    if (
      !canStart() ||
      journey?.phase !== 'ssn' ||
      documentRestoring.current ||
      renderedCheckEpoch !== documentCheckEpoch.current ||
      ownedDocument.current !== journey.saved ||
      ownedPhone.current !== journey.phone ||
      !ssnCheckComplete(value.snapshot) ||
      !receipt ||
      !documentRecordAccepted(journey.saved.document, currentDocumentCheck) ||
      currentDocumentCheck?.result?.operationID !== journey.checked.result?.operationID ||
      receipt.binding.documentOperationID !== currentDocumentCheck?.result?.operationID ||
      receipt.binding.phoneChallengeID !== journey.phone.snapshot.receipt?.challengeID
    )
      return false;
    if (!receive('ssn', value.session)) return false;
    guidedJourney.current = { ...journey, phase: 'environment', ssn: value };
    setSSNInput(undefined);
    pending.current.environment = value.session;
    setEnvironmentInput(value);
    openFlow('environment', true);
    return true;
  }
  async function prepareReview(): Promise<boolean> {
    reviewPermit.current = undefined;
    const journey = guidedJourney.current;
    if (!canStart() || journey?.phase !== 'environment' || !journey.ssn) return false;
    const epoch = documentCheckEpoch.current;
    await documentRestoration.current;
    const checked = await journey.saved.session.documentCheckRestore();
    const face = await journey.saved.session.documentFaceSnapshot();
    const phone = await journey.phone.session.phoneSnapshot();
    const ssn = await journey.ssn.session.ssnSnapshot();
    if (
      !canStart() ||
      guidedJourney.current !== journey ||
      epoch !== documentCheckEpoch.current ||
      ownedDocument.current !== journey.saved ||
      ownedPhone.current !== journey.phone ||
      !documentRecordAccepted(journey.saved.document, checked) ||
      checked.result?.operationID !== journey.checked.result?.operationID ||
      face.state !== 'completed' ||
      face.result.outcome !== 'pass' ||
      journey.face?.state !== 'completed' ||
      face.captureID !== journey.face.captureID ||
      face.sourceSHA256 !== journey.face.sourceSHA256 ||
      face.documentOperationID !== journey.face.documentOperationID ||
      face.result.completedAt !== journey.face.result.completedAt ||
      !phoneCheckComplete(phone) ||
      phone.receipt?.challengeID !== journey.phone.snapshot.receipt?.challengeID ||
      !ssnCheckComplete(ssn) ||
      ssn.receipt?.operationID !== journey.ssn.snapshot.receipt?.operationID ||
      ssn.receipt?.binding.documentOperationID !== checked.result?.operationID ||
      ssn.receipt?.binding.phoneChallengeID !== phone.receipt?.challengeID
    )
      return false;
    reviewPermit.current = { journey, epoch };
    return true;
  }
  function finishEnvironment(value: SavedEnvironmentCheck): boolean {
    const permit = reviewPermit.current;
    const environment = value.environment;
    if (
      !canStart() ||
      !permit ||
      permit.journey !== guidedJourney.current ||
      permit.epoch !== documentCheckEpoch.current ||
      permit.journey.phase !== 'environment' ||
      !permit.journey.face ||
      permit.journey.ssn?.session !== value.session ||
      environment?.state !== 'completed' ||
      !environment.attemptID ||
      !environment.checkedAt ||
      environment.reason ||
      environment.location !== 'observed' ||
      !['consistent', 'divergent'].includes(environment.air)
    )
      return false;
    if (!receive('environment', value.session)) return false;
    ownedSSN.current = value;
    setSSN(value);
    setEnvironmentInput(undefined);
    guidedJourney.current = { ...permit.journey, phase: 'result' };
    reviewPermit.current = undefined;
    setReview({
      document: permit.journey.saved,
      checked: permit.journey.checked,
      face: permit.journey.face,
      phone: permit.journey.phone,
      ssn: value,
      environment,
    });
    setVerificationResult(environment);
    openFlow('verificationResult', true);
    return true;
  }
  function acceptEnvironment(value: SavedEnvironmentCheck) {
    if (!receive('environment', value.session)) return;
    ownedSSN.current = value;
    setSSN(value);
    setEnvironmentInput(undefined);
    guidedJourney.current = undefined;
    reviewPermit.current = undefined;
    onHome();
  }
  function acceptFace(saved: SavedDocumentFace) {
    if (!receive('licenseFace', saved.session)) return;
    guidedJourney.current = undefined;
    ownedDocument.current = saved;
    setDocument(saved);
    setFaceInput(undefined);
    onHome();
  }
  function openPhone() {
    if (phoneBlocked) return;
    if (!canStart()) return;
    if (phone) pending.current.phone = phone.session;
    ownedPhone.current = undefined;
    setPhoneInput(phone);
    setPhone(undefined);
    openFlow('phone');
  }
  function acceptPhone(value: SavedPhoneCheck) {
    if (!receive('phone', value.session)) return;
    setPhoneDocument(documentRevision);
    ownedPhone.current = value;
    setPhone(value);
    setPhoneInput(undefined);
    onHome();
  }
  /** Deleting saved evidence is a destructive choice: it is asked with the iOS action sheet. */
  function requestClear(target: ClearTarget) {
    if (!active.current || clearPending.current || opening.current) return;
    setClearFailure(undefined);
    setClearRequest({ target, session: clearSession(target) });
  }
  function clearSession(target: ClearTarget) {
    return target === 'document' ? ownedDocument.current?.session : owned.current?.session;
  }
  function releaseRetainedSession(session: CaptureSession | undefined) {
    const release = Promise.resolve().then(() => session?.release());
    custody.releasing = Promise.all([custody.releasing, release]);
    custody.releasing.catch((error: unknown) => {
      retainedReleaseFailed.current = true;
      custody.reportFailure(error);
    });
    // A second native release may resolve after the first failed. The shared barrier keeps
    // that failure visible instead of treating a repeated no-op release as successful cleanup.
    return custody.releasing;
  }
  async function clearDocument(session: CaptureSession | undefined) {
    await session?.eraseDocuments();
    if (!active.current) return false;
    await releaseRetainedSession(session);
    if (!active.current || ownedDocument.current?.session !== session) return false;
    ownedDocument.current = undefined;
    setDocument(undefined);
    return true;
  }
  /** An unreadable store needs a temporary owner. Reserve its release before awaiting acquisition
   * so a replacement holder waits even when session creation has not settled yet. */
  async function clearUnreviewedPassport() {
    const previousRelease = custody.releasing;
    let completeRelease!: (release: Promise<void>) => void;
    const released = new Promise<void>((resolve) => {
      completeRelease = resolve;
    });
    custody.releasing = Promise.all([previousRelease, released]);
    custody.releasing.catch(custody.reportFailure);
    let session: CaptureSession | undefined;
    try {
      await previousRelease;
      if (!active.current) return false;
      session = await IdentityCaptureSession.create(configuration);
      if (!active.current) return false;
      if (configuration.results) await session.eraseResults();
      return active.current;
    } finally {
      // The command's own rejection reaches clearFailure. Custody tracks only release: a refused
      // erase followed by successful cleanup must not prevent later sessions from opening.
      const release = Promise.resolve().then(() => session?.release());
      completeRelease(release);
      await release;
    }
  }
  async function clearPassport(review: CaptureSession | undefined) {
    if (review) {
      if (configuration.results) await review.eraseResults();
      if (!active.current) return false;
      await releaseRetainedSession(review);
    } else if (!(await clearUnreviewedPassport())) {
      return false;
    }
    if (!active.current || owned.current?.session !== review) return false;
    owned.current = undefined;
    setResult(undefined);
    setSavedCount(0);
    setRestoreFailure(undefined);
    return true;
  }
  async function clear(request: ClearRequest) {
    const { target } = request;
    if (
      !active.current ||
      clearPending.current ||
      opening.current ||
      clearSession(target) !== request.session
    )
      return;
    clearPending.current = true;
    setClearing(true);
    try {
      const cleared =
        target === 'document' ? await clearDocument(request.session) : await clearPassport(request.session);
      if (!cleared) return;
      setClearFailure(undefined);
      onHome();
    } catch (error) {
      reportClearFailure(target, error);
    } finally {
      clearPending.current = false;
      if (active.current) setClearing(false);
    }
  }
  function reportClearFailure(target: ClearTarget, error: unknown) {
    if (active.current)
      setClearFailure({
        target,
        message: errorText(errorCode(error), clearErrors, t('hub.clearError.other')),
      });
  }
  return {
    passport: {
      result,
      input,
      start,
      accept,
      claim: claimPassport,
      openingResults,
      savedCount,
      openSaved: () => {
        openSavedResults().catch(() => {
          if (active.current) setRestoreFailure(t('hub.closeFailed.check'));
        });
      },
      exit: () => {
        if (!active.current) return;
        if (input.completed && pending.current.passport === input.completed.session) {
          owned.current = input.completed;
          setResult(input.completed);
          delete pending.current.passport;
        }
        setInput({});
        onHome();
      },
    },
    license: {
      result: document,
      // Share the exact-capture acceptance decision with navigation; photo completeness is not a check.
      recordAccepted: phoneBlocked !== 'document',
      checkSnapshot: currentDocumentCheck,
      checkChanged: documentCheckChanged,
      input: documentInput,
      start: startDocument,
      accept: acceptDocument,
      continueToPhone,
      claim: claimDocument,
      exit: () => {
        if (!active.current) return;
        documentOpening.current = false;
        if (documentInput.saved && pending.current.license === documentInput.saved.session) {
          ownedDocument.current = documentInput.saved;
          setDocument(documentInput.saved);
          delete pending.current.license;
        }
        setDocumentInput({});
        onHome();
      },
    },
    environment: {
      input: environmentInput,
      claim: claimEnvironment,
      accept: acceptEnvironment,
      prepareReview,
      finish: finishEnvironment,
      exit: () => {
        if (!active.current) return;
        if (environmentInput && pending.current.environment === environmentInput.session) {
          ownedSSN.current = environmentInput;
          setSSN(environmentInput);
          delete pending.current.environment;
        }
        setEnvironmentInput(undefined);
        guidedJourney.current = undefined;
        reviewPermit.current = undefined;
        onHome();
      },
    },
    verification: {
      result: verificationResult,
      review,
      exit: () => {
        if (!active.current) return;
        setReview(undefined);
        setVerificationResult(undefined);
        guidedJourney.current = undefined;
        onHome();
      },
    },
    face: {
      input: faceInput,
      claim: claimFace,
      accept: acceptFace,
      continueToSSN,
      exit: () => {
        if (!active.current) return;
        guidedJourney.current = undefined;
        if (faceInput && pending.current.licenseFace === faceInput.saved.session) {
          ownedDocument.current = faceInput.saved;
          setDocument(faceInput.saved);
          delete pending.current.licenseFace;
        }
        setFaceInput(undefined);
        onHome();
      },
    },
    ssn: {
      blocked: ssnBlocked,
      result: ssn,
      input: ssnInput,
      start: openSSN,
      accept: acceptSSN,
      continueToEnvironment,
      claim: claimSSN,
      exit: () => {
        if (!active.current) return;
        guidedJourney.current = undefined;
        if (ssnInput && pending.current.ssn === ssnInput.session) {
          ownedSSN.current = ssnInput;
          setSSN(ssnInput);
          delete pending.current.ssn;
        }
        setSSNInput(undefined);
        onHome();
      },
    },
    phone: {
      configuration: phoneConfiguration,
      blocked: phoneBlocked,
      result: phone,
      input: phoneInput,
      start: openPhone,
      accept: acceptPhone,
      continueToFace,
      claim: claimPhone,
      exit: () => {
        if (!active.current) return;
        if (phoneInput && pending.current.phone === phoneInput.session) {
          ownedPhone.current = phoneInput;
          setPhone(phoneInput);
          delete pending.current.phone;
        }
        setPhoneInput(undefined);
        onHome();
      },
    },
    recovery: {
      restoreFailure,
      clearFailure,
      clearing,
      confirmingClear: clearRequest?.target,
      requestClear,
      clear: (target: ClearTarget) => clear({ target, session: clearSession(target) }),
      retryRestore: () => {
        if (!canStart()) return;
        opening.current = true;
        setOpeningResults(true);
        latestRestoreAttempt.current += 1;
        setRestoreAttempt(latestRestoreAttempt.current);
      },
      dismissClearFailure: () => {
        if (active.current) setClearFailure(undefined);
      },
      cancelClear: () => {
        if (active.current) setClearRequest(undefined);
      },
      confirmClear: () => {
        if (!active.current || !clearRequest) return;
        setClearRequest(undefined);
        clear(clearRequest).catch((error: unknown) => reportClearFailure(clearRequest.target, error));
      },
    },
  };
}

export type IdentityWorkspace = ReturnType<typeof useIdentityWorkspace>;

/** The restored receipt and later handoffs use the same exact-document revision. */
function documentEvidenceRevision(
  saved: SavedDocumentCapture | undefined,
  checked: DocumentCheckSnapshot | undefined,
): string {
  return JSON.stringify([
    saved?.document.front?.captureID,
    saved?.document.front?.sha256,
    saved?.document.back?.captureID,
    saved?.document.back?.sha256,
    checked?.result?.operationID,
  ]);
}
