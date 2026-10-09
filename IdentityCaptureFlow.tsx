import type { Configuration, PassportObservation } from '@kenshiki/identity-capture';
import {
  IdentityCaptureImage,
  IdentityCapturePreview,
  IdentityCaptureSession,
} from '@kenshiki/identity-capture';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CaptureFlowController, type CompletedCapture, type FlowState } from './CaptureFlowController';
import { formatMoment } from './HolderText';
import { t } from './locales/i18n';
import { border, color, opacity, radius, size, spacing, text } from './ui/tokens.generated';

/** Completion transfers the session to the adopter. Cancellation releases it. */
export function IdentityCaptureFlow({
  configuration,
  onExit,
  onComplete,
  completed,
  resume,
}: {
  configuration: Configuration;
  onExit: () => void;
  onComplete: (result: CompletedCapture) => void;
  completed?: CompletedCapture | undefined;
  resume?: ('selfie' | 'read') | undefined;
}) {
  const [state, setState] = useState<FlowState>({ phase: 'intro', busy: false, ready: false, preview: 0 });
  const [controller, setController] = useState<CaptureFlowController>();
  const [width, setWidth] = useState(0);
  const handoffStarted = useRef(false);
  const [finishing, setFinishing] = useState(false);
  useEffect(() => {
    const active = new CaptureFlowController(
      IdentityCaptureSession.create,
      configuration,
      setState,
      completed,
    );
    setController(active);
    setState(active.state);
    if (resume === 'selfie') active.selfie().catch(active.fail);
    if (resume === 'read') active.read().catch(active.fail);
    if (!resume) active.open().catch(active.fail);
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'background') active.pause().catch(active.fail);
    });
    return () => {
      listener.remove();
      active.dispose().catch(active.fail);
    };
  }, [configuration, completed, resume]);
  if (!controller) return <View style={styles.root} />;
  const activeController = controller;
  const { phase, sheet } = state;
  const camera = phase === 'scanning' || phase === 'selfie';
  const finish = async () => {
    if (handoffStarted.current) return;
    handoffStarted.current = true;
    setFinishing(true);
    try {
      onComplete(await activeController.handoff());
    } catch (error) {
      handoffStarted.current = false;
      setFinishing(false);
      activeController.fail(error);
    }
  };
  const title = phaseTitles[phase];
  const action = (label: string, press: () => unknown, disabled = false, id?: string, secondary = false) => (
    <Action
      label={label}
      onPress={press}
      disabled={state.busy || finishing || disabled}
      testID={id}
      secondary={secondary}
    />
  );
  const result =
    state.session && state.passport
      ? {
          session: state.session,
          mrz: state.mrz,
          passport: state.passport,
          comparison: state.comparison,
        }
      : undefined;
  const close = (
    <Action
      label={state.passport ? t('common.backToIdentity') : t('passport.closeCheck')}
      secondary
      disabled={finishing || (!!state.passport && state.busy)}
      onPress={async () => {
        if (state.passport) await finish();
        else {
          await activeController.dispose();
          onExit();
        }
      }}
    />
  );
  function renderCaptureStage() {
    if (camera) {
      return renderCamera();
    }
    return (
      <ScrollView
        accessibilityElementsHidden={!!sheet}
        importantForAccessibility={sheet ? 'no-hide-descendants' : 'auto'}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.eyebrow}>{t('common.eyebrow')}</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {phase === 'loading' && <Text style={styles.body}>{t('common.openingSavedResults')}</Text>}
        {phase === 'saved' && (
          <>
            <Text style={styles.body}>{t('passport.saved.choose')}</Text>
            {state.saved?.map((record, index) => (
              <View key={record.workflowID} style={styles.card}>
                <Text style={styles.body}>
                  {t('passport.saved.savedAt', { moment: formatMoment(record.recordedAt) })}
                </Text>
                {action(
                  t('passport.saved.open'),
                  () => activeController.recoverSaved(record.workflowID),
                  false,
                  `saved-passport-${index}`,
                )}
              </View>
            ))}
            {action(t('passport.saved.scanAnother'), activeController.restart, false, 'new-passport', true)}
          </>
        )}
        {phase === 'intro' && (
          <>
            <Text style={styles.body}>{t('passport.intro.body')}</Text>
            <Text style={styles.body}>{t('passport.intro.privacy')}</Text>
            {action(t('passport.intro.start'), activeController.scan, false, 'start-passport-scan')}
          </>
        )}
        {phase === 'review' && state.mrz && (
          <>
            <Text style={styles.body}>{t('passport.review.body')}</Text>
            <Details
              label={t('passport.field.name')}
              value={`${state.mrz.givenNames} ${state.mrz.surname}`.replace(/<+/g, ' ')}
            />
            <Details label={t('passport.field.documentNumber')} value={state.mrz.documentNumber} />
            <Details label={t('passport.field.birthDate')} value={displayDate(state.mrz.birthDateYYMMDD)} />
            <Details label={t('passport.field.expiryDate')} value={displayDate(state.mrz.expiryDateYYMMDD)} />
            <Text style={styles.body}>{t('passport.review.next')}</Text>
            {action(t('passport.review.read'), activeController.read, false, 'read-passport')}
            {action(t('passport.review.scanAgain'), activeController.scan, false, undefined, true)}
          </>
        )}
        {phase === 'reading' && (
          <Text style={styles.body} accessibilityLiveRegion="polite">
            {state.progress}
          </Text>
        )}
        {(phase === 'passport' || phase === 'result') && result && (
          <>
            <CaptureResultDetails result={result} focus={phase === 'result' ? 'face' : 'passport'} />
            {action(t('common.done'), finish, false, 'finish-capture')}
            {action(
              state.comparison ? t('passport.action.retakeSelfie') : t('passport.action.compareSelfie'),
              activeController.selfie,
              !state.passport?.portraitAvailable || !configuration.embedderURL || !configuration.detectorURL,
              'retake-selfie',
              true,
            )}
            {action(
              t('passport.action.readChipAgain'),
              activeController.read,
              false,
              'reread-passport',
              true,
            )}
          </>
        )}
        {(phase === 'captured' || phase === 'comparing') && (
          <Text style={styles.body} accessibilityLiveRegion="polite">
            {t('passport.comparing')}
          </Text>
        )}
        {state.busy && phase !== 'comparing' && (
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            {t('common.pleaseWait')}
          </Text>
        )}
        {phase !== 'intro' && (
          <Action
            label={t('passport.scanDifferent')}
            onPress={activeController.requestRestart}
            secondary
            testID="restart-check"
          />
        )}
        {close}
      </ScrollView>
    );
  }
  function renderRecovery() {
    if (!sheet) return null;
    return (
      <View style={styles.scrim}>
        <View accessibilityViewIsModal style={styles.sheet} testID="capture-bottom-sheet">
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              {sheet.kind === 'restart' ? t('passport.sheet.restartTitle') : t('common.letsTryAgain')}
            </Text>
            <Text style={styles.body}>{sheet.message}</Text>
            {renderRecoveryActions()}
          </ScrollView>
        </View>
      </View>
    );
  }
  function renderCamera() {
    return (
      <View
        style={styles.camera}
        accessibilityElementsHidden={!!sheet}
        importantForAccessibility={sheet ? 'no-hide-descendants' : 'auto'}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {state.session && (
          <IdentityCapturePreview
            key={`${phase}-${state.preview}`}
            session={state.session}
            kind={phase === 'scanning' ? 'mrz' : 'selfie'}
            style={StyleSheet.absoluteFill}
          />
        )}
        {phase === 'selfie' && (
          <View pointerEvents="none" style={styles.guideCenter}>
            <View
              style={[
                styles.oval,
                {
                  width: width * size.selfieGuideWidth,
                  height: width * size.selfieGuideWidth * size.selfieGuideAspect,
                },
              ]}
            />
          </View>
        )}
        <View style={styles.cameraTop}>
          <Text accessibilityRole="header" style={[styles.title, styles.white]}>
            {title}
          </Text>
          <Text style={[styles.body, styles.white]}>
            {phase === 'scanning' ? t('passport.camera.scanHint') : state.hint}
          </Text>
        </View>
        <View style={styles.cameraBottom}>
          {scanHint()}
          {close}
        </View>
      </View>
    );
  }
  function renderRecoveryActions() {
    if (!sheet) return null;
    if (sheet.kind === 'restart') {
      return (
        <>
          {action(t('common.startOver'), activeController.restart, false, 'confirm-restart')}
          {action(t('passport.sheet.keepCheck'), activeController.recover, false, undefined, true)}
        </>
      );
    }
    return (
      <>
        {renderRecoveryChoice()}
        {state.passport && action(t('passport.sheet.keepResults'), finish, false, 'keep-passport', true)}
        {action(t('common.startOver'), activeController.restart, false, 'confirm-restart', true)}
      </>
    );
  }
  function scanHint() {
    if (phase === 'scanning') {
      return (
        <>
          <Text style={[styles.body, styles.white]} accessibilityLiveRegion="polite">
            {state.mrz?.completeness === 'complete'
              ? t('passport.camera.ready')
              : state.mrz
                ? t('passport.camera.keepInView')
                : t('passport.camera.holdSteady')}
          </Text>
          {action(
            t('passport.camera.captureDetails'),
            activeController.review,
            state.mrz?.completeness !== 'complete',
            'capture-mrz',
          )}
        </>
      );
    }
    return action(t('passport.camera.captureSelfie'), activeController.capture, !state.ready);
  }
  function backToDetailsLabel() {
    if (state.passport) return t('common.backToResults');
    if (state.mrz) return t('passport.sheet.backToDetails');
    return t('common.backToIdentity');
  }
  function renderRecoveryChoice() {
    if (!sheet) return null;
    if (sheet.recovery === 'details') {
      return action(
        backToDetailsLabel(),
        state.passport || state.mrz
          ? activeController.recover
          : async () => {
              await activeController.dispose();
              onExit();
            },
        false,
        'back-to-details',
      );
    }
    return (
      <>
        {sheet.recovery === 'settings' &&
          action(t('common.openSettings'), () => Linking.openSettings(), false, 'open-camera-settings')}
        {action(
          sheet.recovery === 'save'
            ? t('passport.sheet.saveCompleted')
            : sheet.recovery === 'settings'
              ? t('common.tryCameraAgain')
              : t('common.tryAgain'),
          activeController.recover,
          false,
          'retry-capture',
        )}
      </>
    );
  }
  return (
    <View style={styles.root}>
      {renderCaptureStage()}
      {renderRecovery()}
    </View>
  );
}

