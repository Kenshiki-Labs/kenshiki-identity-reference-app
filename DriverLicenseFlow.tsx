import React, {useEffect, useRef, useState} from 'react';
import {AppState, Linking, ScrollView, StyleSheet, Text, View} from 'react-native';
import {IdentityCaptureImage, IdentityCapturePreview, IdentityCaptureSession} from '@kenshiki/identity-capture';
import type {Configuration, DocumentObservation, DocumentSideObservation} from '@kenshiki/identity-capture';
import {DocumentCheckPanel} from './DocumentCheckPanel';
import {Action, styles} from './IdentityCaptureFlow';
import {DocumentFlowController, type DocumentFlowState, type SavedDocumentCapture} from './DocumentFlowController';
import {t} from './locales/i18n';

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
  const close = <Action label={t('common.backToIdentity')} secondary testID="document-back-to-identity"
    disabled={finishing} onPress={exit} />;
  const title = state.phase === 'front' ? t('license.title.front') : state.phase === 'back' ? t('license.title.back') :
    state.phase === 'frontReview' ? t('license.title.frontReview') : state.phase === 'result' ? t('license.title.result') :
      state.phase === 'saved' ? t('license.title.saved') : t('license.title.default');
  return <View style={styles.root}>
    {camera ? <View style={styles.camera} accessibilityElementsHidden={!!state.sheet}
      importantForAccessibility={state.sheet ? 'no-hide-descendants' : 'auto'}>
      {state.session && <IdentityCapturePreview key={`document-${state.preview}`} session={state.session}
        kind="document" style={StyleSheet.absoluteFill} />}
      <View style={styles.cameraTop}>
        <Text style={[styles.eyebrow, styles.white]}>{t('license.step', {step: state.phase === 'front' ? 1 : 2, total: 2})}</Text>
        <Text accessibilityRole="header" style={[styles.title, styles.white]}>{title}</Text>
        <Text style={[styles.body, styles.white]}>{t('license.cameraHint')}</Text>
      </View>
      <View style={styles.cameraBottom}>
        <Text style={[styles.body, styles.white]} accessibilityLiveRegion="polite">{documentHint(state)}</Text>
        {action(state.phase === 'front' ? t('license.captureFront') : t('license.captureBack'), controller.capture,
          'capture-document', false, !state.ready || state.capturing)}
        {close}
      </View>
    </View> : <ScrollView contentContainerStyle={styles.content} accessibilityElementsHidden={!!state.sheet}
      importantForAccessibility={state.sheet ? 'no-hide-descendants' : 'auto'}>
      <Text style={styles.eyebrow}>{t('common.eyebrow')}</Text>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {state.phase === 'loading' && <Text style={styles.body} accessibilityLiveRegion="polite">{t('license.loading')}</Text>}
      {state.phase === 'intro' && <>
        <Text style={styles.body}>{t('license.intro.body')}</Text>
        <Text style={styles.body}>{t('license.intro.privacy')}</Text>
        {action(t('license.intro.start'), controller.startFront, 'start-document-front')}
      </>}
      {state.phase === 'saved' && <View style={styles.list} testID="saved-documents-list">
        <Text style={styles.body}>{t('license.saved.choose')}</Text>
        {state.saved.map((choice, index) => <View key={choice.workflowID} style={styles.card}>
          <Text style={styles.sheetTitle}>{t('license.saved.title', {number: index + 1})}</Text>
          <Text style={styles.body}>{choice.hasBack ? t('license.saved.complete') : t('license.saved.frontOnly')}</Text>
          {action(choice.hasBack ? t('license.saved.view') : t('license.saved.continue'), () => controller.recoverSaved(choice.captureID), `saved-document-${index}`)}
        </View>)}
        {action(t('license.saved.scanAnother'), controller.startFront, 'start-document-front', true)}
      </View>}
      {state.phase === 'frontReview' && state.draft?.front && state.session && <>
        <Text style={styles.eyebrow}>{t('license.stepComplete', {step: 1, total: 2})}</Text>
        <IdentityCaptureImage session={state.session} image="documentFront" sha256={state.draft.front.sha256}
          accessibilityLabel={t('license.result.frontImage')} style={styles.documentPreview} />
        <Text style={styles.body}>{t('license.frontReview.body')}</Text>
        {action(t('license.frontReview.scanBack'), controller.startBack, 'start-document-back')}
        {action(t('license.frontReview.retakeFront'), controller.startFront, 'retake-document-front', true)}
      </>}
      {state.phase === 'result' && state.completed && state.session && <>
        <DocumentResultDetails result={{session: state.session, document: state.completed}} />
        <DocumentCheckPanel key={state.completed.front?.captureID} session={state.session} configured={!!configuration.document?.check} />
        {action(t('common.done'), finish, 'finish-document')}
        {action(t('license.retake'), controller.startFront, 'start-document-front', true)}
      </>}
      {state.busy && state.phase !== 'loading' && <Text style={styles.body} accessibilityLiveRegion="polite">{t('common.pleaseWait')}</Text>}
      {close}
    </ScrollView>}
    {state.sheet && <View style={styles.scrim}>
      <View style={styles.sheet} accessibilityViewIsModal testID="document-bottom-sheet">
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>{state.sheet.title}</Text>
          <Text style={styles.body}>{state.sheet.message}</Text>
          {state.sheet.recovery === 'details' ? close : <>
            {state.sheet.recovery === 'settings' && action(t('common.openSettings'), () => Linking.openSettings(), 'document-open-settings')}
            {action(state.sheet.recovery === 'settings' ? t('common.tryCameraAgain') : t('common.tryAgain'), controller.retry, 'retry-document')}
            {close}
          </>}
        </ScrollView>
      </View>
    </View>}
  </View>;
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

