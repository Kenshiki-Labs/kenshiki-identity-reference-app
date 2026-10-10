import type { FusionContinuityResult } from '@kenshiki/identity-capture';
import { View } from 'react-native';
import { FusionPage, MathDetails, ReceiptSection, share, TimestampRow } from './FusionPresentation';
import { t } from './locales/i18n';
import { copy, plain } from './SensorPresentation';
import { useSensorSession } from './SensorScreen';
import { ButtonRow, ListRow, ListSection, TextRow, TitleRow, ValueRow } from './ui/List';
import { confirmDestructive } from './ui/NativeSheet';

export function ContinuityScreen({ onOverTime }: { onOverTime: () => void }) {
  const { state, perform } = useSensorSession();
  const continuity = state.board?.fusion.continuity;
  const result = continuity?.state === 'evaluated' ? continuity.result : null;
  const failure =
    continuity?.state === 'unavailable' || continuity?.state === 'storageFailure'
      ? t(`fusionUI.${continuity.reason}`)
      : null;
  return (
    <FusionPage testID="fusion-continuity" title={copy('continuity.header')}>
      <ListSection
        header={copy('continuity.answer.header')}
        footer={copy(
          result?.verdict === 'firstPass' ? 'continuity.firstPass.note' : 'continuity.answer.note',
        )}
      >
        <ButtonRow
          label={t(state.busy ? 'fusionUI.evaluating' : 'fusionUI.evaluate')}
          disabled={state.busy || !state.board?.reading}
          onPress={() => perform({ action: 'continuity', consent: true })}
        />
        <TextRow
          text={failure ?? (result ? copy(`continuity.${result.verdict}`) : copy('continuity.waiting'))}
          {...(failure ? { tone: 'warning' as const, alert: true } : {})}
        />
        {result
          ? [
              <TimestampRow key="at" label={copy('continuity.row.evaluatedAt')} value={result.evaluatedAt} />,
              <ValueRow key="envelope" label={t('fusionUI.envelopeID')} value={result.envelopeID} />,
              <MathDetails
                key="math"
                label={copy('continuity.row.working')}
                metrics={result.math}
                explanation={[t('fusionUI.continuityFormula'), t('fusionUI.receiptLimit')]}
              />,
            ]
          : null}
        {result?.breakReason ? (
          <ValueRow
            label={copy('continuity.row.breakReason')}
            value={copy(`continuity.break.${result.breakReason}`, result.breakReason)}
          />
        ) : null}
        <ListRow label={copy('overTime.row')} onPress={onOverTime} />
      </ListSection>
      <ReceiptSection receipt={result?.receipt ?? state.board?.fusion.receipt ?? null} />
      {result ? <ContinuityDetails result={result} /> : null}
      <ListSection header={copy('continuity.forget.header')} footer={t('fusionUI.forgetNote')}>
        <ButtonRow
          label={t('fusionUI.forget')}
          disabled={state.busy || !state.board}
          destructive
          onPress={() =>
            confirmDestructive({
              title: t('fusionUI.forgetTitle'),
              message: t('fusionUI.forgetMessage'),
              confirm: t('fusionUI.forget'),
              keep: t('common.cancel'),
              onConfirm: () => perform({ action: 'forgetContinuity', consent: true }),
            })
          }
        />
      </ListSection>
    </FusionPage>
  );
}
function ContinuityDetails({ result: r }: { result: FusionContinuityResult }) {
  return (
    <>
      <ListSection header={copy('continuity.score.header')} footer={copy('continuity.score.note')}>
        <ValueRow label={copy('continuity.row.estimate')} value={share(r.mean)} />
        <ValueRow label={copy('continuity.row.lowerBound')} value={share(r.lowerBound)} />
        <ValueRow label={copy('continuity.row.certainty')} value={share(r.confidence)} />
        <View
          accessible
          testID="continuity-pass-count"
          accessibilityLabel={t('fusionUI.passCountValue', { count: r.passCount })}
        >
          <ValueRow label={copy('continuity.row.passes')} value={plain(r.passCount)} />
        </View>
        <ValueRow label={copy('continuity.row.days')} value={plain(r.daysContinuous)} />
        <TimestampRow label={t('fusionUI.collectedAt')} value={r.collectedAt} />
        <TimestampRow label={t('fusionUI.firstPassAt')} value={r.firstPassAt} />
        <TimestampRow label={t('fusionUI.previousPassAt')} value={r.previousPassAt} />
        <TimestampRow label={t('fusionUI.lastPassAt')} value={r.lastPassAt} />
        <TimestampRow label={copy('continuity.row.sinceBreak')} value={r.lastBreakAt} />
      </ListSection>
      <ListSection header={copy('continuity.coverage.header')} footer={copy('continuity.coverage.note')}>
        <ValueRow
          label={copy('continuity.row.lanesEligible')}
          value={t('fusionUI.fraction', { count: r.eligibleCount, total: r.possibleCount })}
        />
        <ValueRow
          label={copy('continuity.row.lanesObserved')}
          value={t('fusionUI.fraction', { count: r.liveCount, total: r.eligibleCount })}
        />
        {['breadth', 'coverage'].map((name) => {
          const metric = r.math.find((item) => item.name === name);
          return (
            <ValueRow
              key={name}
              label={copy(`continuity.row.${name}`)}
              value={metric ? share(metric.value) : t('fusionUI.notAvailable')}
            />
          );
        })}
      </ListSection>
      <ListSection header={copy('continuity.lanes.header')} footer={copy('continuity.lanes.note')}>
        {r.lanes.map((lane) => (
          <TitleRow
            key={lane.lane}
            title={copy(`continuity.lane.${lane.lane}`, plain(lane.lane))}
            detail={[copy(`continuity.state.${lane.state}`, lane.state), lane.reason]
              .filter(Boolean)
              .join(' · ')}
          />
        ))}
      </ListSection>
      <ListSection header={copy('continuity.network.header')} footer={copy('continuity.network.note')}>
        <ValueRow
          label={copy('continuity.row.networkStability')}
          value={copy(`continuity.network.${r.networkStability}`, plain(r.networkStability))}
        />
        <ValueRow label={copy('continuity.row.networkFamiliarity')} value={plain(r.networkFamiliarity)} />
      </ListSection>
    </>
  );
}
