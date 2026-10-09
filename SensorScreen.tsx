import type { Configuration } from '@kenshiki/identity-capture';
import { useEffect, useState } from 'react';
import { Alert, AppState, ScrollView, Text, View } from 'react-native';
import { Action, styles } from './IdentityCaptureFlow';
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
      if (live) setFailure('Sensors could not be opened.');
    });
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'inactive') return;
      active.setActive(next === 'active').catch(() => {
        if (live) setFailure('Sensors could not change activity state.');
      });
    });
    return () => {
      live = false;
      subscription.remove();
      active.dispose().catch(() => {
        Alert.alert('Sensors could not close', 'Reopen the app before starting another sensor session.');
      });
    };
  }, [configuration]);
  const perform: BoardActions['perform'] = (request) => {
    setFailure(null);
    controller
      ?.perform(request)
      .catch(() => setFailure('The request stopped. Check permissions or try again.'));
  };
  const board = state.board;
  return (
    <SensorIconContext.Provider value={{ sessionId: state.sessionId, enabled: page === null }}>
      <ScrollView
        contentContainerStyle={[styles.content, { backgroundColor: '#f2f2f7' }]}
        testID="sensor-screen"
      >
        <Action label="Back to Identity" secondary onPress={onExit} />
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <Action
            label="Sensors"
            secondary
            onPress={() => {
              setTab('sensors');
              setPage(null);
            }}
          />
          <Action
            label="Settings"
            secondary
            onPress={() => {
              setTab('settings');
              setPage(null);
            }}
          />
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {page ? title(page) : tab === 'sensors' ? 'Sensors' : 'Settings'}
        </Text>
        {(failure || state.failure) && (
          <Text accessibilityRole="alert" style={boardStyles.warning}>
            {failure || state.failure}
          </Text>
        )}
        {!board && <Note text="Opening sensors…" />}
        {board && (
          <>
            <Action
              label={board.collection.paused ? 'Resume sensors' : 'Pause sensors'}
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
        <Action secondary label="All sensors" onPress={() => props.setPage(null)} />
        <SensorSection {...props} page={props.page} />
        <SensorDocuments page={props.page} onFailure={props.onFailure} />
      </>
    );
  return (
    <>
      {props.board.reading?.deviceSurface.simulator && (
        <Note text={copy('sensorGroup.simulatorNotice', 'Simulator readings are limited.')} />
      )}
      {props.board.permissions.motion !== 'given' && (
        <Note
          text={copy('sensorGroup.motionNotice', 'Enable Motion & Fitness in Settings to read air pressure.')}
        />
      )}
      {[false, true].map((requiresPermission) => (
        <View key={String(requiresPermission)}>
          <Text style={boardStyles.group}>
            {requiresPermission ? 'With your permission' : 'Freely readable'}
          </Text>
          {pages
            .filter((page) => permissioned(page) === requiresPermission)
            .map((page) => (
              <View key={page}>
                <SensorSection {...props} page={page} />
                <Action secondary label={`About ${title(page)}`} onPress={() => props.setPage(page)} />
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
          <Row label="Last read" value={moment(board.collection.collectedAt)} />
          <Row label="Now" value={board.collection.paused ? 'Paused' : busy ? 'Reading…' : 'Waiting'} />
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
