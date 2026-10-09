import type { Configuration } from '@kenshiki/identity-capture';
import { IdentityCaptureSession } from '@kenshiki/identity-capture';
import { useEffect, useRef, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { CaptureFlowController, type CompletedCapture } from './CaptureFlowController';
import { DocumentCheckPanel } from './DocumentCheckPanel';
import { isCompleteDocument, type SavedDocumentCapture } from './DocumentFlowController';
import { DocumentResultDetails, DriverLicenseFlow, documentName } from './DriverLicenseFlow';
import { type ErrorText, errorCode, errorText } from './HolderText';
import { Action, CaptureResultDetails, IdentityCaptureFlow, styles } from './IdentityCaptureFlow';
import { IdentitySheetHost } from './IdentitySheetHost';
import { IntegrationChecks } from './IntegrationChecks';
import { PhoneFlow } from './PhoneFlow';
import type { SavedPhoneCheck } from './PhoneFlowController';
import { phoneCheckStopped } from './PhonePolicy';
import { SSNFlow, ssnSummary } from './SSNFlow';
import type { SavedSSNCheck } from './SSNFlowController';

const clearErrors: ErrorText = {
  busy: 'Another check is still finishing. Wait a moment, then try again. Nothing has been deleted yet.',
  sessionUnavailable: 'This screen closed before deletion finished. Try again. Nothing has been deleted yet.',
  resultsNotConfigured: 'Saved results are not set up in this app, so there is nothing to delete here.',
  resultIntegrityFailure:
    'This phone could not open its secure storage to delete them. Try again. Your saved results are unchanged.',
  documentCustodyFailed:
    'This phone could not open its secure storage to delete them. Try again. Your saved scans are unchanged.',
  storageUnavailable:
    'This phone could not open its secure storage to delete them. Try again. Nothing has been deleted yet.',
};
const restoreErrors: ErrorText = {
  sessionUnavailable: 'The saved results closed before they finished opening. Try reopening them.',
  busy: 'Another check is still finishing. Wait a moment, then reopen your saved results.',
};

const emptyConfiguration: Configuration = {};
/** `developerChecks` is passed only by the simulator Debug AppDelegate. `configurationIssue` names
 * a native configuration step that failed before React mounted. */
export default function App({
  configuration = emptyConfiguration,
  developerChecks = false,
  configurationIssue,
}: {
  configuration?: Configuration | undefined;
  developerChecks?: boolean | undefined;
  configurationIssue?: 'holderScopeUnreadable' | undefined;
}) {
  const [screen, setScreen] = useState<
    'identity' | 'result' | 'capture' | 'checks' | 'documentCapture' | 'documentResult' | 'ssn' | 'phone'
  >('identity');
  const [result, setResult] = useState<CompletedCapture>();
  const [focus, setFocus] = useState<'passport' | 'face'>('passport');
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
  const [clearSheet, setClearSheet] = useState<'passport' | 'document'>();
  const [clearError, setClearError] = useState<string>();
  const [clearing, setClearing] = useState(false);
  const [openingResults, setOpeningResults] = useState(!!configuration.results);
  const [savedCount, setSavedCount] = useState(0);
  const [restoreFailure, setRestoreFailure] = useState<string>();
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const latestRestoreAttempt = useRef(0);
  const releasing = useRef<Promise<unknown>>(Promise.resolve());
  // One configuration is one holder's custody. Before the next holder's saved results open,
  // release every session the previous holder's screens own and clear their personal state.
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
    setClearSheet(undefined);
    setClearError(undefined);
    setSavedCount(0);
    setRestoreFailure(undefined);
    setScreen('identity');
    setOpeningResults(!!configuration.results);
    releasing.current = Promise.all(previous.flatMap((session) => (session ? [session.release()] : [])));
    releasing.current.catch(() =>
      setRestoreFailure('The previous checks could not be closed. Reopen this screen.'),
    );
  }, [configuration]);
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
        setRestoreFailure(
          errorText(
            errorCode(error),
            restoreErrors,
            'Your saved results could not be opened. Try reopening them.',
          ),
        );
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
      owned.current?.session
        .release()
        .catch(() => setRestoreFailure('A check could not be closed. Reopen this screen.'));
      ownedDocument.current?.session
        .release()
        .catch(() => setRestoreFailure('A check could not be closed. Reopen this screen.'));
      ownedSSN.current?.session
        .release()
        .catch(() => setRestoreFailure('A check could not be closed. Reopen this screen.'));
      ownedPhone.current?.session
        .release()
        .catch(() => setRestoreFailure('A check could not be closed. Reopen this screen.'));
    },
    [],
  );
  function accept(completed: CompletedCapture) {
    owned.current = completed;
    setResult(completed);
    setInput({});
    setScreen('identity');
  }
  function start(resume?: 'read' | 'selfie') {
    const completed = result;
    owned.current = undefined;
    setResult(undefined);
    setInput({ completed, resume });
    setScreen('capture');
  }
  async function openSavedResults() {
    if (openingResults) return;
    setOpeningResults(true);
    try {
      await owned.current?.session.release();
      owned.current = undefined;
      setResult(undefined);
      setInput({});
      setScreen('capture');
    } finally {
      setOpeningResults(false);
    }
  }
  function acceptDocument(saved: SavedDocumentCapture) {
    ownedDocument.current = saved;
    setDocument(saved);
    setDocumentInput({});
    setScreen('identity');
  }
  function startDocument(resume?: 'front' | 'back') {
    const saved = document;
    ownedDocument.current = undefined;
    setDocument(undefined);
    setDocumentInput({ saved, resume });
    setScreen('documentCapture');
  }
  function openSSN() {
    ownedSSN.current = undefined;
    setSSNInput(ssn);
    setSSN(undefined);
    setScreen('ssn');
  }
  function acceptSSN(value: SavedSSNCheck) {
    ownedSSN.current = value;
    setSSN(value);
    setSSNInput(undefined);
    setScreen('identity');
  }
  function openPhone() {
    ownedPhone.current = undefined;
    setPhoneInput(phone);
    setPhone(undefined);
    setScreen('phone');
  }
  function acceptPhone(value: SavedPhoneCheck) {
    ownedPhone.current = value;
    setPhone(value);
    setPhoneInput(undefined);
    setScreen('identity');
  }
  function requestClear(target: 'passport' | 'document') {
    setClearError(undefined);
    setClearSheet(target);
  }
  async function clear() {
    if (clearing) return;
    setClearing(true);
    try {
      if (clearSheet === 'document') {
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
      setClearSheet(undefined);
      setScreen('identity');
    } catch (error) {
      setClearError(
        errorText(
          errorCode(error),
          clearErrors,
          'The saved results could not be deleted. They have not been removed from this screen. Try again.',
        ),
      );
    } finally {
      setClearing(false);
    }
  }
  const passportReady = !!configuration.trustAnchorsURL;
  const faceReady = !!configuration.embedderURL && !!configuration.detectorURL;
  const blocked = openingResults || !!restoreFailure;
  const passportDisabled = blocked || (!passportReady && !result && !savedCount);
  const faceDisabled =
    blocked ||
    !(result?.comparison || (faceReady && result?.passport.portraitAvailable) || (!result && savedCount > 0));
  const covered = !!clearSheet || !!restoreFailure;
  function renderScreen() {
    if (screen === 'capture') {
      return (
        <IdentityCaptureFlow
          configuration={configuration}
          {...input}
          onComplete={accept}
          onExit={() => {
            setInput({});
            setScreen('identity');
          }}
        />
      );
    }
    if (screen === 'documentCapture') {
      return (
        <DriverLicenseFlow
          configuration={configuration}
          {...documentInput}
          onComplete={acceptDocument}
          onExit={() => {
            setDocumentInput({});
            setScreen('identity');
          }}
        />
      );
    }
    if (screen === 'ssn') {
      return (
        <SSNFlow
          configuration={configuration}
          saved={ssnInput}
          onComplete={acceptSSN}
          onExit={() => {
            setSSNInput(undefined);
            setScreen('identity');
          }}
        />
      );
    }
    if (screen === 'phone') {
      return (
        <PhoneFlow
          configuration={configuration}
          saved={phoneInput}
          onComplete={acceptPhone}
          onExit={() => {
            setPhoneInput(undefined);
            setScreen('identity');
          }}
        />
      );
    }
    if (screen === 'checks' && developerChecks && __DEV__) {
      return (
        <View style={{ flex: 1 }}>
          <Action label="Back to Identity" onPress={() => setScreen('identity')} />
          <IntegrationChecks configuration={configuration} />
        </View>
      );
    }
    return (
      <ScrollView
        contentContainerStyle={styles.content}
        testID="identity-hub"
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      >
        <Text accessibilityRole="header" style={styles.title}>
          {screen === 'result'
            ? 'Your results'
            : screen === 'documentResult'
              ? 'Your driver’s license'
              : 'Identity'}
        </Text>
        {renderIdentityContent()}
      </ScrollView>
    );
  }
  function renderRestoreFailure() {
    if (!(restoreFailure && !clearSheet)) return null;
    return (
      <View style={styles.scrim}>
        <View style={styles.sheet} accessibilityViewIsModal testID="restore-bottom-sheet">
          <View style={styles.sheetContent}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              Saved results could not be opened
            </Text>
            <Text style={styles.body}>{restoreFailure} Nothing has been erased.</Text>
            <Action
              label="Reopen saved results"
              disabled={openingResults}
              onPress={() => setRestoreAttempt((value) => value + 1)}
            />
            {configuration.results && (
              <Action
                label="Erase saved passport and face results"
                secondary
                disabled={openingResults}
                testID="erase-unreadable-results"
                onPress={() => requestClear('passport')}
              />
            )}
          </View>
        </View>
      </View>
    );
  }
  function renderEraseConfirmation() {
    if (!clearSheet) return null;
    return (
      <View style={styles.scrim}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.sheetContent}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              {clearError
                ? 'Deletion could not finish'
                : clearSheet === 'document'
                  ? 'Delete all saved license scans?'
                  : 'Erase all passport and face results?'}
            </Text>
            <Text style={styles.body}>
              {clearError ??
                (clearSheet === 'document'
                  ? 'This deletes every saved driver’s license scan from this app, including its photos and read details.'
                  : 'This deletes all saved passport and face results from this app, including their photos.')}
            </Text>
            <Action
              label={
                clearError
                  ? 'Try again'
                  : clearSheet === 'document'
                    ? 'Delete all license scans'
                    : 'Clear results'
              }
              onPress={clear}
              disabled={clearing}
            />
            <Action
              label="Keep results"
              secondary
              onPress={() => setClearSheet(undefined)}
              disabled={clearing}
            />
          </View>
        </View>
      </View>
    );
  }
  function renderIdentityContent() {
    if (screen === 'identity') {
      return (
        <>
          <Text style={styles.body}>Your identity checks, together in one place.</Text>
          {configurationIssue === 'holderScopeUnreadable' && (
            <Text style={styles.body} testID="configuration-issue">
              Saved checks are unavailable because this app’s local holder record could not be read. New
              checks are not saved.
            </Text>
          )}
          {renderLicenseCard()}
          {renderPassportCard()}
          {renderFaceCard()}
          {renderSSNCard()}
          {renderPhoneCard()}
          {configuration.results && result && (
            <Action
              label="Open saved passport checks"
              secondary
              disabled={openingResults}
              onPress={openSavedResults}
            />
          )}
          {configuration.results && result && (
            <Text style={styles.label}>
              Saved passport and face results stay on this phone until you erase them.
            </Text>
          )}
          {result && (
            <Action
              label="Erase all passport and face results"
              secondary
              onPress={() => requestClear('passport')}
            />
          )}
          {document && (
            <Action label="Delete saved license scans" secondary onPress={() => requestClear('document')} />
          )}
          {developerChecks && __DEV__ && (
            <Action
              label="Developer checks"
              secondary
              onPress={() => setScreen('checks')}
              testID="open-sdk-checks"
            />
          )}
        </>
      );
    }
    if (screen === 'documentResult' && document) {
      return (
        <>
          <DocumentResultDetails result={document} />
          <DocumentCheckPanel
            key={document.document.front?.captureID}
            session={document.session}
            configured={!!configuration.document?.check}
          />
          <Action
            label="Back to Identity"
            testID="document-result-back"
            onPress={() => setScreen('identity')}
          />
          <Action
            label="Retake this license"
            secondary
            testID="retake-saved-document"
            onPress={() => startDocument('front')}
          />
          <Action label="Delete saved license scans" secondary onPress={() => requestClear('document')} />
        </>
      );
    }
    if (!result) return null;
    return (
      <>
        <CaptureResultDetails result={result} focus={focus} />
        <Action label="Back to Identity" onPress={() => setScreen('identity')} />
        <Action
          label={result.comparison ? 'Retake selfie' : 'Compare with a selfie'}
          secondary
          disabled={!result.passport.portraitAvailable || !faceReady}
          onPress={() => start('selfie')}
        />
        {!faceReady && <Text style={styles.body}>Face comparison is not set up in this app.</Text>}
        <Action label="Read chip again" secondary disabled={!passportReady} onPress={() => start('read')} />
        <Action label="Clear results" secondary onPress={() => requestClear('passport')} />
      </>
    );
  }
  function renderLicenseCard() {
    return (
      <Pressable
        accessibilityRole="button"
        style={styles.card}
        testID="open-driver-license"
        onPress={() =>
          document && isCompleteDocument(document.document) ? setScreen('documentResult') : startDocument()
        }
      >
        <Text style={styles.sheetTitle}>Driver’s license</Text>
        <Text style={styles.body}>
          {document
            ? isCompleteDocument(document.document)
              ? `${documentName(document.document)} · View results`
              : 'Front saved · Continue with the back'
            : 'Scan your license or open a saved scan'}
        </Text>
      </Pressable>
    );
  }
  function renderPassportCard() {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: passportDisabled }}
        disabled={passportDisabled}
        style={[styles.card, passportDisabled && styles.disabled]}
        testID="open-capture-flow"
        onPress={() => {
          setFocus('passport');
          if (result) setScreen('result');
          else start();
        }}
      >
        <Text style={styles.sheetTitle}>Passport</Text>
        <Text style={styles.body}>{passportSummary()}</Text>
      </Pressable>
    );
  }
  function renderFaceCard() {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: faceDisabled }}
        disabled={faceDisabled}
        style={[styles.card, faceDisabled && styles.disabled]}
        testID="face-match-card"
        onPress={() => {
          setFocus('face');
          if (result?.comparison) setScreen('result');
          else start(result ? 'selfie' : undefined);
        }}
      >
        <Text style={styles.sheetTitle}>Face match</Text>
        <Text style={styles.body}>{faceSummary()}</Text>
      </Pressable>
    );
  }
  function renderSSNCard() {
    return (
      <Pressable accessibilityRole="button" style={styles.card} testID="open-ssn" onPress={openSSN}>
        <Text style={styles.sheetTitle}>Social Security number</Text>
        <Text style={styles.body}>
          {ssn?.snapshot.recoveryNeeded
            ? 'Check needs attention · Open'
            : ssn?.snapshot.receipt
              ? `${ssnSummary(ssn.snapshot.receipt)} · View result`
              : 'Check whether your number was issued'}
        </Text>
      </Pressable>
    );
  }
  function renderPhoneCard() {
    return (
      <Pressable accessibilityRole="button" style={styles.card} testID="open-phone" onPress={openPhone}>
        <Text style={styles.sheetTitle}>Phone</Text>
        <Text style={styles.body}>
          {phone?.snapshot.pending
            ? 'Check in progress · Resume'
            : phone?.snapshot.receipt
              ? phoneCheckStopped(phone.snapshot.receipt)
                ? 'Check stopped · Subscriber details differ from your ID'
                : 'Result available · View receipt and comparison'
              : 'Send a text and compare subscriber details with your checked ID'}
        </Text>
      </Pressable>
    );
  }
  function passportSummary() {
    if (result) {
      return `${result.passport.givenNames} ${result.passport.surname} · View results`;
    }
    if (openingResults) {
      return 'Opening saved results…';
    }
    if (savedCount) {
      return 'Open saved passport results';
    }
    if (passportReady) {
      return 'Scan and read your passport';
    }
    return 'Passport chip checking is not set up in this app. Your other identity checks remain available.';
  }
  function faceSummary() {
    if (result?.comparison) {
      return 'Comparison complete · View results';
    }
    if (!result && savedCount) {
      return 'Choose a saved passport to view its face check';
    }
    if (!faceReady) {
      return 'Face comparison is not set up in this app.';
    }
    if (result) {
      return 'Compare a selfie with your passport photo';
    }
    return 'Read a passport to add its photo first';
  }
  return (
    <IdentitySheetHost>
      <SafeAreaView style={styles.root}>
        {renderScreen()}
        {renderRestoreFailure()}
        {renderEraseConfirmation()}
      </SafeAreaView>
    </IdentitySheetHost>
  );
}
