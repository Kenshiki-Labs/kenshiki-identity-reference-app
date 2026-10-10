import type { FusionMetric, FusionReceipt } from '@kenshiki/identity-capture';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { formatLocale, t } from './locales/i18n';
import type { MessageKey } from './locales/strings.generated';
import { copy, moment } from './SensorPresentation';
import { useSensorSession } from './SensorScreen';
import { ButtonRow, ListSection, TextRow, ValueRow } from './ui/List';
import { NativeSheet } from './ui/NativeSheet';
import { color, spacing } from './ui/tokens.generated';

const metricNames: Record<string, Extract<MessageKey, `fusionMath.${string}`>> = {
  temperature: 'fusionMath.temperature',
  meanColumn: 'fusionMath.meanColumn',
  scaleHeight: 'fusionMath.scaleHeight',
  heightAllowance: 'fusionMath.heightAllowance',
  temperatureAllowance: 'fusionMath.temperatureAllowance',
  uncertaintyBudget: 'fusionMath.uncertaintyBudget',
  gasConstantOverGravity: 'fusionMath.gasConstantOverGravity',
  halfLapse: 'fusionMath.halfLapse',
  temperatureUncertainty: 'fusionMath.temperatureUncertainty',
  areaUncertainty: 'fusionMath.areaUncertainty',
  altitudeSigmas: 'fusionMath.altitudeSigmas',
  allowanceFloor: 'fusionMath.allowanceFloor',
  allowanceCeiling: 'fusionMath.allowanceCeiling',
  stationInputPressure: 'fusionMath.stationInputPressure',
  stationPressure: 'fusionMath.stationPressure',
  calculatedSeaLevelPressure: 'fusionMath.calculatedSeaLevelPressure',
  coverage: 'fusionMath.coverage',
  breadth: 'fusionMath.breadth',
  recency: 'fusionMath.recency',
  maturity: 'fusionMath.maturity',
  coherence: 'fusionMath.coherence',
  signalAuthenticity: 'fusionMath.signalAuthenticity',
  posteriorMean: 'fusionMath.posteriorMean',
  lowerCredibleBound: 'fusionMath.lowerCredibleBound',
  confidenceWidth: 'fusionMath.confidenceWidth',
  evidenceWeight: 'fusionMath.evidenceWeight',
  effectiveCheckIns: 'fusionMath.effectiveCheckIns',
  halfMaturityDays: 'fusionMath.halfMaturityDays',
  daysSteepness: 'fusionMath.daysSteepness',
  checkInTarget: 'fusionMath.checkInTarget',
  priorEvidence: 'fusionMath.priorEvidence',
  lowerBoundZ: 'fusionMath.lowerBoundZ',
  networkChangeCoherence: 'fusionMath.networkChangeCoherence',
  contradictionCoherenceWeight: 'fusionMath.contradictionCoherenceWeight',
};
function metricLabel(name: string): string {
  const key = metricNames[name];
  return key ? t(key) : name;
}

export function quantity(value: number | null, unit: string): string {
  return value === null
    ? t('fusionUI.notAvailable')
    : t('fusionUI.metric', {
        value: new Intl.NumberFormat(formatLocale, { maximumFractionDigits: 5 }).format(value),
        unit,
      });
}
export function share(value: number): string {
  return new Intl.NumberFormat(formatLocale, { style: 'percent', maximumFractionDigits: 2 }).format(value);
}
export function FusionPage({ children, testID }: { children: ReactNode; testID: string }) {
  const { state, failure } = useSensorSession();
  return (
    <ScrollView
      testID={testID}
      style={styles.root}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      {failure || state.failure ? (
        <ListSection>
          <TextRow text={failure || state.failure || ''} tone="warning" alert />
        </ListSection>
      ) : null}
      {children}
    </ScrollView>
  );
}
export function TimestampRow({ label, value }: { label: string; value: string | null }) {
  return <ValueRow label={label} value={moment(value)} />;
}
export function ReceiptSection({ receipt }: { receipt: FusionReceipt | null }) {
  return (
    <ListSection header={copy('continuity.anchor.header')} footer={t('fusionUI.receiptLimit')}>
      {receipt ? (
        [
          <ValueRow
            key="kind"
            label={copy('continuity.row.keyKind')}
            value={copy(receipt.secureHardware ? 'continuity.key.secureEnclave' : 'continuity.key.software')}
          />,
          <ValueRow key="key" label={copy('continuity.row.keyFingerprint')} value={receipt.publicKeyHash} />,
          <ValueRow
            key="signature"
            label={copy('continuity.row.signature')}
            value={copy(
              receipt.locallyVerified ? 'continuity.signature.valid' : 'continuity.signature.invalid',
            )}
          />,
          <ValueRow
            key="attestation"
            label={copy('continuity.row.attestation')}
            value={receipt.attestationState}
          />,
          <ValueRow key="payload" label={copy('continuity.row.payloadHash')} value={receipt.payloadHash} />,
          <ValueRow
            key="previous"
            label={copy('continuity.row.chainPrevious')}
            value={receipt.previousRoot ?? t('fusionUI.notAvailable')}
          />,
          <ValueRow key="root" label={copy('continuity.row.chainRoot')} value={receipt.root} />,
          <ValueRow
            key="position"
            label={copy('continuity.row.chainPosition')}
            value={t('fusionUI.fraction', { count: receipt.leafIndex + 1, total: receipt.leafCount })}
          />,
        ]
      ) : (
        <TextRow text={copy('continuity.unsigned')} />
      )}
    </ListSection>
  );
}
export function MathSheet({
  metrics,
  explanation,
  onDismiss,
}: {
  metrics: FusionMetric[];
  explanation: string[];
  onDismiss: () => void;
}) {
  return (
    <NativeSheet title={t('fusionUI.mathTitle')} testID="fusion-math" onDismiss={onDismiss}>
      <ListSection footer={t('fusionUI.working')}>
        {explanation.map((line) => (
          <TextRow key={line} text={line} />
        ))}
        {metrics.map((metric) => (
          <ValueRow
            key={metric.name}
            label={metricLabel(metric.name)}
            value={quantity(metric.value, metric.unit)}
          />
        ))}
        <ButtonRow label={copy('common.done')} onPress={onDismiss} />
      </ListSection>
    </NativeSheet>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxxxl, gap: spacing.lg },
});
