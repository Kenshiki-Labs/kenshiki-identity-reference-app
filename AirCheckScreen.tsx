import type { FusionAirCheck, FusionAirComparison } from '@kenshiki/identity-capture';
import { AirCheckDiagram } from './AirCheckDiagram';
import { FusionPage, MathDetails, quantity, TimestampRow } from './FusionPresentation';
import { t } from './locales/i18n';
import { copy } from './SensorPresentation';
import { useSensorSession } from './SensorScreen';
import { ButtonRow, ListSection, TextRow, ValueRow } from './ui/List';

export function AirCheckScreen() {
  const { state, perform } = useSensorSession();
  const air = state.board?.fusion.airCheck;
  const running = state.busy || air?.state === 'running';
  return (
    <FusionPage testID="fusion-air-check" title={copy('airCheck.navigationTitle')}>
      <ListSection header={copy('airCheck.header')} footer={copy('airCheck.intro')}>
        <ButtonRow
          label={copy(running ? 'airCheck.button.running' : 'airCheck.button.run')}
          disabled={!state.board || running}
          onPress={() => perform({ action: 'airCheck', consent: true })}
        />
        {state.board?.permissions.motion !== 'given' ? (
          <TextRow text={copy('airCheck.motion.needed')} tone="warning" />
        ) : null}
        {air && 'ranAt' in air ? <TimestampRow label={copy('airCheck.row.ranAt')} value={air.ranAt} /> : null}
      </ListSection>
      {air?.state === 'compared' ? (
        <AirComparison comparison={air.comparison} />
      ) : air ? (
        <AirFailure air={air} />
      ) : null}
    </FusionPage>
  );
}
function AirFailure({ air }: { air: FusionAirCheck }) {
  if (air.state === 'idle' || air.state === 'running' || air.state === 'compared') return null;
  const reason = !('reason' in air)
    ? copy('airCheck.result.noFix')
    : air.reason === 'cancelled'
      ? t('fusionUI.cancelled')
      : copy(`airCheck.absence.${air.reason}`, air.reason);
  return (
    <ListSection header={copy('airCheck.result.header')}>
      <TextRow text={reason} tone="warning" alert />
      {air.state === 'weatherFailure'
        ? [
            <ValueRow key="stage" label={t('fusionUI.stage')} value={air.stage} />,
            <ValueRow
              key="station"
              label={copy('airCheck.row.station')}
              value={air.stationID ?? t('fusionUI.notAvailable')}
            />,
            <TimestampRow key="observed" label={copy('airCheck.row.reportedAt')} value={air.observedAt} />,
            <TimestampRow key="received" label={t('fusionUI.receivedAt')} value={air.receivedAt} />,
            <ValueRow key="http" label={t('fusionUI.httpStatus')} value={quantity(air.httpStatus, '')} />,
            <ValueRow
              key="field"
              label={t('fusionUI.failingField')}
              value={air.failingField ?? t('fusionUI.notAvailable')}
            />,
            <ValueRow
              key="path"
              label={t('fusionUI.decodingPath')}
              value={air.decodingPath ?? t('fusionUI.notAvailable')}
            />,
          ]
        : null}
    </ListSection>
  );
}
function AirComparison({ comparison: c }: { comparison: FusionAirComparison }) {
  return (
    <>
      <ListSection header={copy('airCheck.result.header')} footer={copy('airCheck.result.notAVerdict')}>
        <AirCheckDiagram residual={c.residualKPa} tolerance={c.toleranceKPa} />
        <TextRow
          text={copy(c.verdict === 'consistent' ? 'airCheck.result.matches' : 'airCheck.result.doesNotMatch')}
        />
        <ValueRow
          label={copy('airCheck.row.confidence')}
          value={copy(`airCheck.confidence.${c.confidence}`)}
        />
        <MathDetails
          label={copy('airCheckMath.row')}
          metrics={c.math}
          explanation={[
            t('fusionUI.pressureUnits'),
            t('fusionUI.airFormula'),
            t('fusionUI.allowanceFormula'),
            t('fusionUI.residualFormula'),
          ]}
        />
      </ListSection>
      <ListSection header={copy('airCheck.measured.header')} footer={copy('airCheck.note.allowed')}>
        {(['measured', 'expected', 'difference', 'allowed'] as const).map((key, index) => (
          <ValueRow
            key={key}
            label={copy(`airCheck.row.${key}`)}
            value={quantity(
              [c.measuredKPa, c.expectedKPa, c.residualKPa, c.toleranceKPa][index] ?? null,
              'kPa',
            )}
          />
        ))}
      </ListSection>
      <ListSection header={copy('airCheck.place.header')}>
        <ValueRow label={copy('airCheck.row.altitude')} value={quantity(c.altitudeMeters, 'm')} />
        <ValueRow
          label={copy('airCheck.row.horizontalAccuracy')}
          value={quantity(c.horizontalAccuracyMeters, 'm')}
        />
        <ValueRow
          label={copy('airCheck.row.verticalAccuracy')}
          value={quantity(c.verticalAccuracyMeters, 'm')}
        />
        <TimestampRow label={t('fusionUI.locationAt')} value={c.locationAt} />
        <TimestampRow label={copy('airCheck.row.pressureReadAt')} value={c.pressureAt} />
      </ListSection>
      <ListSection header={copy('airCheck.weather.header')}>
        <ValueRow label={t('fusionUI.source')} value={t('fusionUI.nws')} />
        <ValueRow label={copy('airCheck.row.seaLevel')} value={quantity(c.seaLevelPressureKPa, 'kPa')} />
        <ValueRow label={copy('airCheck.row.temperature')} value={quantity(c.temperatureC, '°C')} />
        <ValueRow label={copy('airCheck.row.humidity')} value={quantity(c.humidityPercent, '%')} />
        <TimestampRow label={copy('airCheck.row.fetchedAt')} value={c.weatherFetchedAt} />
        <TimestampRow label={copy('airCheck.row.reportedAt')} value={c.weatherObservedAt} />
        <ValueRow
          label={copy('airCheck.row.station')}
          value={[c.stationName, c.stationID].filter(Boolean).join(' · ') || t('fusionUI.notAvailable')}
        />
        <ValueRow
          label={copy('airCheck.row.stationDistance')}
          value={quantity(c.stationDistanceMeters, 'm')}
        />
        <ValueRow
          label={copy('airCheck.row.stationHeight')}
          value={quantity(c.stationElevationMeters, 'm')}
        />
        <ValueRow
          label={copy('airCheck.row.quality')}
          value={c.pressureQuality ?? t('fusionUI.notAvailable')}
        />
        <ValueRow
          label={t('fusionUI.temperatureQuality')}
          value={c.temperatureQuality ?? t('fusionUI.notAvailable')}
        />
        <ValueRow label={t('fusionUI.pressureField')} value={c.pressureField ?? t('fusionUI.notAvailable')} />
        <ValueRow
          label={t('fusionUI.observationURL')}
          value={c.observationURL ?? t('fusionUI.notAvailable')}
        />
        <ValueRow label={t('fusionUI.maximumAge')} value={quantity(c.maximumObservationAgeSeconds, 's')} />
        <ValueRow
          label={t('fusionUI.maximumDistance')}
          value={quantity(c.maximumStationDistanceMeters, 'm')}
        />
        <ValueRow label={copy('airCheck.row.calibration')} value={c.calibrationRevision} />
      </ListSection>
    </>
  );
}
