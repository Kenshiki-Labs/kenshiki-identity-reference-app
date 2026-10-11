import {
  type CaptureSession,
  type Configuration,
  type DocumentCheckSnapshot,
  IdentityCaptureSession,
} from '@kenshiki/identity-capture';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CaptureFlowController, type CompletedCapture } from './CaptureFlowController';
import type { DocumentCheckPort, DocumentCheckState } from './DocumentCheckController';
import { DocumentFlowController, type SavedDocumentCapture } from './DocumentFlowController';
import { type ErrorText, errorCode, errorText } from './HolderText';
import { phonePrerequisite, ssnPrerequisite } from './IdentityPrerequisites';
import { t } from './locales/i18n';
import { PhoneFlowController, type SavedPhoneCheck } from './PhoneFlowController';
import type { SavedSSNCheck } from './SSNFlowController';
import type { IdentityCustody } from './ui/ControllerCustody';

export type IdentityFlow = 'passport' | 'license' | 'ssn' | 'phone';
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
  openFlow: (flow: IdentityFlow) => void,
  custody: IdentityCustody,
) {
  const active = useRef(false);
  const pending = useRef<Partial<Record<IdentityFlow, CaptureSession>>>({});
  const claimPassport = useCallback(() => {
    delete pending.current.passport;
  }, []);
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
  // Read only: restoring acceptance never starts a provider check. Late answers from an
  // old capture cannot enable the replacement document or survive unmount.
  useEffect(() => {
    // Startup restores the document and its dependent phone receipt as one owned sequence.
    // Do not race a second document command against that sequence.
    if (opening.current) return;
    let current = true;
    const epoch = ++documentCheckEpoch.current;
    if (document && configuration.document?.check) {
      document.session
        .documentCheckRestore()
        .then((snapshot) => {
          if (current && epoch === documentCheckEpoch.current)
            setCheckedDocument({ owner: document, snapshot });
        })
        .catch(() => {
          if (current && epoch === documentCheckEpoch.current) setCheckedDocument(undefined);
        });
    }
    return () => {
      current = false;
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
        await saved.session.release();
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
        await restored.session.release();
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
          await restored.session.release();
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
        await custody.releasing;
        if (!isActive()) return;
        setRestoreFailure(undefined);
        if (configuration.results && !owned.current) await restoreSavedResult();
        if (isActive() && configuration.document) await restoreDocument();
      } catch (error) {
        reportRestoreFailure(error);
      } finally {
        await disposeRestoreControllers();
        if (isActive()) {
          opening.current = false;
          setOpeningResults(false);
        }
      }
    };
    restore().catch(reportRestoreFailure);
    return () => {
      restoring = false;
      custody.releasing = Promise.all([custody.releasing, disposeRestoreControllers()]);
      custody.releasing.catch(custody.reportFailure);
    };
  }, [configuration, custody, restoreAttempt]);
  function canStart() {
    return active.current && !clearPending.current && !opening.current;
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
    ownedDocument.current = saved;
    setDocument(saved);
    setDocumentInput({});
    onHome();
  }
  function startDocument(resume?: 'front' | 'back') {
    if (!canStart()) return;
    const saved = document;
    if (saved) pending.current.license = saved.session;
    ownedDocument.current = undefined;
    setDocument(undefined);
    setDocumentInput({ saved, resume });
    openFlow('license');
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
    if (!receive('ssn', value.session)) return;
    ownedSSN.current = value;
    setSSN(value);
    setSSNInput(undefined);
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
    if (!active.current || clearPending.current) return;
    setClearFailure(undefined);
    setClearRequest({ target, session: clearSession(target) });
  }
  function clearSession(target: ClearTarget) {
    return target === 'document' ? ownedDocument.current?.session : owned.current?.session;
  }
  function releaseRetainedSession(session: CaptureSession | undefined) {
    const release = Promise.resolve().then(() => session?.release());
    custody.releasing = Promise.all([custody.releasing, release]);
    custody.releasing.catch(custody.reportFailure);
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
    if (!active.current || clearPending.current || clearSession(target) !== request.session) return;
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
      claim: claimDocument,
      exit: () => {
        if (!active.current) return;
        if (documentInput.saved && pending.current.license === documentInput.saved.session) {
          ownedDocument.current = documentInput.saved;
          setDocument(documentInput.saved);
          delete pending.current.license;
        }
        setDocumentInput({});
        onHome();
      },
    },
    ssn: {
      blocked: ssnBlocked,
      result: ssn,
      input: ssnInput,
      start: openSSN,
      accept: acceptSSN,
      claim: claimSSN,
      exit: () => {
        if (!active.current) return;
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
