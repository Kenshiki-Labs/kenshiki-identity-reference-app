import { FusionPage, ReceiptSection, share } from './FusionPresentation';
import { formatLocale, t } from './locales/i18n';
import { copy } from './SensorPresentation';
import { useSensorSession } from './SensorScreen';
import { ListSection, TextRow, TitleRow, ValueRow } from './ui/List';

export function ThreeProofsScreen() {
  const { state } = useSensorSession();
  const sections = [
    ['device', ['how', 'proves', 'notProves', 'breaks', 'where']],
    ['presence', ['how', 'proves', 'notProves', 'absence', 'where']],
    ['person', ['how', 'proves', 'notProves', 'where']],
    ['together', ['how', 'proves', 'claim', 'limit']],
    ['check', ['how', 'completeness', 'time', 'attestation', 'where', 'tamper', 'coverage']],
  ] as const;
  return (
    <FusionPage testID="fusion-proofs">
      <ListSection>
        <TextRow text={t('fusionUI.wiring')} />
        <TextRow text={t('fusionUI.receiptLimit')} />
      </ListSection>
      {sections.map(([name, paragraphs]) => (
        <ListSection key={name} header={copy(`threeProofs.${name}.header`)}>
          {paragraphs.map((key) => (
            <TextRow key={key} text={copy(`threeProofs.${name}.${key}`)} />
          ))}
        </ListSection>
      ))}
      <ReceiptSection receipt={state.board?.fusion.receipt ?? null} />
    </FusionPage>
  );
}
export function GlossaryScreen() {
  const entries = ['secureEnclave', 'signature', 'hash', 'merkle', 'canonical', 'appAttest'].map((name) => ({
    term: copy(`glossary.${name}.term`),
    body: copy(`glossary.${name}.body`),
  }));
  entries.push({ term: t('fusionUI.glossaryKeyTerm'), body: t('fusionUI.glossaryKeyBody') });
  entries.sort((a, b) => a.term.localeCompare(b.term, formatLocale));
  return (
    <FusionPage testID="fusion-glossary">
      {entries.map((entry) => (
        <ListSection key={entry.term} header={entry.term}>
          <TextRow text={entry.body} />
        </ListSection>
      ))}
    </FusionPage>
  );
}
export function OverTimeScreen() {
  const { state } = useSensorSession();
  const continuity = state.board?.fusion.continuity;
  const result = continuity?.state === 'evaluated' ? continuity.result : null;
  return (
    <FusionPage testID="fusion-over-time">
      <ListSection header={copy('overTime.reading.header')}>
        <TextRow text={copy('overTime.reading.is')} />
        <TextRow text={t('fusionUI.readingWhen')} />
        <TextRow text={copy('overTime.reading.noSchedule')} />
      </ListSection>
      <ListSection header={copy('overTime.timeline.header')} footer={t('fusionUI.illustrative')}>
        {result ? (
          result.scenarios.map((row) => (
            <TitleRow
              key={row.days}
              title={`${t('fusionUI.scenario', { days: row.days, readings: row.readings })}: ${share(row.mean)}`}
              detail={t('fusionUI.scenarioDetail', {
                lower: share(row.lowerBound),
                confidence: share(row.confidence),
              })}
            />
          ))
        ) : (
          <TextRow text={t('fusionUI.missingScenario')} />
        )}
      </ListSection>
      <ListSection header={copy('overTime.gap.header')}>
        <TextRow text={copy('overTime.gap.how')} />
        {result?.gaps.map((gap) => (
          <ValueRow
            key={gap.hours}
            label={t('fusionUI.gap', { hours: gap.hours })}
            value={share(gap.recency)}
          />
        ))}
        <TextRow text={copy('overTime.gap.meaning')} />
      </ListSection>
      <ListSection header={copy('overTime.reset.header')} footer={copy('overTime.reset.note')}>
        <TextRow text={copy('overTime.break.is')} />
        <TextRow text={copy('overTime.break.narrow')} />
        <TextRow text={t('fusionUI.keyLoss')} />
      </ListSection>
    </FusionPage>
  );
}
