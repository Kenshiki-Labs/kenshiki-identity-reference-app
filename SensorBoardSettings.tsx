import type { SensorBoardRequest, SensorPermission } from '@kenshiki/identity-capture';
import { Alert, Linking, Share, Switch, View } from 'react-native';
import { Action } from './IdentityCaptureFlow';
import { t } from './locales/i18n';
import type { BoardActions } from './SensorBoardLocation';
import { Note, Row, Section } from './SensorBoardRows';
import { SensorWindowSlider } from './SensorBoardSlider';
import { copy, moment, plain } from './SensorPresentation';

type SettingsProps = BoardActions & { onFailure: (message: string) => void };
function confirm(
  label: string,
  message: string,
  request: SensorBoardRequest,
  perform: BoardActions['perform'],
) {
  Alert.alert(label, message, [
    { text: t('common.cancel'), style: 'cancel' },
    { text: label, style: 'destructive', onPress: () => perform(request) },
  ]);
}
export function SensorSettings(props: SettingsProps) {
  const { board, busy, perform, onFailure } = props;
  return (
    <>
      <Section title={copy('export.header')}>
        <Row label={copy('export.row.kept')} value={board.evidence.count} />
        <Action
          label={t('sensors.export.prepare')}
          disabled={busy || board.evidence.count === 0}
          onPress={() => perform({ action: 'export', consent: true })}
        />
        {board.evidence.exportURL && (
          <Action
            label={t('sensors.export.share')}
            onPress={() => {
              const url = board.evidence.exportURL;
              if (url?.startsWith('file://'))
                Share.share({ url }).catch(() => onFailure(t('sensors.export.shareFailed')));
              else onFailure(t('sensors.export.notLocal'));
            }}
          />
        )}
        <Action
          destructive
          label={t('sensors.export.tamper')}
          disabled={busy || board.evidence.count === 0}
          onPress={() =>
            confirm(
              t('sensors.export.tamperTitle'),
              t('sensors.export.tamperBody'),
              { action: 'tamper', consent: true },
              perform,
            )
          }
        />
        <Action
          destructive
          label={t('sensors.export.forget')}
          disabled={busy}
          onPress={() =>
            confirm(
              t('sensors.export.forgetTitle'),
              t('sensors.export.forgetBody'),
              { action: 'forget', consent: true },
              perform,
            )
          }
        />
        {board.evidence.failure && <Note text={board.evidence.failure} />}
      </Section>
      <Section title={copy('units.header')}>
        {(['system', 'metric', 'imperial'] as const).map((units) => (
          <Action
            key={units}
            secondary
            label={board.units === units ? t('sensors.units.selected', { name: plain(units) }) : plain(units)}
            disabled={busy}
            onPress={() => perform({ action: 'units', units })}
          />
        ))}
      </Section>
      <PermissionSettings {...props} />
      <WindowSettings {...props} />
      <Section title={copy('erase.header')}>
        <Action
          destructive
          label={t('sensors.erase.action')}
          disabled={busy}
          onPress={() =>
            confirm(
              t('sensors.erase.title'),
              t('sensors.erase.body'),
              { action: 'erase', consent: true },
              perform,
            )
          }
        />
        {board.storage.eraseResults.map((result) => (
          <Row
            key={result.name}
            label={result.name}
            value={t('sensors.erase.result', {
              status: copy(result.erased ? 'erase.status.erased' : 'erase.status.failed'),
              detail: result.detail,
            })}
          />
        ))}
        <Row label={copy('erase.row.erasedAt')} value={moment(board.storage.erasedAt)} />
        <Row
          label={t('sensors.erase.keysLeft')}
          value={board.storage.trackers.reduce((sum, tracker) => sum + tracker.keys.length, 0)}
        />
        {board.collection.paused && (
          <Action
            label={t('sensors.resumeCollection')}
            onPress={() => perform({ action: 'resume', consent: true })}
            disabled={busy}
          />
        )}
      </Section>
      <Section title={copy('persisted.header')}>
        {board.storage.trackers.map((tracker) => (
          <View key={tracker.name}>
            <Row
              label={tracker.name}
              value={t('sensors.persisted.savedItems', { count: plain(tracker.keys.length) })}
            />
            {Object.entries(tracker.counts).map(([name, count]) => (
              <Row key={name} label={plain(name)} value={count} />
            ))}
          </View>
        ))}
      </Section>
      <Section title={copy('environment.header')}>
        {Object.entries(board.environment).map(([key, value]) => (
          <Row key={key} label={plain(key)} value={value} />
        ))}
      </Section>
      <Section title={copy('batterySeam.header')}>
        <Row label={t('sensors.battery.provider')} value={t('sensors.battery.hostReader')} />
        <Row label={t('sensors.battery.reads')} value={board.batteryProvider.reads} />
        <Row label={t('sensors.battery.monitoringEnables')} value={board.batteryProvider.monitoringEnables} />
      </Section>
      <Section title={copy('gaps.header')}>
        <Note text={copy('gaps.readBack.body')} />
      </Section>
    </>
  );
}
function PermissionControl({
  name,
  state,
  value,
  permission,
  props,
}: {
  name: string;
  state: SensorPermission;
  value: boolean;
  permission: 'motion' | 'bluetooth' | 'location' | 'always' | 'precise';
  props: SettingsProps;
}) {
  const change = (wanted: boolean) => {
    const canRequest =
      wanted &&
      permission !== 'precise' &&
      (state === 'notRequested' || (permission === 'always' && state !== 'refused' && !value));
    if (canRequest) props.perform({ action: 'permission', consent: true, permission });
    else Linking.openSettings().catch(() => props.onFailure(t('sensors.failure.settings')));
  };
  return (
    <View>
      <Row label={name} value={state} />
      <Switch accessibilityLabel={name} value={value} disabled={props.busy} onValueChange={change} />
    </View>
  );
}
function PermissionSettings(props: SettingsProps) {
  const permissions = props.board.permissions;
  return (
    <Section title={copy('permissions.header')}>
      {(['motion', 'bluetooth', 'location'] as const).map((permission) => (
        <PermissionControl
          key={permission}
          name={copy(`permissions.${permission === 'location' ? 'whileUsing' : permission}.title`)}
          state={permissions[permission]}
          value={permissions[permission] === 'given'}
          permission={permission}
          props={props}
        />
      ))}
      <PermissionControl
        name={t('sensors.permission.always')}
        state={permissions.location}
        value={permissions.always}
        permission="always"
        props={props}
      />
      {permissions.location === 'given' && (
        <PermissionControl
          name={copy('permissions.precise.title')}
          state={permissions.location}
          value={permissions.precise}
          permission="precise"
          props={props}
        />
      )}
      <Note text={copy('permissions.footer')} />
    </Section>
  );
}
function WindowSettings({ board, busy, perform }: SettingsProps) {
  return (
    <Section title={copy('captureWindows.header')}>
      {(['motion', 'magnetometer', 'barometer'] as const).map((sensor) => (
        <View key={sensor}>
          <Row label={plain(sensor)} value={t('sensors.seconds', { value: plain(board.windows[sensor]) })} />
          <SensorWindowSlider
            label={t('sensors.window.label', { sensor: plain(sensor) })}
            value={board.windows[sensor]}
            disabled={busy}
            onCommit={(value) =>
              perform({
                action: 'windows',
                consent: true,
                motion: board.windows.motion,
                magnetometer: board.windows.magnetometer,
                barometer: board.windows.barometer,
                [sensor]: value,
              })
            }
          />
        </View>
      ))}
      <Row
        label={t('sensors.window.shared')}
        value={t('sensors.seconds', { value: plain(board.windows.sharedMotion) })}
      />
      <Note text={copy('captureWindows.footer')} />
    </Section>
  );
}
