import { type Configuration, IdentityCaptureSession } from '@kenshiki/identity-capture';
import { useEffect, useRef, useState } from 'react';
import { CaptureFlowController, type CompletedCapture } from './CaptureFlowController';
import type { SavedDocumentCapture } from './DocumentFlowController';
import { type ErrorText, errorCode, errorText } from './HolderText';
import { t } from './locales/i18n';
import type { SavedPhoneCheck } from './PhoneFlowController';
import type { SavedSSNCheck } from './SSNFlowController';

export type IdentityFlow = 'passport' | 'license' | 'ssn' | 'phone';
type ClearTarget = 'passport' | 'document';

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
) {
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
  const ownedPhone = useRef<SavedPhoneCheck | undefined>(undefined);
  const [phoneInput, setPhoneInput] = useState<SavedPhoneCheck>();
  const [confirmingClear, setConfirmingClear] = useState<ClearTarget>();
  const [clearFailure, setClearFailure] = useState<{ target: ClearTarget; message: string }>();
  const [clearing, setClearing] = useState(false);
  const [openingResults, setOpeningResults] = useState(!!configuration.results);
  const [savedCount, setSavedCount] = useState(0);
  const [restoreFailure, setRestoreFailure] = useState<string>();
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const latestRestoreAttempt = useRef(0);
  const releasing = useRef<Promise<unknown>>(Promise.resolve());
  // One configuration is one holder's custody. Before the next holder's saved results open,
  // release every session the previous holder's screens own, clear their personal state and
  // return to the Identity list.
  useEffect(() => {
    const previous = [
      owned.current?.session,
      ownedDocument.current?.session,
      ownedSSN.current?.session,
      ownedPhone.current?.session,
    ];
    owned.current = undefined;
    ownedDocument.current = undefined;
    ownedSSN.current = undefined;
    ownedPhone.current = undefined;
    setResult(undefined);
    setDocument(undefined);
    setSSN(undefined);
    setPhone(undefined);
    setInput({});
    setDocumentInput({});
    setSSNInput(undefined);
    setPhoneInput(undefined);
    setConfirmingClear(undefined);
    setClearFailure(undefined);
    setSavedCount(0);
    setRestoreFailure(undefined);
    onHome();
    setOpeningResults(!!configuration.results);
    releasing.current = Promise.all(previous.flatMap((session) => (session ? [session.release()] : [])));
    releasing.current.catch(() => setRestoreFailure(t('hub.closeFailed.previous')));
  }, [configuration, onHome]);
  useEffect(() => {
    if (!configuration.results) {
      setOpeningResults(false);
      return;
    }
    let active = true;
    latestRestoreAttempt.current = restoreAttempt;
    const attempt = restoreAttempt;
    const isActive = () => active && latestRestoreAttempt.current === attempt;
    const controller = new CaptureFlowController(IdentityCaptureSession.create, configuration, () => {});
    setOpeningResults(true);
    const reportRestoreFailure = (error: unknown) => {
      if (isActive())
        setRestoreFailure(errorText(errorCode(error), restoreErrors, t('hub.restoreError.other')));
    };
    async function adoptRestoredResult() {
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
    const restore = async () => {
      try {
        await releasing.current;
        if (!isActive()) return;
        await controller.open();
        if (!isActive()) return;
        const sheet = controller.state.sheet;
        if (sheet) {
          setRestoreFailure(sheet.message);
          return;
        }
        setSavedCount(controller.state.saved?.length ?? (controller.state.passport ? 1 : 0));
        await adoptRestoredResult();
        setRestoreFailure(undefined);
      } catch (error) {
        reportRestoreFailure(error);
      } finally {
        await controller.dispose();
        if (isActive()) setOpeningResults(false);
      }
    };
    restore().catch(reportRestoreFailure);
    return () => {
      active = false;
      controller.dispose().catch(reportRestoreFailure);
    };
  }, [configuration, restoreAttempt]);
  useEffect(
    () => () => {
      owned.current?.session.release().catch(() => setRestoreFailure(t('hub.closeFailed.check')));
      ownedDocument.current?.session.release().catch(() => setRestoreFailure(t('hub.closeFailed.check')));
      ownedSSN.current?.session.release().catch(() => setRestoreFailure(t('hub.closeFailed.check')));
      ownedPhone.current?.session.release().catch(() => setRestoreFailure(t('hub.closeFailed.check')));
    },
    [],
  );
  function accept(completed: CompletedCapture) {
    owned.current = completed;
    setResult(completed);
    setInput({});
    onHome();
  }
  function start(resume?: 'read' | 'selfie') {
    const completed = result;
    owned.current = undefined;
    setResult(undefined);
    setInput({ completed, resume });
    openFlow('passport');
  }
  async function openSavedResults() {
    if (openingResults) return;
    setOpeningResults(true);
    try {
      await owned.current?.session.release();
      owned.current = undefined;
      setResult(undefined);
      setInput({});
      openFlow('passport');
    } finally {
      setOpeningResults(false);
    }
  }
  function acceptDocument(saved: SavedDocumentCapture) {
    ownedDocument.current = saved;
    setDocument(saved);
    setDocumentInput({});
    onHome();
  }
  function startDocument(resume?: 'front' | 'back') {
    const saved = document;
    ownedDocument.current = undefined;
    setDocument(undefined);
    setDocumentInput({ saved, resume });
    openFlow('license');
  }
  function openSSN() {
    ownedSSN.current = undefined;
    setSSNInput(ssn);
    setSSN(undefined);
    openFlow('ssn');
  }
  function acceptSSN(value: SavedSSNCheck) {
    ownedSSN.current = value;
    setSSN(value);
    setSSNInput(undefined);
    onHome();
  }
  function openPhone() {
    ownedPhone.current = undefined;
    setPhoneInput(phone);
    setPhone(undefined);
    openFlow('phone');
  }
  function acceptPhone(value: SavedPhoneCheck) {
    ownedPhone.current = value;
    setPhone(value);
    setPhoneInput(undefined);
    onHome();
  }
  /** Deleting saved evidence is a destructive choice: it is asked with the iOS action sheet. */
  function requestClear(target: ClearTarget) {
    setClearFailure(undefined);
    setConfirmingClear(target);
  }
  async function clear(target: ClearTarget) {
    if (clearing) return;
    setClearing(true);
    try {
      if (target === 'document') {
        await ownedDocument.current?.session.eraseDocuments();
        await ownedDocument.current?.session.release();
        ownedDocument.current = undefined;
        setDocument(undefined);
      } else {
        // An unreadable store has no review session; erase it through a session of its own.
        const review = owned.current?.session;
        const session = review ?? (await IdentityCaptureSession.create(configuration));
        try {
          if (configuration.results) await session.eraseResults();
        } catch (error) {
          if (!review) await session.release();
          throw error;
        }
        await session.release();
        owned.current = undefined;
        setResult(undefined);
        setSavedCount(0);
        setRestoreFailure(undefined);
      }
      setClearFailure(undefined);
      onHome();
    } catch (error) {
      reportClearFailure(target, error);
    } finally {
      setClearing(false);
    }
  }
  function reportClearFailure(target: ClearTarget, error: unknown) {
    setClearFailure({ target, message: errorText(errorCode(error), clearErrors, t('hub.clearError.other')) });
  }
  return {
    passport: {
      result,
      input,
      start,
      accept,
      openingResults,
      savedCount,
      openSaved: () => {
        openSavedResults().catch(() => setRestoreFailure(t('hub.closeFailed.check')));
      },
      exit: () => {
        setInput({});
        onHome();
      },
    },
    license: {
      result: document,
      input: documentInput,
      start: startDocument,
      accept: acceptDocument,
      exit: () => {
        setDocumentInput({});
        onHome();
      },
    },
    ssn: {
      result: ssn,
      input: ssnInput,
      start: openSSN,
      accept: acceptSSN,
      exit: () => {
        setSSNInput(undefined);
        onHome();
      },
    },
    phone: {
      result: phone,
      input: phoneInput,
      start: openPhone,
      accept: acceptPhone,
      exit: () => {
        setPhoneInput(undefined);
        onHome();
      },
    },
    recovery: {
      restoreFailure,
      clearFailure,
      clearing,
      confirmingClear,
      requestClear,
      clear,
      retryRestore: () => setRestoreAttempt((value) => value + 1),
      dismissClearFailure: () => setClearFailure(undefined),
      cancelClear: () => setConfirmingClear(undefined),
      confirmClear: () => {
        if (!confirmingClear) return;
        setConfirmingClear(undefined);
        clear(confirmingClear).catch((error: unknown) => reportClearFailure(confirmingClear, error));
      },
    },
  };
}

export type IdentityWorkspace = ReturnType<typeof useIdentityWorkspace>;