export function documentName(document: DocumentObservation): string {
  const fields = document.back?.pdf417?.fields ?? {};
  return fields.DAA || [fields.DAC, fields.DAD, fields.DCS].filter(Boolean).join(' ') || t('license.title.default');
}
export function DocumentResultDetails({result}: {result: SavedDocumentCapture}) {
  const {document, session} = result;
  const [details, setDetails] = useState(false);
  const barcode = document.back?.pdf417;
  const fields = barcode?.fields ?? {};
  const address = [fields.DAG, fields.DAH, fields.DAI, fields.DAJ, fields.DAK].filter(Boolean).join('\n');
  return <>
    <View style={styles.card} testID="document-result">
      <Text accessibilityRole="header" style={styles.sheetTitle}>{t('license.result.photos')}</Text>
      {document.front && <>
        <Text style={styles.label}>{t('license.result.front')}</Text>
        <IdentityCaptureImage key={document.front.sha256} session={session} image="documentFront" sha256={document.front.sha256}
          accessibilityLabel={t('license.result.frontImage')} style={styles.documentImage} />
      </>}
      {document.back ? <>
        <Text style={styles.label}>{t('license.result.back')}</Text>
        <IdentityCaptureImage key={document.back.sha256} session={session} image="documentBack" sha256={document.back.sha256}
          accessibilityLabel={t('license.result.backImage')} style={styles.documentImage} />
      </> : <Text style={styles.body}>{t('license.result.backNeeded')}</Text>}
    </View>
    {document.back && <View style={styles.card} testID="document-barcode-details">
      <Text accessibilityRole="header" style={styles.sheetTitle}>{t('license.result.barcodeTitle')}</Text>
      <Text style={styles.body} testID="document-barcode-status">{barcodeStatus(document.back)}</Text>
      {(fields.DAA || fields.DCS || fields.DAC) && <Detail label={t('license.result.name')} value={documentName(document)} />}
      {fields.DAQ && <Detail label={t('license.result.licenseNumber')} value={fields.DAQ} />}
      {fields.DBB && <Detail label={t('license.result.birthDate')} value={fields.DBB} />}
      {fields.DBA && <Detail label={t('license.result.expiryDate')} value={fields.DBA} />}
      {address && <Detail label={t('license.result.address')} value={address} />}
    </View>}
    {barcode && <Action label={details ? t('license.result.hideAll') : t('license.result.showAll')} secondary onPress={() => setDetails(!details)} />}
    {details && barcode && <View style={styles.card}>
      {Object.entries(fields).map(([field, value]) => <Detail key={field} label={fieldLabels[field] ?? t('license.result.unknownField', {code: field})} value={value} />)}
      {!!barcode.missingRequiredElements.length && <Detail label={t('license.result.missingElements')} value={barcode.missingRequiredElements.map(field => fieldLabels[field] ?? field).join(t('common.listSeparator'))} />}
    </View>}
  </>;
}
const fieldLabels: Record<string, string> = {
  DAA: t('license.field.DAA'), DCS: t('license.field.DCS'), DAC: t('license.field.DAC'), DAD: t('license.field.DAD'),
  DAQ: t('license.field.DAQ'), DBB: t('license.field.DBB'), DBA: t('license.field.DBA'), DBD: t('license.field.DBD'),
  DAG: t('license.field.DAG'), DAH: t('license.field.DAH'), DAI: t('license.field.DAI'), DAJ: t('license.field.DAJ'),
  DAK: t('license.field.DAK'), DCG: t('license.field.DCG'), DBC: t('license.field.DBC'), DAY: t('license.field.DAY'),
  DAU: t('license.field.DAU'), DAW: t('license.field.DAW'), DCA: t('license.field.DCA'), DCB: t('license.field.DCB'),
  DCD: t('license.field.DCD'), DCF: t('license.field.DCF'), DDA: t('license.field.DDA'), DDB: t('license.field.DDB'),
};
/** Each decoder and parser state has its own text; none of them is issuer validation. */
function barcodeStatus(back: DocumentSideObservation): string {
  switch (back.pdf417Status) {
    case 'notFound': return t('license.barcode.notFound');
    case 'ambiguous': return t('license.barcode.ambiguous');
    case 'failed': return t('license.barcode.failed');
    case 'notRequested': return t('license.barcode.notRequested');
    case 'readable': switch (back.pdf417?.status) {
      case 'readable': return back.pdf417.missingRequiredElements.length
        ? t('license.barcode.readableMissing')
        : t('license.barcode.readable');
      case 'malformed': return t('license.barcode.malformed');
      case 'unsupported': return t('license.barcode.unsupported');
      case undefined: return t('license.barcode.unread');
    }
  }
}
function Detail({label, value}: {label: string; value: string}) {
  return <View style={styles.detail}><Text style={styles.label}>{label}</Text><Text style={styles.body}>{value}</Text></View>;
}
