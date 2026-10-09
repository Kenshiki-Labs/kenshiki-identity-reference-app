import type { Configuration } from '@kenshiki/identity-capture';
import { useEffect, useState } from 'react';
import { Alert, AppState, ScrollView, Text, View } from 'react-native';
import { Action, styles } from './IdentityCaptureFlow';
import { t } from './locales/i18n';
import { SensorBoardController, type SensorBoardPresentation } from './SensorBoardController';
import { SensorDocuments } from './SensorBoardDocuments';
import { type BoardActions, LocationRows, WeatherRows } from './SensorBoardLocation';
import { boardStyles, Note, Row, Section, SensorIconContext, SignalRows } from './SensorBoardRows';
import { SensorSettings } from './SensorBoardSettings';
import { copy, moment, pages, permissioned, prefix, type SensorPage, title } from './SensorPresentation';
export function SensorScreen({
  configuration,
  onExit,
}: {
  configuration: Configuration;
  onExit: () => void;
}) {
  const [controller, setController] = useState<SensorBoardController>();
  const [state, setState] = useState<SensorBoardPresentation>({
    board: null,
    busy: false,
    failure: null,
    sessionId: null,
  });
  const [failure, setFailure] = useState<string | null>(null);
  const [tab, setTab] = useState<'sensors' | 'settings'>('sensors');
  const [page, setPage] = useState<SensorPage | null>(null);
  useEffect(() => {
    let live = true;
    const active = new SensorBoardController(configuration, (next) => {
      if (live) setState(next);
    });
    setController(active);
    active.open().catch(() => {
      if (live) setFailure(t('sensors.failure.open'));
    });
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'inactive') return;
      active.setActive(next === 'active').catch(() => {
        if (live) setFailure(t('sensors.failure.activity'));
      });
    });
    return () => {
      live = false;
      subscription.remove();
      active.dispose().catch(() => {
        Alert.alert(t('sensors.failure.closeTitle'), t('sensors.failure.closeBody'));
      });
    };
  }, [configuration]);
  const perform: BoardActions['perform'] = (request) => {
    setFailure(null);
    controller?.perform(request).catch(() => setFailure(t('sensors.failure.request')));
  };
  const board = state.board;
  return (
    <SensorIconContext.Provider value={{ sessionId: state.sessionId, enabled: page === null }}>
      <ScrollView style={styles.root} contentContainerStyle={styles.content} testID="sensor-screen">
        <Action label={t('common.backToIdentity')} secondary onPress={onExit} />
        <View style={boardStyles.tabs}>
          <Action
            label={copy('tab.sensors.title')}
            secondary
            onPress={() => {
              setTab('sensors');
              setPage(null);
            }}
          />
          <Action
            label={copy('tab.settings.title')}
            secondary
            onPress={() => {
              setTab('settings');
              setPage(null);
            }}
          />
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {page ? title(page) : copy(tab === 'sensors' ? 'tab.sensors.title' : 'tab.settings.title')}
        </Text>
        {(failure || state.failure) && (
          <Text accessibilityRole="alert" style={boardStyles.warning}>
            {failure || state.failure}
          </Text>
        )}
        {!board && <Note text={t('sensors.opening')} />}
        {board && (
          <>
            <Action
              label={board.collection.paused ? t('sensors.resume') : t('sensors.pause')}
              disabled={state.busy}
              onPress={() =>
                perform(board.collection.paused ? { action: 'resume', consent: true } : { action: 'pause' })
              }
            />
            {tab === 'settings' ? (
              <SensorSettings board={board} busy={state.busy} perform={perform} onFailure={setFailure} />
            ) : (
              <SensorContents
                board={board}
                busy={state.busy}
                perform={perform}
                page={page}
                setPage={setPage}
                sessionId={state.sessionId}
                onFailure={setFailure}
              />
            )}
          </>
        )}
      </ScrollView>
    </SensorIconContext.Provider>
  );
}
type ContentsProps = BoardActions & {
  page: SensorPage | null;
  setPage: (page: SensorPage | null) => void;
  sessionId: string | null;
  onFailure: (message: string) => void;
};
function SensorContents(props: ContentsProps) {
  if (props.page)
    return (
      <>
        <Action secondary label={t('sensors.allSensors')} onPress={() => props.setPage(null)} />
        <SensorSection {...props} page={props.page} />
        <SensorDocuments page={props.page} onFailure={props.onFailure} />
      </>
    );
  return (
    <>
      {props.board.reading?.deviceSurface.simulator && <Note text={t('sensors.notice.simulator')} />}
      {props.board.permissions.motion !== 'given' && <Note text={t('sensors.notice.motion')} />}
      {[false, true].map((requiresPermission) => (
        <View key={String(requiresPermission)}>
          <Text style={boardStyles.group}>
            {requiresPermission ? t('sensors.group.permissioned') : t('sensors.group.free')}
          </Text>
          {pages
            .filter((page) => permissioned(page) === requiresPermission)
            .map((page) => (
              <View key={page}>
                <SensorSection {...props} page={page} />
                <Action
                  secondary
                  label={t('sensors.about', { title: title(page) })}
                  onPress={() => props.setPage(page)}
                />
              </View>
            ))}
        </View>
      ))}
    </>
  );
}
function SensorSection({
  board,
  busy,
  perform,
  page,
  sessionId,
}: BoardActions & { page: SensorPage; sessionId: string | null }) {
  return (
    <Section title={title(page)}>
      <Note text={copy(`meaning.${page}`, '')} />
      {page === 'status' ? (
        <>
          <Row label={copy('collection.row.collectedAt')} value={moment(board.collection.collectedAt)} />
          <Row
            label={copy('collection.row.state')}
            value={
              board.collection.paused
                ? t('sensors.state.paused')
                : copy(busy ? 'collection.state.collecting' : 'collection.state.idle')
            }
          />
          {board.collection.failure && <Note text={board.collection.failure} />}
        </>
      ) : null}
      {page === 'location' && (
        <LocationRows board={board} busy={busy} perform={perform} sessionId={sessionId} />
      )}
      {page === 'weather' && <WeatherRows board={board} busy={busy} perform={perform} />}
      {!['status', 'location', 'weather'].includes(page) && <SignalRows board={board} page={page} />}
      <Note text={copy(`${prefix(page)}.footer`, '')} />
    </Section>
  );
}
