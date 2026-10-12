import type { Configuration, PassportObservation } from '@kenshiki/identity-capture';
import { IdentityCapturePreview, IdentityCaptureSession } from '@kenshiki/identity-capture';
import { useCallback, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { CaptureFlowController, type CompletedCapture, type FlowState } from './CaptureFlowController';
import { FaceResultDetails } from './FaceResultDetails';
import { formatMoment } from '../app/HolderText';
import { t } from '../locales/i18n';
import { ResultPortrait } from './ResultPortrait';
import { Action } from '../ui/Action';
import { ControllerStartup } from '../ui/ControllerStartup';
import { connectBackground } from '../ui/connectBackground';
import { ContentRow, ListSection, ValueRow } from '../ui/List';
import { NativeSheet, useConfirmation } from '../ui/NativeSheet';
import { Page } from '../ui/Page';
import { styles } from '../ui/styles';
import { size } from '../ui/tokens.generated';
import { useCaptureHandoff } from '../ui/useCaptureHandoff';
import { useControllerState } from '../ui/useControllerState';

const initialState: FlowState = { phase: 'intro', busy: false, ready: false, preview: 0 };

/** Completion transfers the session to the adopter. Cancellation releases it. */
export function IdentityCaptureFlow({
  configuration,
  onExit,
  onComplete,
  onClaim,
  completed,
  resume,
}: Readonly<{
  configuration: Configuration;
  onExit: () => void;
  onComplete: (result: CompletedCapture) => void;
  onClaim?: (() => void) | undefined;
  completed?: CompletedCapture | undefined;
  resume?: ('selfie' | 'read') | undefined;
}>) {
  const [width, setWidth] = useState(0);
  const handoffStarted = useRef(false);
  const [finishing, setFinishing] = useState(false);
  const [releaseFailed, setReleaseFailed] = useState(false);
  const { controller, state, failed, cancelStartup } = useControllerState(
    initialState,
    useCallback(
      (publish: (state: FlowState) => void) => {
        const active = new CaptureFlowController(
          IdentityCaptureSession.create,
          configuration,
          publish,
          completed,
        );
        onClaim?.();
        if (resume === 'selfie') active.selfie().catch(active.fail);
        if (resume === 'read') active.read().catch(active.fail);
        if (!resume) active.open().catch(active.fail);
        return connectBackground(active);
      },
      [configuration, completed, resume, onClaim],
    ),
  );
  const finish = async () => {
    if (!controller || handoffStarted.current) return;
    handoffStarted.current = true;
    setFinishing(true);
    try {
      onComplete(await controller.handoff());
    } catch (error) {
      handoffStarted.current = false;
      setFinishing(false);
      controller.fail(error);
    }
  };
  useCaptureHandoff(
    state.comparison ?? state.passport,
    (state.phase === 'passport' || state.phase === 'result') && !state.busy && !state.sheet,
    finish,
    (error) => controller?.fail(error),
  );
  /** Completed evidence is handed off; anything earlier is released. */
  const leave = async () => {
    if (handoffStarted.current) return;
    if (state.passport) await finish();
    else if (controller) {
      handoffStarted.current = true;
      setFinishing(true);
      try {
        await controller.dispose();
      } catch {
        // Disposal has fenced the controller. Keep failed custody and block a replacement check.
        setReleaseFailed(true);
        return;
      }
      onExit();
    }
  };
  const close = () => leave().catch((error: unknown) => controller?.fail(error));
  useConfirmation(
    controller && state.sheet?.kind === 'restart'
      ? {
          key: 'restart',
          title: t('passport.sheet.restartTitle'),
          message: state.sheet.message,
          confirm: t('common.startOver'),
          keep: t('passport.sheet.keepCheck'),
          onConfirm: () => {
            controller.restart().catch(controller.fail);
          },
          onKeep: () => {
            controller.recover().catch(controller.fail);
          },
        }
      : undefined,
  );
  if (!controller)
    return (
      <ControllerStartup
        title={t('hub.passport.title')}
        onClose={onExit}
        failed={failed}
        cancelStartup={cancelStartup}
      />
    );
  const activeController = controller;
  const { phase, sheet } = state;
  const camera = phase === 'scanning' || phase === 'selfie';
  const title = phaseTitles[phase];
  const action = (label: string, press: () => unknown, disabled = false, id?: string, secondary = false) => (
    <Action
      label={label}
      onPress={press}
      disabled={state.busy || finishing || disabled}
      testID={id}
      secondary={secondary}
      grouped={phase === 'saved'}
    />
  );
  function renderCaptureStage() {
    if (camera) {
      return renderCamera();
    }
    return (
      <>
        {phase === 'loading' && <Text style={styles.body}>{t('common.openingSavedResults')}</Text>}
        {phase === 'saved' && (
          <>
            <Text style={styles.body}>{t('passport.saved.choose')}</Text>
            <View style={styles.list} testID="saved-passports-list">
              {state.saved?.map((record, index) => (
                <ListSection key={record.workflowID}>
                  <ContentRow>
                    <Text style={styles.body}>
                      {t('passport.saved.savedAt', { moment: formatMoment(record.recordedAt) })}
                    </Text>
                  </ContentRow>
                  {action(
                    t('passport.saved.open'),
                    () => activeController.recoverSaved(record.workflowID),
                    false,
                    `saved-passport-${index}`,
                  )}
                </ListSection>
              ))}
              <ListSection>
                {action(
                  t('passport.saved.scanAnother'),
                  activeController.restart,
                  false,
                  'new-passport',
                  true,
                )}
              </ListSection>
            </View>
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
            disabled={finishing}
            secondary
            testID="restart-check"
          />
        )}
      </>
    );
  }
  function renderRecovery() {
    if (releaseFailed)
      return (
        <NativeSheet title={t('common.checkNeedsAttention')} testID="passport-release-failure">
          <Text accessibilityRole="alert" style={styles.body}>
            {t('common.sessionRecovery')}
          </Text>
        </NativeSheet>
      );
    if (sheet?.kind !== 'recovery') return null;
    return (
      <NativeSheet title={t('common.letsTryAgain')} testID="capture-bottom-sheet">
        <Text style={styles.body}>{sheet.message}</Text>
        {renderRecoveryActions()}
      </NativeSheet>
    );
  }
  function renderCamera() {
    return (
      <View style={styles.camera} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
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
          <Text style={[styles.body, styles.white]}>
            {phase === 'scanning' ? t('passport.camera.scanHint') : state.hint}
          </Text>
        </View>
        <View style={styles.cameraBottom}>{scanHint()}</View>
      </View>
    );
  }
  function renderRecoveryActions() {
    return (
      <>
        {renderRecoveryChoice()}
        {state.passport && (
          <Action
            label={t('passport.sheet.keepResults')}
            onPress={finish}
            disabled={state.busy || finishing}
            testID="keep-passport"
            secondary
          />
        )}
        {action(t('common.startOver'), activeController.restart, false, 'confirm-restart', true)}
      </>
    );
  }
  function scanHint() {
    if (phase === 'scanning') {
      return (
        <Text style={[styles.body, styles.white]} accessibilityLiveRegion="polite">
          {state.mrz?.completeness === 'complete'
            ? t('passport.camera.ready')
            : state.mrz
              ? t('passport.camera.keepInView')
              : t('passport.camera.holdSteady')}
        </Text>
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
    if (sheet?.kind !== 'recovery') return null;
    if (sheet.recovery === 'details') {
      return (
        <Action
          label={backToDetailsLabel()}
          onPress={() => (state.passport || state.mrz ? activeController.recover() : leave())}
          disabled={state.busy || finishing}
          testID="back-to-details"
        />
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
    <Page
      title={title}
      mode={camera ? 'camera' : 'scroll'}
      onClose={close}
      covered={releaseFailed || !!sheet}
      overlay={renderRecovery()}
    >
      {renderCaptureStage()}
    </Page>
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
}: Readonly<{
  result: CompletedCapture;
  focus?: ('passport' | 'face') | undefined;
}>) {
  if (focus === 'face') return <FaceResultDetails result={result} />;
  const { passport, session } = result;
  const referenceSHA = passport.portraitSHA256;
  const bacFallback =
    passport.protocols.pace === 'failed' && passport.protocols.basicAccessControl === 'succeeded';
  const paceParametersUnavailable = bacFallback && passport.paceFailure?.code === 'cardAccessAbsent';
  const bacFallbackStatus = paceParametersUnavailable
    ? t('passport.protocolStatus.paceParametersUnavailable')
    : t('passport.protocolStatus.bacFallback');
  const visibleProtocols = protocolKeys.filter((key) => {
    const group = key === 'chipAuthentication' ? 'DG14' : key === 'activeAuthentication' ? 'DG15' : null;
    return !(
      group &&
      passport.protocols[key] === 'notPerformed' &&
      passport.declaredDataGroups &&
      passport.declaredDataGroups.length > 0 &&
      !passport.declaredDataGroups.includes(group)
    );
  });
  const failed = protocolKeys.filter(
    (key) => passport.protocols[key] === 'failed' && !(key === 'pace' && bacFallback),
  );
  function renderTechnicalDetails() {
    return (
      <>
        {(['integrity', 'access'] as const).map((group) => (
          <ListSection key={group} header={t(`passport.details.${group}`)}>
            {visibleProtocols
              .filter((key) => (key === 'pace' || key === 'basicAccessControl') === (group === 'access'))
              .map((key) => (
                <ValueRow
                  key={key}
                  label={protocolLabels[key]}
                  value={
                    key === 'pace' && bacFallback
                      ? bacFallbackStatus
                      : protocolStatus[passport.protocols[key]]
                  }
                />
              ))}
          </ListSection>
        ))}
        {(passport.paceFailure || bacFallback) && (
          <ListSection header={t('passport.details.title')}>
            <ContentRow>
              {passport.paceFailure && (
                <>
                  <Details
                    label={t('passport.paceDiagnostic.reason')}
                    value={t(`passport.paceDiagnostic.${passport.paceFailure.code}`)}
                  />
                  <Details
                    label={t('passport.paceDiagnostic.stage')}
                    value={t(`passport.paceDiagnostic.${passport.paceFailure.stage}`)}
                  />
                  {passport.paceFailure.statusWord !== null && (
                    <Details
                      label={t('passport.paceDiagnostic.statusWord')}
                      value={passport.paceFailure.statusWord.toString(16).toUpperCase().padStart(4, '0')}
                    />
                  )}
                </>
              )}
              {bacFallback && !passport.paceFailure && (
                <Details
                  label={t('passport.paceDiagnostic.reason')}
                  value={t('passport.paceDiagnostic.notRecorded')}
                />
              )}
            </ContentRow>
          </ListSection>
        )}
      </>
    );
  }
  return (
    <>
      <ListSection header={t('passport.result.title')} testID="passport-result">
        <ContentRow>
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
          {bacFallback && (
            <Text style={styles.body}>
              {paceParametersUnavailable
                ? t('passport.result.paceParametersUnavailable')
                : t('passport.result.bacFallback')}
            </Text>
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
              <ResultPortrait
                key={referenceSHA}
                session={session}
                image="reference"
                sha256={referenceSHA}
                label={t('passport.result.chipPhoto')}
                caption={t('passport.result.passportPhoto')}
              />
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
          <Details label={t('passport.field.sex')} value={passport.sex} />
          {passport.personalNumber && (
            <Details label={t('passport.field.personalNumber')} value={passport.personalNumber} />
          )}
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
        </ContentRow>
      </ListSection>
      <ListSection header={t('passport.result.correspondenceHeading')}>
        <ContentRow>
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
        </ContentRow>
      </ListSection>
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
function Details({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View style={styles.detail}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.body}>{value}</Text>
    </View>
  );
}

const protocolKeys = [
  'countrySigningChain',
  'documentSignature',
  'dataGroupHashes',
  'activeAuthentication',
  'chipAuthentication',
  'basicAccessControl',
  'pace',
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
