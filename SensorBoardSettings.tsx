import type { SensorBoardRequest, SensorPermission } from '@kenshiki/identity-capture';
import { Alert, Linking, Share, Switch, View } from 'react-native';
import { Action } from './IdentityCaptureFlow';
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
    { text: 'Cancel', style: 'cancel' },
    { text: label, style: 'destructive', onPress: () => perform(request) },
  ]);
}
export function SensorSettings(props: SettingsProps) {
  const { board, busy, perform, onFailure } = props;
  return (
    <>
      <Section title={copy('export.header')}>
        <Row label="Readings kept" value={board.evidence.count} />
        <Action
          label="Prepare export"
          disabled={busy || board.evidence.count === 0}
          onPress={() => perform({ action: 'export', consent: true })}
        />
        {board.evidence.exportURL && (
          <Action
            label="Share export"
            onPress={() => {
              const url = board.evidence.exportURL;
              if (url?.startsWith('file://'))
                Share.share({ url }).catch(() => onFailure('The export could not be shared.'));
              else onFailure('The export is not a local file.');
            }}
          />
        )}
        <Action
          secondary
          label="Tamper with newest reading"
          disabled={busy || board.evidence.count === 0}
          onPress={() =>
            confirm(
              'Tamper with reading',
              'This deliberately changes the newest local evidence to test verification.',
              { action: 'tamper', consent: true },
              perform,
            )
          }
        />
        <Action
          secondary
          label="Forget exported readings"
          disabled={busy}
          onPress={() =>
            confirm(
              'Forget readings',
              'Remove this host’s retained export evidence.',
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
            label={`${board.units === units ? '✓ ' : ''}${plain(units)}`}
            disabled={busy}
            onPress={() => perform({ action: 'units', units })}
          />
        ))}
      </Section>
      <PermissionSettings {...props} />
      <WindowSettings {...props} />
      <Section title={copy('erase.header')}>
        <Action
          label="Erase local sensor data"
          disabled={busy}
          onPress={() =>
            confirm(
              'Erase sensor data',
              'Delete local sensor readings, continuity records, signing keys and biometric approval keys in this app. Identity documents stay on the phone. Collection will remain paused.',
              { action: 'erase', consent: true },
              perform,
            )
          }
        />
        {board.storage.eraseResults.map((result) => (
          <Row
            key={result.name}
            label={result.name}
            value={`${result.erased ? 'Erased' : 'Failed'} · ${result.detail}`}
          />
        ))}
        <Row label="Erased at" value={moment(board.storage.erasedAt)} />
        <Row
          label="Keys left"
          value={board.storage.trackers.reduce((sum, tracker) => sum + tracker.keys.length, 0)}
        />
        {board.collection.paused && (
          <Action
            label="Resume collection"
            onPress={() => perform({ action: 'resume', consent: true })}
            disabled={busy}
          />
        )}
      </Section>
      <Section title={copy('persisted.header')}>
        {board.storage.trackers.map((tracker) => (
          <View key={tracker.name}>
            <Row label={tracker.name} value={`${plain(tracker.keys.length)} saved items`} />
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
        <Row label="Provider" value="Host battery reader" />
        <Row label="Readings taken" value={board.batteryProvider.reads} />
        <Row label="Monitoring enables" value={board.batteryProvider.monitoringEnables} />
      </Section>
      <Section title={copy('gaps.header')}>
        <Note
          text={copy(
            'gaps.readBack.body',
            'Only stores with public read-back APIs can be inspected here. Erase outcomes are reported separately.',
          )}
        />
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
    else Linking.openSettings().catch(() => props.onFailure('iOS Settings could not be opened.'));
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
        name="Always allow location"
        state={permissions.location}
        value={permissions.always}
        permission="always"
        props={props}
      />
      {permissions.location === 'given' && (
        <PermissionControl
          name="Precise location"
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
          <Row label={plain(sensor)} value={`${plain(board.windows[sensor])} s`} />
          <SensorWindowSlider
            label={`${plain(sensor)} reading time`}
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
      <Row label="Shared motion capture" value={`${plain(board.windows.sharedMotion)} s`} />
      <Note text={copy('captureWindows.footer')} />
    </Section>
  );
}
