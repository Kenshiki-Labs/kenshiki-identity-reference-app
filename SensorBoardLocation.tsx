import {
  IdentitySensorMap,
  type SensorBoardRequest,
  type SensorBoardState,
} from '@kenshiki/identity-capture';
import { type ReactElement, useEffect, useState } from 'react';
import { t } from './locales/i18n';
import { note, Row, warning } from './SensorBoardRows';
import { copy, failureText, measure, moment, plain, sensorConfig } from './SensorPresentation';
import { ButtonRow, ContentRow, RowNote } from './ui/List';
export type BoardActions = {
  board: SensorBoardState;
  busy: boolean;
  perform: (request: SensorBoardRequest) => void;
};

/** The location section's rows, as SensorHost's `locationSection` lays them out: what iOS allows,
 * one fix on request, the map of this session's fixes, and the newest fix's own facts. */
export function locationRows({
  board,
  busy,
  perform,
  sessionId,
  now,
}: { sessionId: string | null; now: number } & BoardActions): ReactElement[] {
  const rows: (ReactElement | null)[] = [
    <Row key="now" label={copy('sensorGroup.now')} value={board.permissions.location} />,
    <ButtonRow
      key="getOneFix"
      label={copy('location.button.getOneFix')}
      note={copy('location.note.getOneFix')}
      disabled={busy}
      onPress={() => perform({ action: 'location', consent: true })}
    />,
    <ContentRow key="map">
      {sessionId && (
        <IdentitySensorMap
          sessionId={sessionId}
          style={{ height: sensorConfig.map.height, borderRadius: sensorConfig.map.cornerRadius }}
        />
      )}
      {board.location.trail.length === 0 && (
        <RowNote
          text={copy(
            board.permissions.location === 'given'
              ? 'location.map.empty.noFixes'
              : 'location.map.empty.locationOff',
          )}
        />
      )}
      <RowNote text={copy('location.map.note')} />
    </ContentRow>,
    <Row
      key="fixesOnMap"
      label={copy('location.map.row.fixesOnMap')}
      value={t('sensors.location.fixesOnMap', {
        count: plain(board.location.trail.length),
        limit: plain(sensorConfig.map.trailLimit),
      })}
    />,
    <ButtonRow
      key="clear"
      label={copy('location.map.button.clear')}
      disabled={busy}
      onPress={() => perform({ action: 'clearTrail', consent: true })}
    />,
    warning(board.location.failure && failureText(board.location.failure), 'failure'),
    board.location.answeredAt && !board.location.fix ? note(copy('location.note.noFix'), 'noFix') : null,
    ...fixRows(board, now),
  ];
  return rows.filter((row): row is ReactElement => row !== null);
}

/** Keeps a page's "age" row current: the now the location rows count from, once a second. */
export function useSecondClock(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function fixRows(board: SensorBoardState, now: number): (ReactElement | null)[] {
  const fix = board.location.fix;
  if (!fix) return [];
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
    [
      'fixContract',
      copy(fix.unmetTerms.length === 0 ? 'location.value.accepted' : 'location.value.notAccepted'),
    ],
    ['fixesDelivered', board.location.deliveredCount],
    ['permissionThen', board.location.permissionAtDelivery],
    ['precisionThen', board.location.precisionAtDelivery],
  ];
  return [
    ...rows.map(([key, value]) => <Row key={key} label={copy(`location.row.${key}`)} value={value} />),
    ...fix.unmetTerms.map((term) => warning(copy(`fixTerm.${term}`, plain(term)), `term-${term}`)),
    ...['position', 'accuracy', 'altitude', 'movement', 'time', 'source', 'contract'].map((key) =>
      note(copy(`location.note.${key}`), `note-${key}`),
    ),
  ];
}

/** The weather section's rows: read on request, the report when there is one, and why not. */
export function weatherRows({ board, busy, perform }: BoardActions): ReactElement[] {
  const weather = board.weather;
  const values: [string, unknown][] = [
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
  const rows: (ReactElement | null)[] = [
    <ButtonRow
      key="read"
      label={copy('weather.button.read')}
      note={t('sensors.weather.note')}
      disabled={busy}
      onPress={() => perform({ action: 'weather', consent: true })}
    />,
    ...(weather.state === 'available'
      ? values.map(([label, value]) => <Row key={label} label={label} value={value} />)
      : []),
    warning(weather.failure && failureText(weather.failure), 'failure'),
    ...[...new Set(weather.details)].map((detail) => note(detail, `detail-${detail}`)),
  ];
  return rows.filter((row): row is ReactElement => row !== null);
}
