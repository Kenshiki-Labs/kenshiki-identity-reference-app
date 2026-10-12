import { FusionPage, ReceiptSection, share } from './FusionPresentation';
import { formatLocale, t } from '../locales/i18n';
import { copy } from '../sensors/SensorPresentation';
import { useSensorSession } from '../sensors/SensorScreen';
import { ListSection, TextRow, TitleRow, ValueRow } from '../ui/List';
import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';

export function ThreeProofsScreen() {
  const { state, failure } = useSensorSession();
  const board = state.board;
  const receipt = board?.fusion.receipt;
  const sections = [
    ['device', ['proves', 'notProves', 'how', 'breaks']],
    ['presence', ['proves', 'notProves', 'absence', 'how']],
    ['person', ['proves', 'notProves', 'how']],
    ['together', ['how', 'proves', 'claim', 'limit']],
    // SensorHost's `tamper` paragraph points at its alter-a-reading button; the shipped runtime
    // has no such command, so this host does not show it.
    ['check', ['how', 'completeness', 'time', 'attestation']],
  ] as const;
  function waitingText() {
    if (board) return copy('continuity.waiting');
    return t(failure || state.failure ? 'fusionUI.notAvailable' : 'sensors.opening');
  }
  return (
    <FusionPage
      testID="fusion-proofs"
      lead={<PageLead title={t('pageLead.proofs.title')} description={t('pageLead.proofs.description')} />}
      title={copy('threeProofs.title')}
    >
      <ListSection>
        <TextRow text={t('fusionUI.wiring')} />
      </ListSection>
      {sections.map(([name, paragraphs]) => (
        <ListSection key={name} header={copy(`threeProofs.${name}.header`)}>
          {paragraphs.map((key) => (
            <TextRow key={key} text={copy(`threeProofs.${name}.${key}`)} />
          ))}
        </ListSection>
      ))}
      {receipt || board?.reading ? (
        <ReceiptSection receipt={receipt ?? null} />
      ) : (
        <ListSection header={copy('continuity.anchor.header')} footer={t('fusionUI.receiptLimit')}>
          <TextRow text={waitingText()} />
        </ListSection>
      )}
    </FusionPage>
  );
}
export function GlossaryScreen() {
  const entries = ['secureEnclave', 'signature', 'hash', 'merkle', 'canonical', 'appAttest', 'chainRoot'].map(
    (name) => ({
      term: copy(`glossary.${name}.term`),
      body: copy(`glossary.${name}.body`),
    }),
  );
  entries.push({ term: t('fusionUI.glossaryKeyTerm'), body: t('fusionUI.glossaryKeyBody') });
  entries.sort((a, b) => a.term.localeCompare(b.term, formatLocale));
  return (
    <Page
      testID="fusion-glossary"
      lead={
        <PageLead title={t('pageLead.glossary.title')} description={t('pageLead.glossary.description')} />
      }
      title={copy('glossary.title')}
    >
      {entries.map((entry) => (
        <ListSection key={entry.term} header={entry.term}>
          <TextRow text={entry.body} />
        </ListSection>
      ))}
    </Page>
  );
}
export function OverTimeScreen() {
  const { state, failure } = useSensorSession();
  const continuity = state.board?.fusion.continuity;
  const result = continuity?.state === 'evaluated' ? continuity.result : null;
  function unavailableTimeline() {
    if (!state.board) return t(failure || state.failure ? 'fusionUI.notAvailable' : 'sensors.opening');
    if (continuity?.state === 'unavailable' || continuity?.state === 'storageFailure')
      return t(`fusionUI.${continuity.reason}`);
    return t(result ? 'fusionUI.notAvailable' : 'fusionUI.missingScenario');
  }
  return (
    <FusionPage
      testID="fusion-over-time"
      lead={
        <PageLead title={t('pageLead.overTime.title')} description={t('pageLead.overTime.description')} />
      }
      title={copy('overTime.title')}
    >
      <ListSection header={copy('overTime.timeline.header')}>
        <TextRow text={t('fusionUI.illustrative')} />
        {result?.scenarios.length ? (
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
          <TextRow text={unavailableTimeline()} />
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
        {result && result.gaps.length === 0 ? <TextRow text={t('fusionUI.missingGaps')} /> : null}
        <TextRow text={copy('overTime.gap.meaning')} />
      </ListSection>
      <ListSection header={copy('overTime.reading.header')}>
        <TextRow text={copy('overTime.reading.is')} />
        <TextRow text={t('fusionUI.readingWhen')} />
        <TextRow text={copy('overTime.reading.noSchedule')} />
      </ListSection>
      <ListSection header={copy('overTime.reset.header')} footer={copy('overTime.reset.note')}>
        <TextRow text={copy('overTime.break.is')} />
        <TextRow text={copy('overTime.break.narrow')} />
        <TextRow text={t('fusionUI.keyLoss')} />
      </ListSection>
    </FusionPage>
  );
}
