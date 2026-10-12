import { Text, View } from 'react-native';
import type { CompletedCapture } from './CaptureFlowController';
import { formatMoment } from '../app/HolderText';
import { t } from '../locales/i18n';
import { ResultPortrait } from './ResultPortrait';
import { ContentRow, ListSection, TextRow, ValueRow } from '../ui/List';
import { styles } from '../ui/styles';

const outcomeLabels: Record<string, string> = {
  pass: t('face.outcome.pass'),
  fail: t('face.outcome.fail'),
  manual_review: t('face.outcome.manualReview'),
};

/** Display the SDK's accepted comparison without re-evaluating its admission policy. */
export function FaceResultDetails({ result }: Readonly<{ result: CompletedCapture }>) {
  const { passport, comparison, session } = result;
  const depth = comparison?.admissionReceipt.depthEvidence;
  const referenceSHA = comparison?.referenceSHA256 ?? passport.portraitSHA256;
  const passportFailed = (
    [
      'countrySigningChain',
      'documentSignature',
      'dataGroupHashes',
      'activeAuthentication',
      'chipAuthentication',
    ] as const
  ).some((key) => passport.protocols[key] === 'failed');
  function faceText() {
    if (!comparison) return t('face.notTaken');
    if (!depth) return t('face.noDepth');
    return outcomeLabels[comparison.outcome] ?? t('face.outcome.other');
  }
  return (
    <>
      <ListSection header={t('face.title')} testID="face-result">
        <TextRow text={faceText()} />
        {comparison && depth && comparison.savedResult && (
          <ValueRow label={t('face.checkedAt')} value={formatMoment(comparison.savedResult.recordedAt)} />
        )}
        <TextRow text={t('face.passportCaution')} />
        {passportFailed && <TextRow text={t('face.passportFailed')} tone="warning" />}
      </ListSection>
      <ListSection header={comparison ? t('face.photos') : t('passport.result.passportPhoto')}>
        <ContentRow>
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
            {comparison && (
              <ResultPortrait
                key={comparison.selfieSHA256}
                session={session}
                image="selfie"
                sha256={comparison.selfieSHA256}
                label={t('passport.result.comparedSelfie')}
                caption={t('passport.result.yourSelfie')}
              />
            )}
          </View>
          {!referenceSHA && <Text style={styles.body}>{t('passport.result.noPortrait')}</Text>}
        </ContentRow>
      </ListSection>
      {comparison && depth && (
        <>
          <ListSection header={t('face.captureEvidence')}>
            <ValueRow label={t('face.technical.similarity')} value={String(comparison.similarity)} />
            <ValueRow label={t('face.depth')} value={t('face.depthMeasured')} />
            <ValueRow
              label={t('face.eyesOpen')}
              value={comparison.admissionReceipt.eyesOpen ? t('common.yes') : t('common.no')}
            />
          </ListSection>
          <ListSection header={t('face.diagnostics')}>
            <ValueRow label={t('face.technical.route')} value={comparison.route} />

            <ValueRow
              label={t('face.technical.relief')}
              value={
                depth.measurement.residualRMS == null
                  ? t('face.technical.unavailable')
                  : String(depth.measurement.residualRMS)
              }
            />
            <ValueRow label={t('face.technical.samples')} value={String(depth.measurement.sampleCount)} />
            <ValueRow label={t('face.technical.age')} value={String(depth.ageAtAdmission)} />
            <ValueRow
              label={t('face.technical.smoothing')}
              value={depth.filtered ? t('face.technical.filtered') : t('face.technical.unfiltered')}
            />
            <ValueRow label={t('face.technical.policy')} value={depth.measurement.policy.identifier} />
            <ValueRow
              label={t('face.technical.minimumRelief')}
              value={String(depth.measurement.policy.minimumResidualRMS)}
            />
            <ValueRow
              label={t('face.technical.minimumSamples')}
              value={String(depth.measurement.policy.minimumSamples)}
            />
            <ValueRow
              label={t('face.technical.maximumAge')}
              value={String(depth.measurement.policy.maximumDepthAge)}
            />
            <ValueRow
              label={t('face.technical.window')}
              value={t('face.technical.windowRange', {
                near: depth.measurement.policy.nearLimit,
                far: depth.measurement.policy.farLimit,
              })}
            />
            <ValueRow
              label={t('face.technical.samplesPerAxis')}
              value={String(depth.measurement.policy.samplesPerAxis)}
            />

            <ValueRow
              label={t('face.technical.blinkAge')}
              value={String(comparison.admissionReceipt.blinkAge)}
            />
            <ValueRow
              label={t('face.technical.steadyHold')}
              value={String(comparison.admissionReceipt.steadyHoldDuration)}
            />
            <ValueRow
              label={t('face.technical.modelLoading')}
              value={String(comparison.modelLoadingSeconds)}
            />
            <ValueRow
              label={t('face.technical.comparisonTime')}
              value={String(comparison.comparisonSeconds)}
            />
            <ValueRow label={t('face.technical.referenceDigest')} value={comparison.referenceSHA256} />
            <ValueRow label={t('face.technical.selfieDigest')} value={comparison.selfieSHA256} />
          </ListSection>
        </>
      )}
    </>
  );
}
