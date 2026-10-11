import type { Configuration, DocumentObservation, DocumentSideObservation } from '@kenshiki/identity-capture';
import {
  IdentityCaptureImage,
  IdentityCapturePreview,
  IdentityCaptureSession,
} from '@kenshiki/identity-capture';
import { useCallback, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { DocumentCheckPanel } from './DocumentCheckPanel';
import {
  DocumentFlowController,
  type DocumentFlowState,
  type SavedDocumentCapture,
} from './DocumentFlowController';
import { DocumentInspection } from './DocumentInspection';
import { t } from './locales/i18n';
import { Action } from './ui/Action';
import { ControllerStartup } from './ui/ControllerStartup';
import { connectBackground } from './ui/connectBackground';
import { NativeSheet } from './ui/NativeSheet';
import { Page } from './ui/Page';
import { styles } from './ui/styles';
import { useControllerState } from './ui/useControllerState';

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
  const exit = async () => {
    if (!controller || finishingRef.current) return;
    if (state.completed || state.draft?.front) {
      await finish();
      return;
    }
    finishingRef.current = true;
    setFinishing(true);
    await controller.dispose();
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
        {state.phase === 'result' && state.completed && state.session && (
          <>
            <DocumentCheckPanel
              key={state.completed.front?.captureID}
              session={state.session}
              onRetake={() => {
                activeController.startFront().catch(activeController.fail);
              }}
              configured={!!configuration.document?.check}
            />
            <DocumentResultDetails result={{ session: state.session, document: state.completed }} />
            <Action
              label={t('common.done')}
              onPress={finish}
              disabled={state.busy || finishing}
              testID="finish-document"
            />
            {action(t('license.retake'), activeController.startFront, 'start-document-front', true)}
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
        <Text style={styles.body}>{t('license.saved.choose')}</Text>
        {state.saved.map((choice, index) => (
          <View key={choice.workflowID} style={styles.card}>
            <Text style={styles.sheetTitle}>{t('license.saved.title', { number: index + 1 })}</Text>
            <Text style={styles.body}>
              {choice.hasBack ? t('license.saved.complete') : t('license.saved.frontOnly')}
            </Text>
            {action(
              choice.hasBack ? t('license.saved.view') : t('license.saved.continue'),
              () => activeController.recoverSaved(choice.captureID),
              `saved-document-${index}`,
            )}
          </View>
        ))}
        {action(t('license.saved.scanAnother'), activeController.startFront, 'start-document-front', true)}
      </View>
    );
  }
  return (
    <Page
      title={title}
      mode={camera ? 'camera' : 'scroll'}
      onClose={dismiss}
      covered={!!state.sheet}
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

function documentName(document: DocumentObservation): string {
  const fields = document.back?.pdf417?.fields ?? {};
  return (
    fields.DAA || [fields.DAC, fields.DAD, fields.DCS].filter(Boolean).join(' ') || t('license.title.default')
  );
}
export function DocumentResultDetails({ result }: Readonly<{ result: SavedDocumentCapture }>) {
  const { document } = result;
  const [details, setDetails] = useState(false);
  const barcode = document.back?.pdf417;
  const fields = barcode?.fields ?? {};
  const address = [fields.DAG, fields.DAH, fields.DAI, fields.DAJ, fields.DAK].filter(Boolean).join('\n');
  return (
    <>
      <DocumentInspection result={result} />
      {document.back && (
        <View style={styles.card} testID="document-barcode-details">
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {t('license.result.barcodeTitle')}
          </Text>
          <Text style={styles.body} testID="document-barcode-status">
            {barcodeStatus(document.back)}
          </Text>
          {!!(fields.DAA || fields.DCS || fields.DAC) && (
            <Detail label={t('license.result.name')} value={documentName(document)} />
          )}
          {!!fields.DAQ && <Detail label={t('license.result.licenseNumber')} value={fields.DAQ} />}
          {!!fields.DBB && <Detail label={t('license.result.birthDate')} value={fields.DBB} />}
          {!!fields.DBA && <Detail label={t('license.result.expiryDate')} value={fields.DBA} />}
          {address.length > 0 && <Detail label={t('license.result.address')} value={address} />}
        </View>
      )}
      {barcode && (
        <Action
          label={details ? t('license.result.hideAll') : t('license.result.showAll')}
          secondary
          onPress={() => setDetails(!details)}
        />
      )}
      {details && barcode && (
        <View style={styles.card}>
          {Object.entries(fields).map(([field, value]) => (
            <Detail
              key={field}
              label={fieldLabels[field] ?? t('license.result.unknownField', { code: field })}
              value={value}
            />
          ))}
          {!!barcode.missingRequiredElements.length && (
            <Detail
              label={t('license.result.missingElements')}
              value={barcode.missingRequiredElements
                .map((field) => fieldLabels[field] ?? field)
                .join(t('common.listSeparator'))}
            />
          )}
        </View>
      )}
    </>
  );
}
const fieldLabels: Record<string, string> = {
  DAA: t('license.field.DAA'),
  DCS: t('license.field.DCS'),
  DAC: t('license.field.DAC'),
  DAD: t('license.field.DAD'),
  DAQ: t('license.field.DAQ'),
  DBB: t('license.field.DBB'),
  DBA: t('license.field.DBA'),
  DBD: t('license.field.DBD'),
  DAG: t('license.field.DAG'),
  DAH: t('license.field.DAH'),
  DAI: t('license.field.DAI'),
  DAJ: t('license.field.DAJ'),
  DAK: t('license.field.DAK'),
  DCG: t('license.field.DCG'),
  DBC: t('license.field.DBC'),
  DAY: t('license.field.DAY'),
  DAU: t('license.field.DAU'),
  DAW: t('license.field.DAW'),
  DCA: t('license.field.DCA'),
  DCB: t('license.field.DCB'),
  DCD: t('license.field.DCD'),
  DCF: t('license.field.DCF'),
  DDA: t('license.field.DDA'),
  DDB: t('license.field.DDB'),
};
/** Each decoder and parser state has its own text; none of them is issuer validation. */
function barcodeStatus(back: DocumentSideObservation): string {
  switch (back.pdf417Status) {
    case 'notFound':
      return t('license.barcode.notFound');
    case 'ambiguous':
      return t('license.barcode.ambiguous');
    case 'failed':
      return t('license.barcode.failed');
    case 'notRequested':
      return t('license.barcode.notRequested');
    case 'readable':
      switch (back.pdf417?.status) {
        case 'readable':
          return back.pdf417.missingRequiredElements.length
            ? t('license.barcode.readableMissing')
            : t('license.barcode.readable');
        case 'malformed':
          return t('license.barcode.malformed');
        case 'unsupported':
          return t('license.barcode.unsupported');
        case undefined:
          return t('license.barcode.unread');
      }
  }
}
function Detail({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View style={styles.detail}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.body}>{value}</Text>
    </View>
  );
}
