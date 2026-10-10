import type { SensorBoardRequest, SensorPermission, SensorUnits } from '@kenshiki/identity-capture';
import { Linking, Share } from 'react-native';
import { t } from './locales/i18n';
import type { BoardActions } from './SensorBoardLocation';
import { Row, Section, warning } from './SensorBoardRows';
import { SensorWindowSlider } from './SensorBoardSlider';
import { copy, failureText, moment, plain } from './SensorPresentation';
import { ButtonRow, CheckRow, ContentRow, RowNote, SwitchRow, TitleRow, ValueLine } from './ui/List';
import { confirmDestructive } from './ui/NativeSheet';

type SettingsProps = BoardActions & { onFailure: (message: string) => void };

/** Asks before a destructive board action, with the iOS action sheet. */
function confirm(
  title: string,
  message: string,
  label: string,
  request: SensorBoardRequest,
  perform: BoardActions['perform'],
) {
  confirmDestructive({
    title,
    message,
    confirm: label,
    keep: t('common.cancel'),
    onConfirm: () => perform(request),
  });
}

/** The Settings tab's sensor sections, in SensorHost's order: export, units, permissions, reading
 * time, erase, what is saved, where it is kept, the battery reader and what cannot be checked. */
export function SensorSettings(props: SettingsProps) {
  const { board, busy, perform, onFailure } = props;
  const exportURL = board.evidence.exportURL;
  return (
    <>
      <Section section="export">
        <Row label={copy('export.row.kept')} value={board.evidence.count} />
        <ButtonRow
          label={t('sensors.export.prepare')}
          disabled={busy || board.evidence.count === 0}
          onPress={() => perform({ action: 'export', consent: true })}
        />
        {exportURL ? (
          <ButtonRow
            label={t('sensors.export.share')}
            onPress={() => {
              if (exportURL.startsWith('file://'))
                Share.share({ url: exportURL }).catch(() => onFailure(t('sensors.export.shareFailed')));
              else onFailure(t('sensors.export.notLocal'));
            }}
          />
        ) : null}
        {/* Altering a signed reading is a developer's check that verification catches it. The
            build configuration decides: a Release bundle compiles __DEV__ to false, so the row
            and its request are not in it. */}
        {__DEV__ ? (
          <ButtonRow
            destructive
            testID="sensor-tamper"
            label={t('sensors.export.tamper')}
            disabled={busy || board.evidence.count === 0}
            onPress={() =>
              confirm(
                t('sensors.export.tamperTitle'),
                t('sensors.export.tamperBody'),
                t('sensors.export.tamper'),
                { action: 'tamper', consent: true },
                perform,
              )
            }
          />
        ) : null}
        <ButtonRow
          destructive
          label={t('sensors.export.forget')}
          disabled={busy}
          onPress={() =>
            confirm(
              t('sensors.export.forgetTitle'),
              t('sensors.export.forgetBody'),
              t('sensors.export.forget'),
              { action: 'forget', consent: true },
              perform,
            )
          }
        />
        {warning(board.evidence.failure && failureText(board.evidence.failure))}
      </Section>
      <Section section="units">
        {(['system', 'metric', 'imperial'] as const satisfies readonly SensorUnits[]).map((units) => (
          <CheckRow
            key={units}
            label={copy(`units.${units}`, plain(units))}
            selected={board.units === units}
            disabled={busy}
            onPress={() => perform({ action: 'units', units })}
          />
        ))}
        <Row label={copy('units.metric')} value={copy('units.metric.example')} />
        <Row label={copy('units.imperial')} value={copy('units.imperial.example')} />
      </Section>
      <PermissionSettings {...props} />
      <WindowSettings {...props} />
      <Section section="erase">
        <ButtonRow
          destructive
          label={t('sensors.erase.action')}
          disabled={busy}
          onPress={() =>
            confirm(
              t('sensors.erase.title'),
              t('sensors.erase.body'),
              t('sensors.erase.action'),
              { action: 'erase', consent: true },
              perform,
            )
          }
        />
        {board.storage.eraseResults.map((result) => (
          <Row
            key={result.name}
            label={copy(`savedData.${result.name}`, plain(result.name))}
            value={copy(result.erased ? 'erase.status.erased' : 'erase.status.failed')}
          />
        ))}
        <Row label={copy('erase.row.erasedAt')} value={moment(board.storage.erasedAt)} />
        <Row
          label={copy('erase.row.keysLeft')}
          value={board.storage.trackers.reduce((sum, tracker) => sum + tracker.keys.length, 0)}
        />
        {board.collection.paused ? (
          <ButtonRow
            label={t('sensors.resumeCollection')}
            onPress={() => perform({ action: 'resume', consent: true })}
            disabled={busy}
          />
        ) : null}
      </Section>
      <Section section="persisted">
        {board.storage.trackers.flatMap((tracker) => [
          <Row
            key={tracker.name}
            label={copy(`savedData.${tracker.name}`, plain(tracker.name))}
            value={
              tracker.keys.length
                ? t('sensors.persisted.savedItems', { count: plain(tracker.keys.length) })
                : copy('persisted.value.nothing')
            }
          />,
          ...Object.entries(tracker.counts).map(([name, count]) => (
            <Row key={`${tracker.name}-${name}`} label={plain(name)} value={count} />
          )),
        ])}
      </Section>
      <Section section="environment">
        {(
          [
            ['defaultsSuite', board.environment.defaultsSuiteName],
            ['durableRoot', board.environment.directoryURL],
            ['applicationIdentifier', board.environment.applicationIdentifier],
            [
              'beforeSuite',
              board.environment.unconfiguredDefaultsSuiteName ?? copy('environment.value.standardDomain'),
            ],
            ['beforeRoot', board.environment.unconfiguredDirectoryURL],
            [
              'beforeIdentifier',
              board.environment.unconfiguredApplicationIdentifier ?? copy('common.notGiven'),
            ],
          ] as const
        ).map(([key, value]) => (
          <Row key={key} label={copy(`environment.row.${key}`)} value={value} />
        ))}
      </Section>
      <Section section="batterySeam">
        <Row label={copy('batterySeam.row.provider')} value={copy('batterySeam.value.provider')} />
        <Row label={copy('batterySeam.row.readingsTaken')} value={board.batteryProvider.reads} />
        <Row
          label={copy('batterySeam.row.monitoringEnables')}
          value={board.batteryProvider.monitoringEnables}
        />
      </Section>
      <Section section="gaps">
        <TitleRow title={copy('gaps.readBack.title')} detail={copy('gaps.readBack.body')} />
      </Section>
    </>
  );
}

