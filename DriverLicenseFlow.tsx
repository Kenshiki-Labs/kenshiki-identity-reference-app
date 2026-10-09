import React, {useEffect, useRef, useState} from 'react';
import {AppState, Linking, ScrollView, Text, View} from 'react-native';
import {IdentityCaptureImage, IdentityCapturePreview, IdentityCaptureSession} from '@kenshiki/identity-capture';
import type {Configuration, DocumentObservation, DocumentSideObservation} from '@kenshiki/identity-capture';
import {DocumentCheckPanel} from './DocumentCheckPanel';
import {Action, styles} from './IdentityCaptureFlow';
import {DocumentFlowController, type DocumentFlowState, type SavedDocumentCapture} from './DocumentFlowController';

export function DriverLicenseFlow({configuration, saved, resume, onComplete, onExit}: {
  configuration: Configuration; saved?: SavedDocumentCapture;
  resume?: 'front' | 'back';
  onComplete: (result: SavedDocumentCapture) => void; onExit: () => void;
}) {
  const [controller, setController] = useState<DocumentFlowController>();
  const [state, setState] = useState<DocumentFlowState>({phase: 'loading', busy: false,
    capturing: false, ready: false, preview: 0, saved: []});
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  useEffect(() => {
    const active = new DocumentFlowController(IdentityCaptureSession.create, configuration, setState, saved);
    setController(active); setState(active.state);
    if (resume === 'front') void active.startFront();
    else if (resume === 'back') void active.startBack();
    else void active.open();
    const listener = AppState.addEventListener('change', next => { if (next === 'background') void active.pause(); });
    return () => { listener.remove(); void active.dispose(); };
  }, [configuration, saved, resume]);
  if (!controller) return <View style={styles.root} />;
  const camera = state.phase === 'front' || state.phase === 'back';
  const finish = async () => {
    if (finishingRef.current) return;
    finishingRef.current = true; setFinishing(true);
    try {
      const result = await controller.handoff();
      if (result) onComplete(result); else onExit();
    } catch (error) {
      // Ownership stays here; the failed settlement is shown in this screen's bottom sheet.
      finishingRef.current = false; setFinishing(false);
      if (!controller.state.sheet) controller.fail(error);
    }
  };
  const exit = async () => {
    if (finishingRef.current) return;
    if (state.completed || state.draft?.front) { await finish(); return; }
    finishingRef.current = true; setFinishing(true); await controller.dispose(); onExit();
  };
  const action = (label: string, press: () => unknown, id?: string, secondary = false, disabled = false) =>
    <Action label={label} onPress={press} testID={id} secondary={secondary}
      disabled={state.busy || finishing || disabled} />;
  const close = <Action label="Back to Identity" secondary testID="document-back-to-identity"
    disabled={finishing} onPress={exit} />;
  const title = state.phase === 'front' ? 'Front of your license' : state.phase === 'back' ? 'Back of your license' :
    state.phase === 'frontReview' ? 'Front captured' : state.phase === 'result' ? 'Your driver’s license' :
      state.phase === 'saved' ? 'Saved license scans' : 'Driver’s license';
  return <View style={styles.root}>
    {camera ? <View style={styles.camera} accessibilityElementsHidden={!!state.sheet}
      importantForAccessibility={state.sheet ? 'no-hide-descendants' : 'auto'}>
      {state.session && <IdentityCapturePreview key={`document-${state.preview}`} session={state.session}
        kind="document" style={{position: 'absolute', top: 0, bottom: 0, left: 0, right: 0}} />}
      <View style={styles.cameraTop}>
        <Text style={[styles.eyebrow, styles.white]}>{state.phase === 'front' ? 'STEP 1 OF 2' : 'STEP 2 OF 2'}</Text>
        <Text accessibilityRole="header" style={[styles.title, styles.white]}>{title}</Text>
        <Text style={[styles.body, styles.white]}>Keep the whole card inside the guide. Hold it still and avoid glare.</Text>
      </View>
      <View style={styles.cameraBottom}>
        <Text style={[styles.body, styles.white]} accessibilityLiveRegion="polite">{documentHint(state)}</Text>
        {action(state.phase === 'front' ? 'Capture front' : 'Capture back', controller.capture,
          'capture-document', false, !state.ready || state.capturing)}
        {close}
      </View>
    </View> : <ScrollView contentContainerStyle={styles.content} accessibilityElementsHidden={!!state.sheet}
      importantForAccessibility={state.sheet ? 'no-hide-descendants' : 'auto'}>
      <Text style={styles.eyebrow}>IDENTITY</Text>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {state.phase === 'loading' && <Text style={styles.body} accessibilityLiveRegion="polite">Opening saved scans…</Text>}
      {state.phase === 'intro' && <>
        <Text style={styles.body}>Take a photo of the front, then the back. You can review both photos and the details read from the barcode.</Text>
        <Text style={styles.body}>Starting allows camera capture. Your photos are saved on this phone.</Text>
        {action('Scan the front', controller.startFront, 'start-document-front')}
      </>}
      {state.phase === 'saved' && <View style={{gap: 16}} testID="saved-documents-list">
        <Text style={styles.body}>Choose a saved scan to view it or continue where you left off.</Text>
        {state.saved.map((choice, index) => <View key={choice.workflowID} style={styles.card}>
          <Text style={styles.sheetTitle}>Saved scan {index + 1}</Text>
          <Text style={styles.body}>{choice.hasBack ? 'Front and back photos' : 'Front photo · Back still needed'}</Text>
          {action(choice.hasBack ? 'View scan' : 'Continue scan', () => controller.recoverSaved(choice.captureID), `saved-document-${index}`)}
        </View>)}
        {action('Scan another license', controller.startFront, 'start-document-front', true)}
      </View>}
      {state.phase === 'frontReview' && state.draft?.front && state.session && <>
        <Text style={styles.eyebrow}>STEP 1 OF 2 COMPLETE</Text>
        <IdentityCaptureImage session={state.session} image="documentFront" sha256={state.draft.front.sha256}
          accessibilityLabel="Captured front of your license" style={{height: 220}} />
        <Text style={styles.body}>Turn the card over. Capture the back, including the whole barcode.</Text>
        {action('Scan the back', controller.startBack, 'start-document-back')}
        {action('Retake front', controller.startFront, 'retake-document-front', true)}
      </>}
      {state.phase === 'result' && state.completed && state.session && <>
        <DocumentResultDetails result={{session: state.session, document: state.completed}} />
        <DocumentCheckPanel key={state.completed.front?.captureID} session={state.session} configured={!!configuration.document?.check} />
        {action('Done', finish, 'finish-document')}
        {action('Retake this license', controller.startFront, 'start-document-front', true)}
      </>}
      {state.busy && state.phase !== 'loading' && <Text style={styles.body} accessibilityLiveRegion="polite">Please wait…</Text>}
      {close}
    </ScrollView>}
    {state.sheet && <View style={styles.scrim}>
      <View style={styles.sheet} accessibilityViewIsModal testID="document-bottom-sheet">
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>{state.sheet.title}</Text>
          <Text style={styles.body}>{state.sheet.message}</Text>
          {state.sheet.recovery === 'details' ? close : <>
            {state.sheet.recovery === 'settings' && action('Open Settings', () => Linking.openSettings(), 'document-open-settings')}
            {action(state.sheet.recovery === 'settings' ? 'Try camera again' : 'Try again', controller.retry, 'retry-document')}
            {close}
          </>}
        </ScrollView>
      </View>
    </View>}
  </View>;
}

