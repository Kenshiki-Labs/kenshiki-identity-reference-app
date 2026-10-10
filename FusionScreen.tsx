import { FusionPage } from './FusionPresentation';
import { t } from './locales/i18n';
import { copy } from './SensorPresentation';
import { useSensorSession } from './SensorScreen';
import { ListRow, ListSection, TextRow, ValueRow } from './ui/List';

export type FusionDestination = 'AirCheck' | 'Continuity' | 'ThreeProofs' | 'Glossary' | 'OverTime';
export function FusionScreen({ onOpen }: Readonly<{ onOpen: (page: FusionDestination) => void }>) {
  const { state } = useSensorSession();
  const fusion = state.board?.fusion;
  const air = fusion?.airCheck;
  const continuity = fusion?.continuity;
  const airSummary =
    air?.state === 'compared'
      ? copy(
          air.comparison.verdict === 'consistent'
            ? 'airCheck.result.matches'
            : 'airCheck.result.doesNotMatch',
        )
      : air?.state === 'running'
        ? copy('airCheck.button.running')
        : air && air.state !== 'idle'
          ? t('fusionUI.notAvailable')
          : copy('fusion.notRunYet');
  const continuitySummary =
    continuity?.state === 'evaluated'
      ? copy(`continuity.${continuity.result.verdict}`)
      : continuity && continuity.state !== 'idle'
        ? t('fusionUI.notAvailable')
        : state.board?.reading
          ? copy('fusion.readingReady')
          : copy('fusion.notRunYet');
  return (
    <FusionPage testID="fusion-screen" title={copy('fusion.navigationTitle')}>
      <ListSection header={copy('airCheck.header')} footer={copy('fusion.airCheck.meaning')}>
        <ValueRow label={copy('sensorGroup.now')} value={airSummary} />
        <ListRow label={copy('airCheck.header')} onPress={() => onOpen('AirCheck')} />
      </ListSection>
      <ListSection header={copy('continuity.header')} footer={copy('fusion.continuity.meaning')}>
        <ValueRow label={copy('sensorGroup.now')} value={continuitySummary} />
        <ListRow label={copy('continuity.header')} onPress={() => onOpen('Continuity')} />
      </ListSection>
      <ListSection header={copy('fusion.proofs.header')} footer={t('fusionUI.receiptLimit')}>
        {['device', 'presence', 'person'].map((proof) => (
          <TextRow key={proof} text={copy(`fusion.proofs.${proof}`)} />
        ))}
        <ListRow label={copy('threeProofs.row')} onPress={() => onOpen('ThreeProofs')} />
        <ListRow label={copy('glossary.row')} onPress={() => onOpen('Glossary')} />
      </ListSection>
    </FusionPage>
  );
}
