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
      label={state.passport ? 'Back to Identity' : 'Close check'}
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
        <Text style={styles.eyebrow}>IDENTITY</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {phase === 'loading' && <Text style={styles.body}>Opening saved results…</Text>}
        {phase === 'saved' && (
          <>
            <Text style={styles.body}>Choose a saved passport check.</Text>
            {state.saved?.map((record, index) => (
              <View key={record.workflowID} style={styles.card}>
                <Text style={styles.body}>{`Saved ${formatMoment(record.recordedAt)}`}</Text>
                {action(
                  'Open saved results',
                  () => activeController.recoverSaved(record.workflowID),
                  false,
                  `saved-passport-${index}`,
                )}
              </View>
            ))}
            {action('Scan another passport', activeController.restart, false, 'new-passport', true)}
          </>
        )}
        {phase === 'intro' && (
          <>
            <Text style={styles.body}>
              Scan the photo page, then hold your phone against the passport to read its chip. You can review
              the passport and compare its photo with a selfie.
            </Text>
            <Text style={styles.body}>
              Your captures stay on this phone. Starting allows camera capture; reading the chip begins when
              you choose to continue.
            </Text>
            {action('Start passport scan', activeController.scan, false, 'start-passport-scan')}
          </>
        )}
        {phase === 'review' && state.mrz && (
          <>
            <Text style={styles.body}>Check these details against your passport.</Text>
            <Details
              label="Name"
              value={`${state.mrz.givenNames} ${state.mrz.surname}`.replace(/<+/g, ' ')}
            />
            <Details label="Passport number" value={state.mrz.documentNumber} />
            <Details label="Date of birth" value={displayDate(state.mrz.birthDateYYMMDD)} />
            <Details label="Expiry date" value={displayDate(state.mrz.expiryDateYYMMDD)} />
            <Text style={styles.body}>
              Next, hold the top of your phone against the passport and keep it still.
            </Text>
            {action('Read passport chip', activeController.read, false, 'read-passport')}
            {action('Scan again', activeController.scan, false, undefined, true)}
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
            {action('Done', finish, false, 'finish-capture')}
            {action(
              state.comparison ? 'Retake selfie' : 'Compare with a selfie',
              activeController.selfie,
              !state.passport?.portraitAvailable || !configuration.embedderURL || !configuration.detectorURL,
              'retake-selfie',
              true,
            )}
            {action('Read chip again', activeController.read, false, 'reread-passport', true)}
          </>
        )}
        {(phase === 'captured' || phase === 'comparing') && (
          <Text style={styles.body} accessibilityLiveRegion="polite">
            Your selfie was captured. Comparing it with the passport photo…
          </Text>
        )}
        {state.busy && phase !== 'comparing' && (
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            Please wait…
          </Text>
        )}
        {phase !== 'intro' && (
          <Action
            label="Scan a different passport"
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
              {sheet.kind === 'restart' ? 'Start a new passport check?' : 'Let’s try that again'}
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
            <View style={[styles.oval, { width: width * 0.68, height: width * 0.68 * 1.3 }]} />
          </View>
        )}
        <View style={styles.cameraTop}>
          <Text accessibilityRole="header" style={[styles.title, styles.white]}>
            {title}
          </Text>
          <Text style={[styles.body, styles.white]}>
            {phase === 'scanning'
              ? 'Put the two lines at the bottom of the photo page inside the clear band.'
              : state.hint}
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
          {action('Start over', activeController.restart, false, 'confirm-restart')}
          {action('Keep this check', activeController.recover, false, undefined, true)}
        </>
      );
    }
    return (
      <>
        {renderRecoveryChoice()}
        {state.passport && action('Keep passport results', finish, false, 'keep-passport', true)}
        {action('Start over', activeController.restart, false, 'confirm-restart', true)}
      </>
    );
  }
  function scanHint() {
    if (phase === 'scanning') {
      return (
        <>
          <Text style={[styles.body, styles.white]} accessibilityLiveRegion="polite">
            {state.mrz?.completeness === 'complete'
              ? 'Printed details found. Ready to capture.'
              : state.mrz
                ? 'Keep both lines in view.'
                : 'Hold the passport steady.'}
          </Text>
          {action(
            'Capture details',
            activeController.review,
            state.mrz?.completeness !== 'complete',
            'capture-mrz',
          )}
        </>
      );
    }
    return action('Capture selfie', activeController.capture, !state.ready);
  }
  function backToDetailsLabel() {
    if (state.passport) return 'Back to results';
    if (state.mrz) return 'Back to passport details';
    return 'Back to Identity';
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
          action('Open Settings', () => Linking.openSettings(), false, 'open-camera-settings')}
        {action(
          sheet.recovery === 'save'
            ? 'Save completed result'
            : sheet.recovery === 'settings'
              ? 'Try camera again'
              : 'Try again',
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
  countrySigningChain: 'Issuer signing chain (revocation and expiry are not checked)',
  documentSignature: 'Chip data signature',
  dataGroupHashes: 'Data integrity',
  activeAuthentication: 'Active authentication',
  chipAuthentication: 'Chip authentication',
  pace: 'PACE connection',
  basicAccessControl: 'BAC connection',
};
const correspondenceLabels = {
  documentNumber: 'Passport number',
  birthDate: 'Date of birth',
  expiryDate: 'Expiry date',
  surname: 'Surname',
  givenNames: 'Given names',
};
const outcomeLabels: Record<string, string> = {
  pass: 'Photos match',
  fail: 'Photos did not match',
  manual_review: 'Needs another look',
};
const failureLabels: Record<keyof PassportObservation['protocols'], string> = {
  countrySigningChain: 'Issuer signing chain failed',
  documentSignature: 'Chip data signature failed',
  dataGroupHashes: 'Data integrity check failed',
  activeAuthentication: 'Active authentication failed',
  chipAuthentication: 'Chip authentication failed',
  pace: 'PACE connection failed',
  basicAccessControl: 'BAC connection failed',
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
          Face comparison
        </Text>
        {!comparison ? (
          <Text style={styles.body}>Not taken yet</Text>
        ) : !depth ? (
          <Text style={styles.body}>
            This comparison has no depth record, so its result is not shown. Take a new selfie to compare
            again.
          </Text>
        ) : (
          <>
            <Text style={styles.body}>
              {outcomeLabels[comparison.outcome] ?? 'Unrecognized comparison result'}
            </Text>
            {comparison.savedResult && (
              <Details label="Checked at" value={formatMoment(comparison.savedResult.recordedAt)} />
            )}
            <Details label="Face depth (TrueDepth camera)" value="Face depth measured with this selfie" />
            <Details
              label="Expression"
              value={
                comparison.admissionReceipt.eyesOpen ? 'Blink completed; eyes reopened' : 'Not available'
              }
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
          Check details
        </Text>
        <Details label="Sex recorded on the chip" value={passport.sex} />
        {passport.personalNumber && <Details label="Personal number" value={passport.personalNumber} />}
        {protocolKeys.map((key) => (
          <Details
            key={key}
            label={protocolLabels[key]}
            value={
              { succeeded: 'Succeeded', failed: 'Failed', notPerformed: 'Not performed' }[
                passport.protocols[key]
              ]
            }
          />
        ))}
        {comparison && depth && (
          <>
            <Details label="Similarity" value={String(comparison.similarity)} />
            <Details label="Comparison route" value={comparison.route} />
            {depth && (
              <>
                <Details
                  label="Face relief (RMS, metres)"
                  value={
                    depth.measurement.residualRMS == null
                      ? 'Unavailable'
                      : String(depth.measurement.residualRMS)
                  }
                />
                <Details label="Depth samples" value={String(depth.measurement.sampleCount)} />
                <Details label="Depth age (seconds)" value={String(depth.ageAtAdmission)} />
                <Details label="Depth smoothing" value={depth.filtered ? 'Filtered' : 'Unfiltered'} />
                <Details label="Depth policy" value={depth.measurement.policy.identifier} />
                <Details
                  label="Minimum relief (metres)"
                  value={String(depth.measurement.policy.minimumResidualRMS)}
                />
                <Details label="Minimum samples" value={String(depth.measurement.policy.minimumSamples)} />
                <Details
                  label="Maximum depth age (seconds)"
                  value={String(depth.measurement.policy.maximumDepthAge)}
                />
                <Details
                  label="Depth window (metres)"
                  value={`${depth.measurement.policy.nearLimit}–${depth.measurement.policy.farLimit}`}
                />
                <Details label="Samples per axis" value={String(depth.measurement.policy.samplesPerAxis)} />
              </>
            )}
            <Details label="Blink age (seconds)" value={String(comparison.admissionReceipt.blinkAge)} />
            <Details
              label="Steady hold (seconds)"
              value={String(comparison.admissionReceipt.steadyHoldDuration)}
            />
            <Details label="Model loading (seconds)" value={String(comparison.modelLoadingSeconds)} />
            <Details label="Comparison time (seconds)" value={String(comparison.comparisonSeconds)} />
            <Details label="Reference SHA-256" value={comparison.referenceSHA256} />
            <Details label="Selfie SHA-256" value={comparison.selfieSHA256} />
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
          Passport
        </Text>
        {passport.protocolVerdicts.source === 'recorded' ? (
          <Details
            label="Chip checks recorded"
            value={`${formatMoment(passport.protocolVerdicts.recordedAt)}. Opening saved results does not repeat them.`}
          />
        ) : (
          passport.savedResult && (
            <Details label="Read at" value={formatMoment(passport.savedResult.recordedAt)} />
          )
        )}
        {!!failed.length && (
          <View style={styles.detail} testID="passport-protocol-failures">
            {failed.map((key) => (
              <Text key={key} style={styles.body}>
                {failureLabels[key]}
              </Text>
            ))}
            <Text style={styles.body}>
              A failed chip check means this passport read should not be relied on. Read the chip again, or
              use another document.
            </Text>
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
                accessibilityLabel="Passport chip photo"
                style={styles.image}
              />
              <Text style={styles.label}>Passport photo</Text>
            </View>
          )}
          {comparison && (
            <View style={styles.portrait}>
              <IdentityCaptureImage
                key={comparison.selfieSHA256}
                session={session}
                image="selfie"
                sha256={comparison.selfieSHA256}
                accessibilityLabel="Compared selfie"
                style={styles.image}
              />
              <Text style={styles.label}>Your selfie</Text>
            </View>
          )}
        </View>
        <Details label="Name" value={`${passport.givenNames} ${passport.surname}`.replace(/<+/g, ' ')} />
        <Details label="Passport number" value={passport.documentNumber} />
        <Details label="Date of birth" value={displayDate(passport.birthDateYYMMDD)} />
        <Details label="Expiry date" value={displayDate(passport.expiryDateYYMMDD)} />
        <Details label="Nationality" value={passport.nationality} />
        <Details label="Issued by" value={passport.issuingState} />
        {passport.placeOfBirth && <Details label="Place of birth" value={passport.placeOfBirth} />}
        {passport.issuingAuthority && <Details label="Issuing authority" value={passport.issuingAuthority} />}
        {passport.dateOfIssue && <Details label="Date of issue" value={passport.dateOfIssue} />}
        {!passport.portraitAvailable && (
          <Text style={styles.body}>
            No usable chip photo was available. Read the chip again to try for a photo.
          </Text>
        )}
        <Text accessibilityRole="header" style={styles.label}>
          PRINTED DETAILS AND CHIP
        </Text>
        {Object.entries(passport.correspondence).map(([field, observation]) => (
          <Details
            key={field}
            label={correspondenceLabel(field)}
            value={
              observation === 'matches'
                ? 'Matches'
                : observation === 'differs'
                  ? 'Different — review this field'
                  : 'Not compared'
            }
          />
        ))}
        {!Object.keys(passport.correspondence).length && (
          <Text style={styles.body}>Printed details were not compared with the chip.</Text>
        )}
      </View>
      {focus === 'passport' && renderFaceCard()}
      <Action
        secondary
        label={technical ? 'Hide check details' : 'View check details'}
        onPress={() => setTechnical(!technical)}
      />
      {renderTechnicalDetails()}
    </>
  );
}
function displayDate(raw: string): string {
  if (!/^\d{6}$/.test(raw)) return raw;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(raw.slice(2, 4)) - 1];
  return month ? `${Number(raw.slice(4))} ${month} ’${raw.slice(0, 2)}` : raw;
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
          This action could not finish. Try again.
        </Text>
      )}
    </>
  );
}
export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f4f5f8' },
  content: { padding: 24, gap: 20, paddingBottom: 48 },
  eyebrow: { color: '#233c69', fontWeight: '700', letterSpacing: 2 },
  title: { fontSize: 32, fontWeight: '700', color: '#122b54' },
  body: { fontSize: 18, lineHeight: 26, color: '#252c39' },
  label: { fontSize: 14, fontWeight: '700', color: '#4d576a' },
  detail: { gap: 4 },
  card: { padding: 20, gap: 16, backgroundColor: '#fff', borderRadius: 20 },
  portraits: { flexDirection: 'row', gap: 12 },
  portrait: { flex: 1, gap: 8 },
  image: { aspectRatio: 3 / 4, width: '100%' },
  camera: { flex: 1, backgroundColor: '#152032', justifyContent: 'space-between' },
  cameraTop: { padding: 24, gap: 12 },
  cameraBottom: { paddingHorizontal: 24, paddingBottom: 20, gap: 12 },
  white: { color: '#fff' },
  guideCenter: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oval: { borderWidth: 3, borderColor: '#fff', borderRadius: 1000 },
  action: { backgroundColor: '#173965', padding: 16, minHeight: 52, borderRadius: 14, alignItems: 'center' },
  actionText: { color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.45 },
  secondary: { backgroundColor: '#e5eaf3' },
  secondaryText: { color: '#173965' },
  scrim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0008',
    justifyContent: 'flex-end',
  },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '85%' },
  sheetContent: { padding: 28, paddingBottom: 40, gap: 22 },
  sheetTitle: { fontSize: 26, fontWeight: '700', color: '#122b54' },
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
  intro: 'Your passport',
  loading: 'Opening saved checks',
  saved: 'Saved passport checks',
  scanning: 'Scan your passport',
  review: 'Check the printed details',
  reading: 'Reading your passport',
  passport: 'Your results',
  result: 'Your results',
  comparing: 'Comparing your photos',
  captured: 'Comparing your photos',
  selfie: 'Take a selfie',
};