function documentHint(state: DocumentFlowState): string {
  if (state.capturing) return 'Capturing the photo…';
  if (state.ready) return 'Hold still. The photo can be captured now.';
  const hints: Record<string, string> = {
    consentRequired: 'Choose to start the scan before taking a photo.',
    locationRequired: 'Location access is needed for this capture.',
    captureFailed: 'The photo could not be completed. Try again.',
    cameraUnavailable: 'The camera is not available.',
    nativeControlsPaused: 'The camera paused. Continue when you are ready.',
  };
  return hints[state.issue ?? ''] ?? 'Keep all four corners in view and hold the card still.';
}

export function documentName(document: DocumentObservation): string {
  const fields = document.back?.pdf417?.fields ?? {};
  return fields.DAA || [fields.DAC, fields.DAD, fields.DCS].filter(Boolean).join(' ') || 'Driver’s license';
}
export function DocumentResultDetails({result}: {result: SavedDocumentCapture}) {
  const {document, session} = result;
  const [details, setDetails] = useState(false);
  const barcode = document.back?.pdf417;
  const fields = barcode?.fields ?? {};
  const address = [fields.DAG, fields.DAH, fields.DAI, fields.DAJ, fields.DAK].filter(Boolean).join('\n');
  return <>
    <View style={styles.card} testID="document-result">
      <Text accessibilityRole="header" style={styles.sheetTitle}>Your photos</Text>
      {document.front && <>
        <Text style={styles.label}>Front</Text>
        <IdentityCaptureImage key={document.front.sha256} session={session} image="documentFront" sha256={document.front.sha256}
          accessibilityLabel="Captured front of your license" style={{height: 200}} />
      </>}
      {document.back ? <>
        <Text style={styles.label}>Back</Text>
        <IdentityCaptureImage key={document.back.sha256} session={session} image="documentBack" sha256={document.back.sha256}
          accessibilityLabel="Captured back of your license" style={{height: 200}} />
      </> : <Text style={styles.body}>The front is saved. The back still needs a photo.</Text>}
    </View>
    {document.back && <View style={styles.card} testID="document-barcode-details">
      <Text accessibilityRole="header" style={styles.sheetTitle}>Details from the barcode</Text>
      <Text style={styles.body} testID="document-barcode-status">{barcodeStatus(document.back)}</Text>
      {(fields.DAA || fields.DCS || fields.DAC) && <Detail label="Name" value={documentName(document)} />}
      {fields.DAQ && <Detail label="License number" value={fields.DAQ} />}
      {fields.DBB && <Detail label="Date of birth, as read" value={fields.DBB} />}
      {fields.DBA && <Detail label="Expiry date, as read" value={fields.DBA} />}
      {address && <Detail label="Address" value={address} />}
    </View>}
    {barcode && <Action label={details ? 'Hide all read details' : 'View all read details'} secondary onPress={() => setDetails(!details)} />}
    {details && barcode && <View style={styles.card}>
      {Object.entries(fields).map(([field, value]) => <Detail key={field} label={fieldLabels[field] ?? `Field ${field}`} value={value} />)}
      {!!barcode.missingRequiredElements.length && <Detail label="Details missing from the barcode" value={barcode.missingRequiredElements.map(field => fieldLabels[field] ?? field).join(', ')} />}
    </View>}
  </>;
}
const fieldLabels: Record<string, string> = {
  DAA: 'Full name', DCS: 'Last name', DAC: 'First name', DAD: 'Middle name', DAQ: 'License number',
  DBB: 'Date of birth', DBA: 'Expiry date', DBD: 'Issue date', DAG: 'Street address', DAH: 'Address line 2',
  DAI: 'City', DAJ: 'State or province', DAK: 'Postal code', DCG: 'Country', DBC: 'Sex',
  DAY: 'Eye color', DAU: 'Height', DAW: 'Weight', DCA: 'Vehicle class', DCB: 'Restrictions',
  DCD: 'Endorsements', DCF: 'Document reference', DDA: 'Compliance field', DDB: 'Revision date',
};
/** Each decoder and parser state has its own text; none of them is issuer validation. */
function barcodeStatus(back: DocumentSideObservation): string {
  switch (back.pdf417Status) {
    case 'notFound': return 'No barcode was found in the photo of the back. Retake the back with the whole barcode in view.';
    case 'ambiguous': return 'More than one barcode was found in the photo of the back. Retake it with only this license in view.';
    case 'failed': return 'The barcode could not be decoded. Retake the back, holding it still and avoiding glare.';
    case 'notRequested': return 'The barcode was not read from this photo.';
    case 'readable': switch (back.pdf417?.status) {
      case 'readable': return back.pdf417.missingRequiredElements.length
        ? 'Read from the back of your license. Some required details were missing; review them against the card.'
        : 'Read from the back of your license.';
      case 'malformed': return 'The barcode was read, but its contents do not follow the license barcode standard. Review any details below against the card.';
      case 'unsupported': return 'The barcode was read, but this license’s barcode version is not supported. Review any details below against the card.';
      case undefined: return 'The barcode was found, but its details could not be read. You can retake the license photos.';
    }
  }
}
function Detail({label, value}: {label: string; value: string}) {
  return <View style={styles.detail}><Text style={styles.label}>{label}</Text><Text style={styles.body}>{value}</Text></View>;
}
