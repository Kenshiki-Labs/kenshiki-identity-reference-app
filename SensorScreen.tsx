import type { Configuration, SensorBoardState } from '@kenshiki/identity-capture';
import { createContext, type ReactElement, type ReactNode, useContext, useEffect, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet } from 'react-native';
import { t } from './locales/i18n';
import { SensorBoardController, type SensorBoardPresentation } from './SensorBoardController';
import { SensorDocuments } from './SensorBoardDocuments';
import { type BoardActions, locationRows, useSecondClock, weatherRows } from './SensorBoardLocation';
import { note, Row, Section, SensorIconContext, signalRows, warning } from './SensorBoardRows';
import { SensorSettings } from './SensorBoardSettings';
import {
  copy,
  failureText,
  moment,
  pages,
  permissioned,
  prefix,
  type SensorPage,
  title,
} from './SensorPresentation';
import { BarButton, ListGroupTitle, ListRow, ListSection, TextRow } from './ui/List';
import { color, spacing } from './ui/tokens.generated';

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
 * and its settings are separate screens that share it; leaving the last of them releases it, and
 * opening the board again starts a new session. */
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

/** Pause or Resume, for the Sensors tab's navigation bar: collection is the screen's one control. */
export function SensorCollectionButton() {
  const { state, perform } = useContext(SensorSessionContext);
  const board = state.board;
  if (!board) return null;
  const paused = board.collection.paused;
  return (
    <BarButton
      label={paused ? t('sensors.resume') : t('sensors.pause')}
      disabled={state.busy}
      onPress={() => perform(paused ? { action: 'resume', consent: true } : { action: 'pause' })}
    />
  );
}

/** The board: every sensor section, grouped by whether iOS asks permission first, as SensorHost's
 * Sensors tab lists them. Each section's last row opens its page. */
export function SensorBoardScreen({ onOpenPage }: { onOpenPage: (page: SensorPage) => void }) {
  const { state, perform } = useContext(SensorSessionContext);
  const board = state.board;
  const now = useSecondClock();
  return (
    <SensorScroll enabledIcons testID="sensor-screen">
      {board ? (
        <>
          <ListSection>
            {board.reading?.deviceSurface.simulator ? note(copy('sensorGroup.notice.simulator')) : null}
            {board.permissions.motion !== 'given' ? warning(copy('sensorGroup.notice.motion')) : null}
          </ListSection>
          {[false, true].map((requiresPermission) => [
            <ListGroupTitle
              key={`group-${String(requiresPermission)}`}
              title={copy(requiresPermission ? 'sensorGroup.permissioned' : 'sensorGroup.free')}
              note={copy(requiresPermission ? 'sensorGroup.permissioned.note' : 'sensorGroup.free.note')}
            />,
            ...pages
              .filter((page) => permissioned(page) === requiresPermission)
              .map((page) => (
                <Section key={page} section={prefix(page)}>
                  {pageRows(page, { board, busy: state.busy, perform }, state.sessionId, now)}
                  <ListRow
                    label={t('sensors.about', { title: title(page) })}
                    onPress={() => onOpenPage(page)}
                  />
                </Section>
              )),
          ])}
        </>
      ) : null}
    </SensorScroll>
  );
}

/** One sensor's page: its section without a header, since the page's title names it, then Apple's
 * documentation for it and, where the SDK computes the value, how. */
export function SensorDetailScreen({ page }: { page: SensorPage }) {
  const { state, perform, setFailure } = useContext(SensorSessionContext);
  const board = state.board;
  const now = useSecondClock();
  return (
    <SensorScroll enabledIcons={false} testID="sensor-detail">
      {board ? (
        <Section section={prefix(page)} heading={false}>
          {pageRows(page, { board, busy: state.busy, perform }, state.sessionId, now)}
        </Section>
      ) : null}
      <SensorDocuments page={page} onFailure={setFailure} />
    </SensorScroll>
  );
}

/** Export, units, permissions, reading time, erase, stores, where data is kept and limits, followed
 * by whatever settings of its own the app adds. */
export function SensorSettingsScreen({ children }: { children?: ReactNode }) {
  const { state, perform, setFailure } = useContext(SensorSessionContext);
  const board = state.board;
  return (
    <SensorScroll enabledIcons testID="sensor-settings">
      {board ? (
        <SensorSettings board={board} busy={state.busy} perform={perform} onFailure={setFailure} />
      ) : null}
      {children}
    </SensorScroll>
  );
}

/** What every sensor screen shows above its own sections: a failure, or that the board is still
 * opening. */
function SensorScroll({
  enabledIcons,
  testID,
  children,
}: {
  enabledIcons: boolean;
  testID: string;
  children: ReactNode;
}) {
  const { state, failure } = useContext(SensorSessionContext);
  const shown = failure || state.failure;
  return (
    <SensorIconContext.Provider value={{ sessionId: state.sessionId, enabled: enabledIcons }}>
      <ScrollView
        style={scrollStyles.root}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={scrollStyles.content}
        testID={testID}
      >
        <ListSection>
          {shown ? <TextRow text={shown} tone="warning" alert /> : null}
          {state.board ? null : <TextRow text={t('sensors.opening')} />}
        </ListSection>
        {children}
      </ScrollView>
    </SensorIconContext.Provider>
  );
}

/** A sensor's rows, as SensorHost lays out each section: what the sensor tells you, then its
 * values. One element per row. */
function pageRows(
  page: SensorPage,
  actions: BoardActions,
  sessionId: string | null,
  now: number,
): (ReactElement | null)[] {
  const { board, busy } = actions;
  const meaning = note(copy(`meaning.${page}`, ''), 'meaning');
  if (page === 'status') return [meaning, ...statusRows(board, busy)];
  if (page === 'location') return [meaning, ...locationRows({ ...actions, sessionId, now })];
  if (page === 'weather') return [meaning, ...weatherRows(actions)];
  return [meaning, ...signalRows(board, page)];
}

function statusRows(board: SensorBoardState, busy: boolean): (ReactElement | null)[] {
  return [
    <Row
      key="collectedAt"
      label={copy('collection.row.collectedAt')}
      value={moment(board.collection.collectedAt)}
    />,
    <Row
      key="state"
      label={copy('collection.row.state')}
      value={
        board.collection.paused
          ? t('sensors.state.paused')
          : copy(busy ? 'collection.state.collecting' : 'collection.state.idle')
      }
    />,
    warning(board.collection.failure && failureText(board.collection.failure), 'failure'),
  ];
}

const scrollStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxxxl, gap: spacing.lg },
});
