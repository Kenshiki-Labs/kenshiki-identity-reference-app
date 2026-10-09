import {
  IdentitySensorMap,
  type SensorBoardRequest,
  type SensorBoardState,
} from '@kenshiki/identity-capture';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Action } from './IdentityCaptureFlow';
import { t } from './locales/i18n';
import { boardStyles, Note, Row } from './SensorBoardRows';
import { copy, measure, moment, plain, sensorConfig } from './SensorPresentation';
export type BoardActions = {
  board: SensorBoardState;
  busy: boolean;
  perform: (request: SensorBoardRequest) => void;
};
export function LocationRows({
  board,
  busy,
  perform,
  sessionId,
}: { sessionId: string | null } & BoardActions) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <Row label={copy('sensorGroup.now')} value={board.permissions.location} />
      <Action
        label={copy('location.button.getOneFix')}
        disabled={busy}
        onPress={() => perform({ action: 'location', consent: true })}
      />
      <Note text={copy('location.note.getOneFix')} />
      {sessionId && (
        <IdentitySensorMap
          sessionId={sessionId}
          style={{ height: sensorConfig.map.height, borderRadius: sensorConfig.map.cornerRadius }}
        />
      )}
      {board.location.trail.length === 0 && (
        <Note
          text={copy(
            board.permissions.location === 'given'
              ? 'location.map.empty.noFixes'
              : 'location.map.empty.locationOff',
          )}
        />
      )}
      <Row
        label={copy('location.map.row.fixesOnMap')}
        value={t('sensors.location.fixesOnMap', {
          count: plain(board.location.trail.length),
          limit: plain(sensorConfig.map.trailLimit),
        })}
      />
      <Action
        secondary
        label={copy('location.map.button.clear')}
        disabled={busy}
        onPress={() => perform({ action: 'clearTrail', consent: true })}
      />
      <Note text={copy('location.map.note')} />
      <Note text={copy('location.footer')} />
      {board.location.failure && (
        <Text accessibilityRole="alert" style={boardStyles.warning}>
          {board.location.failure}
        </Text>
      )}
      {board.location.answeredAt && !board.location.fix && <Note text={copy('location.note.noFix')} />}
      <FixRows board={board} now={now} />
    </>
  );
}
function FixRows({ board, now }: { board: SensorBoardState; now: number }) {
  const fix = board.location.fix;
  if (!fix) return null;
  const age = (now - new Date(fix.measuredAt).getTime()) / 1000;
  const rows: [string, unknown][] = [
    ['latitude', String(fix.latitude)],
    ['longitude', String(fix.longitude)],
    [
      'horizontalAccuracy',
      fix.horizontalAccuracy < 0
        ? copy('common.notValid')
        : measure(fix.horizontalAccuracy, 'distance', board),
    ],
    [
      'verticalAccuracy',
      fix.verticalAccuracy < 0 ? copy('common.notValid') : measure(fix.verticalAccuracy, 'distance', board),
    ],
    ['altitude', measure(fix.altitude, 'distance', board)],
    ['speed', measure(fix.speed, 'speed', board)],
    ['course', measure(fix.course, 'degrees', board)],
    ['measuredAt', moment(fix.measuredAt)],
    [
      'age',
      age < 0 ? copy('location.value.inTheFuture') : t('sensors.seconds', { value: plain(Math.floor(age)) }),
    ],
    ['simulated', fix.simulated],
    ['fromAccessory', fix.accessory],
    ['fixContract', copy(fix.accepted ? 'location.value.accepted' : 'location.value.notAccepted')],
    ['fixesDelivered', board.location.deliveredCount],
    ['permissionThen', board.location.permissionAtDelivery],
    ['precisionThen', board.location.precisionAtDelivery],
  ];
  return (
    <>
      {rows.map(([key, value]) => (
        <Row key={key} label={copy(`location.row.${key}`)} value={value} />
      ))}
      {fix.unmetTerms.map((term) => (
        <Text key={term} style={boardStyles.warning}>
          {copy(`fixTerm.${term}`, plain(term))}
        </Text>
      ))}
      {['position', 'accuracy', 'altitude', 'movement', 'time', 'source', 'contract'].map((key) => (
        <Note key={key} text={copy(`location.note.${key}`)} />
      ))}
    </>
  );
}
export function WeatherRows({ board, busy, perform }: BoardActions) {
  const weather = board.weather;
  const rows: [string, unknown][] = [
    [t('sensors.weather.row.pressure'), measure(weather.pressureKPa, 'pressure', board)],
    [t('sensors.weather.row.temperature'), measure(weather.temperatureC, 'temperature', board)],
    [t('sensors.weather.row.humidity'), measure(weather.humidityPercent, 'percentage', board)],
    [
      t('sensors.weather.row.station'),
      [weather.stationName, weather.stationID].filter(Boolean).join(t('sensors.joiner')),
    ],
    [t('sensors.weather.row.distance'), measure(weather.distanceMeters, 'distance', board)],
    [t('sensors.weather.row.stationHeight'), measure(weather.stationElevationMeters, 'distance', board)],
    [t('sensors.weather.row.quality'), weather.quality],
    [t('sensors.weather.row.source'), weather.source],
    [t('sensors.weather.row.reportedAt'), moment(weather.observedAt)],
    [copy('weather.row.readAt'), moment(weather.readAt)],
  ];
  return (
    <>
      <Action
        label={copy('weather.button.read')}
        disabled={busy}
        onPress={() => perform({ action: 'weather', consent: true })}
      />
      <Note text={t('sensors.weather.note')} />
      {weather.state === 'notConfigured' && <Note text={t('sensors.weather.notConfigured')} />}
      {weather.state === 'available' &&
        rows.map(([label, value]) => <Row key={label} label={label} value={value} />)}
      {weather.failure && (
        <Text accessibilityRole="alert" style={boardStyles.warning}>
          {weather.failure}
        </Text>
      )}
      {[...new Set(weather.details)].map((detail) => (
        <Note key={detail} text={detail} />
      ))}
    </>
  );
}