const protocolLabels: Record<keyof PassportObservation['protocols'], string> = {
  countrySigningChain: t('passport.protocol.countrySigningChain'),
  documentSignature: t('passport.protocol.documentSignature'),
  dataGroupHashes: t('passport.protocol.dataGroupHashes'),
  activeAuthentication: t('passport.protocol.activeAuthentication'),
  chipAuthentication: t('passport.protocol.chipAuthentication'),
  pace: t('passport.protocol.pace'),
  basicAccessControl: t('passport.protocol.basicAccessControl'),
};
const correspondenceLabels = {
  documentNumber: t('passport.field.documentNumber'),
  birthDate: t('passport.field.birthDate'),
  expiryDate: t('passport.field.expiryDate'),
  surname: t('passport.field.surname'),
  givenNames: t('passport.field.givenNames'),
};
const outcomeLabels: Record<string, string> = {
  pass: t('face.outcome.pass'),
  fail: t('face.outcome.fail'),
  manual_review: t('face.outcome.manualReview'),
};
const failureLabels: Record<keyof PassportObservation['protocols'], string> = {
  countrySigningChain: t('passport.protocolFailed.countrySigningChain'),
  documentSignature: t('passport.protocolFailed.documentSignature'),
  dataGroupHashes: t('passport.protocolFailed.dataGroupHashes'),
  activeAuthentication: t('passport.protocolFailed.activeAuthentication'),
  chipAuthentication: t('passport.protocolFailed.chipAuthentication'),
  pace: t('passport.protocolFailed.pace'),
  basicAccessControl: t('passport.protocolFailed.basicAccessControl'),
};
const protocolStatus = {
  succeeded: t('passport.protocolStatus.succeeded'),
  failed: t('passport.protocolStatus.failed'),
  notPerformed: t('passport.protocolStatus.notPerformed'),
};