type Permission = 'motion' | 'bluetooth' | 'location' | 'always' | 'precise';
function PermissionControl({
  title,
  state,
  value,
  permission,
  props,
}: Readonly<{
  title: string;
  state: SensorPermission;
  value: boolean;
  permission: Permission;
  props: SettingsProps;
}>) {
  const change = (wanted: boolean) => {
    const canRequest =
      wanted &&
      permission !== 'precise' &&
      (state === 'notRequested' || (permission === 'always' && state !== 'refused' && !value));
    if (canRequest) props.perform({ action: 'permission', consent: true, permission });
    else Linking.openSettings().catch(() => props.onFailure(t('sensors.failure.settings')));
  };
  const notes: Record<Permission, string> = {
    motion: 'permissions.motion.note',
    bluetooth: 'permissions.bluetooth.note',
    location: 'permissions.whileUsing.note',
    always: 'permissions.always.note',
    precise: 'permissions.precise.note',
  };
  const words =
    permission === 'always'
      ? copy(value ? 'permissions.always.state.granted' : 'permissions.always.state.notGranted')
      : plain(state);
  return (
    <SwitchRow
      title={title}
      state={words}
      note={copy(notes[permission])}
      value={value}
      disabled={props.busy}
      onChange={change}
    />
  );
}
function PermissionSettings(props: SettingsProps) {
  const permissions = props.board.permissions;
  return (
    <Section section="permissions">
      {(['motion', 'bluetooth', 'location'] as const).map((permission) => (
        <PermissionControl
          key={permission}
          title={copy(`permissions.${permission === 'location' ? 'whileUsing' : permission}.title`)}
          state={permissions[permission]}
          value={permissions[permission] === 'given'}
          permission={permission}
          props={props}
        />
      ))}
      <PermissionControl
        title={t('sensors.permission.always')}
        state={permissions.location}
        value={permissions.always}
        permission="always"
        props={props}
      />
      {permissions.location === 'given' ? (
        <PermissionControl
          title={copy('permissions.precise.title')}
          state={permissions.location}
          value={permissions.precise}
          permission="precise"
          props={props}
        />
      ) : null}
    </Section>
  );
}
function WindowSettings({ board, busy, perform }: SettingsProps) {
  const sensors = ['motion', 'magnetometer', 'barometer'] as const;
  return (
    <Section section="captureWindows">
      {sensors.map((sensor) => (
        <ContentRow key={sensor}>
          <ValueLine
            label={copy(`captureWindows.${sensor}.label`, plain(sensor))}
            value={t('sensors.seconds', { value: plain(board.windows[sensor]) })}
          />
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
          <RowNote text={copy(`captureWindows.${sensor}.note`)} />
        </ContentRow>
      ))}
      <ContentRow>
        <ValueLine
          label={t('sensors.window.shared')}
          value={t('sensors.seconds', { value: plain(board.windows.sharedMotion) })}
        />
        <RowNote text={copy('captureWindows.note.sharedCapture')} />
      </ContentRow>
    </Section>
  );
}
