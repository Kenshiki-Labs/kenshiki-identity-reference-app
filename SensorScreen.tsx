import type { Configuration } from '@kenshiki/identity-capture';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { Alert, AppState, ScrollView, Text, View } from 'react-native';
import { Action, styles } from './IdentityCaptureFlow';
import { t } from './locales/i18n';
import { SensorBoardController, type SensorBoardPresentation } from './SensorBoardController';
import { SensorDocuments } from './SensorBoardDocuments';
import { type BoardActions, LocationRows, WeatherRows } from './SensorBoardLocation';
import { boardStyles, Note, Row, Section, SensorIconContext, SignalRows } from './SensorBoardRows';
import { SensorSettings } from './SensorBoardSettings';
import { copy, moment, pages, permissioned, prefix, type SensorPage, title } from './SensorPresentation';

type SensorSessionValue = {
  state: SensorBoardPresentation;
  failure: string | null;
  setFailure: (message: string | null) => void;
  perform: BoardActions['perform'];
};
const closed: SensorBoardPresentation = { board: null, busy: false, failure: null, sessionId: null };
const SensorSessionContext = createContext<SensorSessionValue>({
  state: closed,
  failure: null,
  setFailure: () => {},
  perform: () => {},
});

/** Owns the one sensor board session while any sensor screen is open. The board, its detail pages
 * and its settings are separate pushed screens that share it; leaving the last of them releases it,
 * and opening the board again starts a new session. */
export function SensorSession({
  configuration,
  open,
  children,
}: {
  configuration: Configuration;
  open: boolean;
  children: ReactNode;
}) {
  const [controller, setController] = useState<SensorBoardController>();
  const [state, setState] = useState<SensorBoardPresentation>(closed);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const active = new SensorBoardController(configuration, (next) => {
      if (live) setState(next);
    });
    setController(active);
    setFailure(null);
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
      setController(undefined);
      setState(closed);
      active.dispose().catch(() => {
        Alert.alert(t('sensors.failure.closeTitle'), t('sensors.failure.closeBody'));
      });
    };
  }, [configuration, open]);
  const perform: BoardActions['perform'] = (request) => {
    setFailure(null);
    controller?.perform(request).catch(() => setFailure(t('sensors.failure.request')));
  };
  return (
    <SensorSessionContext.Provider value={{ state, failure, setFailure, perform }}>
      {children}
    </SensorSessionContext.Provider>
  );
}

/** The board: every sensor section, grouped by whether iOS asks permission first. */
export function SensorBoardScreen({ onOpenPage }: { onOpenPage: (page: SensorPage) => void }) {
  const { state, perform } = useContext(SensorSessionContext);
  const board = state.board;
  return (
    <SensorScroll enabledIcons testID="sensor-screen">
      {board && (
        <>
          {board.reading?.deviceSurface.simulator && <Note text={t('sensors.notice.simulator')} />}
          {board.permissions.motion !== 'given' && <Note text={t('sensors.notice.motion')} />}
          {[false, true].map((requiresPermission) => (
            <View key={String(requiresPermission)}>
              <Text accessibilityRole="header" style={boardStyles.group}>
                {requiresPermission ? t('sensors.group.permissioned') : t('sensors.group.free')}
              </Text>
              {pages
                .filter((page) => permissioned(page) === requiresPermission)
                .map((page) => (
                  <View key={page}>
                    <SensorSection
                      board={board}
                      busy={state.busy}
                      perform={perform}
                      page={page}
                      sessionId={state.sessionId}
                    />
                    <Action
                      secondary
                      label={t('sensors.about', { title: title(page) })}
                      onPress={() => onOpenPage(page)}
                    />
                  </View>
                ))}
            </View>
          ))}
        </>
      )}
    </SensorScroll>
  );
}

/** One section with Apple's documentation for it and, where one exists, its algorithm. */
export function SensorDetailScreen({ page }: { page: SensorPage }) {
  const { state, perform, setFailure } = useContext(SensorSessionContext);
  const board = state.board;
  return (
    <SensorScroll enabledIcons={false} testID="sensor-detail">
      {board && (
        <SensorSection
          board={board}
          busy={state.busy}
          perform={perform}
          page={page}
          sessionId={state.sessionId}
        />
      )}
      <SensorDocuments page={page} onFailure={setFailure} />
    </SensorScroll>
  );
}

/** Export, units, permissions, reading windows, erase, stores, environment and limits, followed by
 * whatever settings of its own the app adds. */
export function SensorSettingsScreen({ children }: { children?: ReactNode }) {
  const { state, perform, setFailure } = useContext(SensorSessionContext);
  const board = state.board;
  return (
    <SensorScroll enabledIcons collectionControl={false} testID="sensor-settings">
      {board && <SensorSettings board={board} busy={state.busy} perform={perform} onFailure={setFailure} />}
      {children}
    </SensorScroll>
  );
}

/** What every sensor screen shows above its own content: failures, the opening state and, on the
 * board, the control that pauses or resumes collection. */
function SensorScroll({
  enabledIcons,
  collectionControl = true,
  testID,
  children,
}: {
  enabledIcons: boolean;
  collectionControl?: boolean;
  testID: string;
  children: ReactNode;
}) {
  const { state, failure, perform } = useContext(SensorSessionContext);
  const board = state.board;
  const shown = failure || state.failure;
  return (
    <SensorIconContext.Provider value={{ sessionId: state.sessionId, enabled: enabledIcons }}>
      <ScrollView
        style={styles.root}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        testID={testID}
      >
        {shown && (
          <Text accessibilityRole="alert" style={boardStyles.warning}>
            {shown}
          </Text>
        )}
        {!board && <Note text={t('sensors.opening')} />}
        {board && collectionControl && (
          <Action
            label={board.collection.paused ? t('sensors.resume') : t('sensors.pause')}
            disabled={state.busy}
            onPress={() =>
              perform(board.collection.paused ? { action: 'resume', consent: true } : { action: 'pause' })
            }
          />
        )}
        {children}
      </ScrollView>
    </SensorIconContext.Provider>
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