export function CaptureResultDetails({
  result,
  focus = 'passport',
}: {
  result: CompletedCapture;
  focus?: ('passport' | 'face') | undefined;
}) {
  const { passport, comparison, session } = result;
  const [technical, setTechnical] = useState(false);
  const depth = comparison?.admissionReceipt.depthEvidence;
  const referenceSHA = comparison?.referenceSHA256 ?? passport.portraitSHA256;
  // The SDK compares and restores only selfies whose TrueDepth face depth was measured and accepted.
  function renderFaceCard() {
    return (
      <View style={styles.card} testID="face-result">
        <Text accessibilityRole="header" style={styles.sheetTitle}>
          {t('face.title')}
        </Text>
        {!comparison ? (
          <Text style={styles.body}>{t('face.notTaken')}</Text>
        ) : !depth ? (
          <Text style={styles.body}>{t('face.noDepth')}</Text>
        ) : (
          <>
            <Text style={styles.body}>{outcomeLabels[comparison.outcome] ?? t('face.outcome.other')}</Text>
            {comparison.savedResult && (
              <Details label={t('face.checkedAt')} value={formatMoment(comparison.savedResult.recordedAt)} />
            )}
            <Details label={t('face.depth')} value={t('face.depthMeasured')} />
            <Details
              label={t('face.expression')}
              value={comparison.admissionReceipt.eyesOpen ? t('face.blinkCompleted') : t('face.notAvailable')}
            />
          </>
        )}
      </View>
    );
  }
  const failed = protocolKeys.filter((key) => passport.protocols[key] === 'failed');
  function renderTechnicalDetails() {
    if (!technical) return null;
    return (
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>
          {t('passport.details.title')}
        </Text>
        <Details label={t('passport.field.sex')} value={passport.sex} />
        {passport.personalNumber && (
          <Details label={t('passport.field.personalNumber')} value={passport.personalNumber} />
        )}
        {protocolKeys.map((key) => (
          <Details key={key} label={protocolLabels[key]} value={protocolStatus[passport.protocols[key]]} />
        ))}
        {comparison && depth && (
          <>
            <Details label={t('face.technical.similarity')} value={String(comparison.similarity)} />
            <Details label={t('face.technical.route')} value={comparison.route} />
            {depth && (
              <>
                <Details
                  label={t('face.technical.relief')}
                  value={
                    depth.measurement.residualRMS == null
                      ? t('face.technical.unavailable')
                      : String(depth.measurement.residualRMS)
                  }
                />
                <Details label={t('face.technical.samples')} value={String(depth.measurement.sampleCount)} />
                <Details label={t('face.technical.age')} value={String(depth.ageAtAdmission)} />
                <Details
                  label={t('face.technical.smoothing')}
                  value={depth.filtered ? t('face.technical.filtered') : t('face.technical.unfiltered')}
                />
                <Details label={t('face.technical.policy')} value={depth.measurement.policy.identifier} />
                <Details
                  label={t('face.technical.minimumRelief')}
                  value={String(depth.measurement.policy.minimumResidualRMS)}
                />
                <Details
                  label={t('face.technical.minimumSamples')}
                  value={String(depth.measurement.policy.minimumSamples)}
                />
                <Details
                  label={t('face.technical.maximumAge')}
                  value={String(depth.measurement.policy.maximumDepthAge)}
                />
                <Details
                  label={t('face.technical.window')}
                  value={t('face.technical.windowRange', {
                    near: depth.measurement.policy.nearLimit,
                    far: depth.measurement.policy.farLimit,
                  })}
                />
                <Details
                  label={t('face.technical.samplesPerAxis')}
                  value={String(depth.measurement.policy.samplesPerAxis)}
                />
              </>
            )}
            <Details
              label={t('face.technical.blinkAge')}
              value={String(comparison.admissionReceipt.blinkAge)}
            />
            <Details
              label={t('face.technical.steadyHold')}
              value={String(comparison.admissionReceipt.steadyHoldDuration)}
            />
            <Details
              label={t('face.technical.modelLoading')}
              value={String(comparison.modelLoadingSeconds)}
            />
            <Details
              label={t('face.technical.comparisonTime')}
              value={String(comparison.comparisonSeconds)}
            />
            <Details label={t('face.technical.referenceDigest')} value={comparison.referenceSHA256} />
            <Details label={t('face.technical.selfieDigest')} value={comparison.selfieSHA256} />
          </>
        )}
      </View>
    );
  }
  return (
    <>
      {focus === 'face' && renderFaceCard()}
      <View style={styles.card} testID="passport-result">
        <Text accessibilityRole="header" style={styles.sheetTitle}>
          {t('passport.result.title')}
        </Text>
        {passport.protocolVerdicts.source === 'recorded' ? (
          <Details
            label={t('passport.result.chipChecksRecorded')}
            value={t('passport.result.chipChecksRecordedAt', {
              moment: formatMoment(passport.protocolVerdicts.recordedAt),
            })}
          />
        ) : (
          passport.savedResult && (
            <Details
              label={t('passport.result.readAt')}
              value={formatMoment(passport.savedResult.recordedAt)}
            />
          )
        )}
        {!!failed.length && (
          <View style={styles.detail} testID="passport-protocol-failures">
            {failed.map((key) => (
              <Text key={key} style={styles.body}>
                {failureLabels[key]}
              </Text>
            ))}
            <Text style={styles.body}>{t('passport.result.failedNotice')}</Text>
          </View>
        )}
        <View style={styles.portraits}>
          {referenceSHA && (
            <View style={styles.portrait}>
              <IdentityCaptureImage
                key={referenceSHA}
                session={session}
                image="reference"
                sha256={referenceSHA}
                accessibilityLabel={t('passport.result.chipPhoto')}
                style={styles.image}
              />
              <Text style={styles.label}>{t('passport.result.passportPhoto')}</Text>
            </View>
          )}
          {comparison && (
            <View style={styles.portrait}>
              <IdentityCaptureImage
                key={comparison.selfieSHA256}
                session={session}
                image="selfie"
                sha256={comparison.selfieSHA256}
                accessibilityLabel={t('passport.result.comparedSelfie')}
                style={styles.image}
              />
              <Text style={styles.label}>{t('passport.result.yourSelfie')}</Text>
            </View>
          )}
        </View>
        <Details
          label={t('passport.field.name')}
          value={`${passport.givenNames} ${passport.surname}`.replace(/<+/g, ' ')}
        />
        <Details label={t('passport.field.documentNumber')} value={passport.documentNumber} />
        <Details label={t('passport.field.birthDate')} value={displayDate(passport.birthDateYYMMDD)} />
        <Details label={t('passport.field.expiryDate')} value={displayDate(passport.expiryDateYYMMDD)} />
        <Details label={t('passport.field.nationality')} value={passport.nationality} />
        <Details label={t('passport.field.issuedBy')} value={passport.issuingState} />
        {passport.placeOfBirth && (
          <Details label={t('passport.field.placeOfBirth')} value={passport.placeOfBirth} />
        )}
        {passport.issuingAuthority && (
          <Details label={t('passport.field.issuingAuthority')} value={passport.issuingAuthority} />
        )}
        {passport.dateOfIssue && (
          <Details label={t('passport.field.dateOfIssue')} value={passport.dateOfIssue} />
        )}
        {!passport.portraitAvailable && <Text style={styles.body}>{t('passport.result.noPortrait')}</Text>}
        <Text accessibilityRole="header" style={styles.label}>
          {t('passport.result.correspondenceHeading')}
        </Text>
        {Object.entries(passport.correspondence).map(([field, observation]) => (
          <Details
            key={field}
            label={correspondenceLabel(field)}
            value={
              observation === 'matches'
                ? t('passport.result.matches')
                : observation === 'differs'
                  ? t('passport.result.differs')
                  : t('passport.result.notCompared')
            }
          />
        ))}
        {!Object.keys(passport.correspondence).length && (
          <Text style={styles.body}>{t('passport.result.noCorrespondence')}</Text>
        )}
      </View>
      {focus === 'passport' && renderFaceCard()}
      <Action
        secondary
        label={technical ? t('passport.details.hide') : t('passport.details.show')}
        onPress={() => setTechnical(!technical)}
      />
      {renderTechnicalDetails()}
    </>
  );
}
/** A machine-readable-zone date (YYMMDD) as day, month and two-digit year; the century is unknown. */
function displayDate(raw: string): string {
  if (!/^\d{6}$/.test(raw)) return raw;
  const month = Number(raw.slice(2, 4));
  return month >= 1 && month <= 12
    ? t('format.mrzDate', { day: Number(raw.slice(4)), month: `m${raw.slice(2, 4)}`, year: raw.slice(0, 2) })
    : raw;
}
function Details({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.body}>{value}</Text>
    </View>
  );
}
export function Action({
  label,
  onPress,
  disabled = false,
  testID,
  secondary = false,
}: {
  label: string;
  onPress: () => unknown;
  disabled?: boolean | undefined;
  testID?: string | undefined;
  secondary?: boolean | undefined;
}) {
  const [failure, setFailure] = useState(false);
  const press = () => {
    setFailure(false);
    try {
      Promise.resolve(onPress()).catch(() => setFailure(true));
    } catch {
      setFailure(true);
    }
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        testID={testID}
        onPress={press}
        style={[styles.action, secondary && styles.secondary, disabled && styles.disabled]}
      >
        <Text style={[styles.actionText, secondary && styles.secondaryText]}>{label}</Text>
      </Pressable>
      {failure && (
        <Text accessibilityRole="alert" style={styles.body}>
          {t('common.actionFailed')}
        </Text>
      )}
    </>
  );
}
export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxxl },
  eyebrow: { ...text.eyebrow, color: color.secondaryText },
  title: { ...text.screenTitle, color: color.text },
  body: { ...text.body, color: color.text },
  label: { ...text.label, color: color.secondaryText },
  detail: { gap: spacing.xxs },
  card: { padding: spacing.lg, gap: spacing.md, backgroundColor: color.card, borderRadius: radius.card },
  portraits: { flexDirection: 'row', gap: spacing.sm },
  portrait: { flex: 1, gap: spacing.xs },
  image: { aspectRatio: size.portraitAspectRatio, width: '100%' },
  camera: { flex: 1, backgroundColor: color.cameraBackground, justifyContent: 'space-between' },
  cameraTop: { padding: spacing.xl, gap: spacing.sm },
  cameraBottom: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.sm },
  white: { color: color.onCamera },
  guideCenter: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oval: { borderWidth: border.guide, borderColor: color.onCamera, borderRadius: radius.full },
  action: {
    backgroundColor: color.tint,
    padding: spacing.md,
    minHeight: size.actionMinHeight,
    borderRadius: radius.control,
    alignItems: 'center',
  },
  actionText: { ...text.action, color: color.onTint, textAlign: 'center' },
  disabled: { opacity: opacity.disabled },
  secondary: { backgroundColor: color.secondaryFill },
  secondaryText: { color: color.tint },
  scrim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: color.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: color.sheet,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    maxHeight: size.sheetMaxHeight,
  },
  sheetContent: { padding: spacing.xxl, paddingBottom: spacing.xxxl, gap: spacing.xl },
  sheetTitle: { ...text.sectionTitle, color: color.text },
  entry: { ...text.entry, color: color.text },
  list: { gap: spacing.md },
  group: { gap: spacing.sm },
  documentPreview: { height: size.documentPreviewHeight },
  documentImage: { height: size.documentImageHeight },
  developerContent: { padding: spacing.xl, gap: spacing.md },
  developerTitle: { ...text.developerTitle, color: color.text },
  developerPreview: { height: size.developerPreviewHeight },
});

const protocolKeys = [
  'basicAccessControl',
  'pace',
  'activeAuthentication',
  'chipAuthentication',
  'countrySigningChain',
  'documentSignature',
  'dataGroupHashes',
] as const;
function correspondenceLabel(field: string): string {
  const entry = Object.entries(correspondenceLabels).find(([key]) => key === field);
  return entry?.[1] ?? field;
}

const phaseTitles: Record<FlowState['phase'], string> = {
  intro: t('passport.title.intro'),
  loading: t('passport.title.loading'),
  saved: t('passport.title.saved'),
  scanning: t('passport.title.scanning'),
  review: t('passport.title.review'),
  reading: t('passport.title.reading'),
  passport: t('passport.title.results'),
  result: t('passport.title.results'),
  comparing: t('passport.title.comparing'),
  captured: t('passport.title.comparing'),
  selfie: t('passport.title.selfie'),
};
