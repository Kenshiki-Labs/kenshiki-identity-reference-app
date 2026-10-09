import {
  IdentitySensorMap,
  type SensorBoardRequest,
  type SensorBoardState,
} from '@kenshiki/identity-capture';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Action } from './IdentityCaptureFlow';
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
      <Row label="Now" value={board.permissions.location} />
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
        value={`${plain(board.location.trail.length)} of ${plain(sensorConfig.map.trailLimit)}`}
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
      fix.horizontalAccuracy < 0 ? 'Not valid' : measure(fix.horizontalAccuracy, 'distance', board),
    ],
    [
      'verticalAccuracy',
      fix.verticalAccuracy < 0 ? 'Not valid' : measure(fix.verticalAccuracy, 'distance', board),
    ],
    ['altitude', measure(fix.altitude, 'distance', board)],
    ['speed', measure(fix.speed, 'speed', board)],
    ['course', measure(fix.course, '°', board)],
    ['measuredAt', moment(fix.measuredAt)],
    ['age', age < 0 ? copy('location.value.inTheFuture') : `${plain(Math.floor(age))} s`],
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
    ['Pressure', measure(weather.pressureKPa, 'pressure', board)],
    ['Temperature', measure(weather.temperatureC, 'temperature', board)],
    ['Humidity', measure(weather.humidityPercent, '%', board)],
    ['Station', [weather.stationName, weather.stationID].filter(Boolean).join(' · ')],
    ['Distance', measure(weather.distanceMeters, 'distance', board)],
    ['Station height', measure(weather.stationElevationMeters, 'distance', board)],
    ['Quality', weather.quality],
    ['Source', weather.source],
    ['Reported at', moment(weather.observedAt)],
    ['Read at', moment(weather.readAt)],
  ];
  return (
    <>
      <Action
        label={copy('weather.button.read', 'Read weather')}
        disabled={busy}
        onPress={() => perform({ action: 'weather', consent: true })}
      />
      <Note text="Weather uses the phone’s position to request a report from the configured weather service." />
      {weather.state === 'notConfigured' && <Note text="Weather is not configured in this host." />}
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
