import { FusionPage } from './FusionPresentation';
import { t } from '../locales/i18n';
import { copy } from '../sensors/SensorPresentation';
import { useSensorSession } from '../sensors/SensorScreen';
import { ListRow, ListSection } from '../ui/List';
import { PageLead } from '../ui/PageLead';

export type FusionDestination = 'AirCheck' | 'Continuity' | 'ThreeProofs' | 'Glossary';
export function FusionScreen({ onOpen }: Readonly<{ onOpen: (page: FusionDestination) => void }>) {
  const { state, failure } = useSensorSession();
  const fusion = state.board?.fusion;
  const air = fusion?.airCheck;
  const continuity = fusion?.continuity;
  const pendingSummary = failure || state.failure ? t('fusionUI.notAvailable') : t('sensors.opening');
  function airSummary() {
    if (!air) return pendingSummary;
    if (air.state === 'compared')
      return copy(
        air.comparison.verdict === 'consistent' ? 'airCheck.result.matches' : 'airCheck.result.doesNotMatch',
      );
    if (air.state === 'running') return copy('airCheck.button.running');
    return air.state === 'idle' ? copy('fusion.notRunYet') : t('fusionUI.notAvailable');
  }
  function continuitySummary() {
    if (!continuity) return pendingSummary;
    if (continuity.state === 'evaluated') return copy(`continuity.${continuity.result.verdict}`);
    if (continuity.state !== 'idle') return t('fusionUI.notAvailable');
    return copy(state.board?.reading ? 'fusion.readingReady' : 'fusion.notRunYet');
  }
  return (
    <FusionPage
      testID="fusion-screen"
      title={copy('fusion.navigationTitle')}
      lead={<PageLead title={t('fusionUI.leadTitle')} description={t('fusionUI.leadDescription')} />}
    >
      <ListSection>
        <ListRow label={copy('airCheck.header')} status={airSummary()} onPress={() => onOpen('AirCheck')} />
        <ListRow
          label={copy('continuity.header')}
          status={continuitySummary()}
          onPress={() => onOpen('Continuity')}
        />
      </ListSection>
      <ListSection header={t('fusionUI.explanationsTitle')}>
        <ListRow label={copy('threeProofs.row')} onPress={() => onOpen('ThreeProofs')} />
        <ListRow label={copy('glossary.row')} onPress={() => onOpen('Glossary')} />
      </ListSection>
    </FusionPage>
  );
}
