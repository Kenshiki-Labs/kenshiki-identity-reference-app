import type { SensorBoardRequest } from '@kenshiki/identity-capture';
import { sensorBoardFixture } from '../testing/SensorBoardFixtures';
import { mockSession } from '../testing/support';
import { SensorBoardController, type SensorBoardPresentation } from './SensorBoardController';

jest.mock('@kenshiki/identity-capture', () => ({ IdentityCaptureSession: { create: jest.fn() } }));
const configuration = {
  sensors: {
    directoryURL: 'file:///test/sensors',
    defaultsSuiteName: 'test.sensors',
    applicationIdentifier: 'test.app',
  },
};
const settle = async () => {
  for (let n = 0; n < 12; n += 1) await Promise.resolve();
};
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

function setup() {
  const board = sensorBoardFixture();
  const calls: SensorBoardRequest[] = [];
  const session = mockSession({
    sensorBoard: jest.fn(async (request: SensorBoardRequest) => {
      calls.push(request);
      return board;
    }),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  });
  const updates: SensorBoardPresentation[] = [];
  const controller = new SensorBoardController(
    configuration,
    (value) => updates.push(value),
    async () => session,
    1000,
  );
  return { controller, session, board, calls, updates };
}

test('refresh is sequential and a cancelled late reading cannot overwrite a settings response', async () => {
  const { controller, session, board, calls, updates } = setup();
  await controller.open();
  let finish: (() => void) | undefined;
  session.sensorBoard.mockImplementation(async (request) => {
    calls.push(request);
    if (request.action === 'refresh')
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return { ...board, units: request.action === 'units' ? request.units : 'system' };
  });
  jest.advanceTimersByTime(1000);
  await settle();
  jest.advanceTimersByTime(10000);
  await settle();
  expect(calls.filter((request) => request.action === 'refresh')).toHaveLength(1);
  session.cancel.mockImplementation(async () => {
    finish?.();
  });
  await controller.perform({ action: 'units', units: 'imperial' });
  expect(session.cancel).toHaveBeenCalledTimes(1);
  expect(updates.at(-1)?.board?.units).toBe('imperial');
  await controller.dispose();
});

test('erase drains live collection and a paused response prevents recollection', async () => {
  const { controller, session, board, calls } = setup();
  let finish: (() => void) | undefined;
  session.sensorBoard.mockImplementation(async (request) => {
    calls.push(request);
    if (request.action === 'refresh')
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return { ...board, collection: { ...board.collection, paused: request.action === 'erase' } };
  });
  session.cancel.mockImplementation(async () => {
    finish?.();
  });
  await controller.open();
  jest.advanceTimersByTime(1000);
  await settle();
  await controller.perform({ action: 'erase', consent: true });
  jest.advanceTimersByTime(10000);
  await settle();
  expect(calls.filter((request) => request.action === 'refresh')).toHaveLength(1);
  expect(calls.at(-1)?.action).toBe('erase');
  await controller.dispose();
});

test('background stops refresh, foreground resumes only a previously running board', async () => {
  const { controller, calls } = setup();
  await controller.open();
  await controller.setActive(false);
  jest.advanceTimersByTime(10000);
  await settle();
  expect(calls.map((request) => request.action)).toEqual(['status', 'resume', 'pause']);
  await controller.setActive(true);
  expect(calls.at(-1)?.action).toBe('resume');
  await controller.dispose();
});

test.each([false, true])(
  'closing during creation drains custody without publication (release fails: %s)',
  async (releaseFails) => {
    const { session } = setup();
    let finish: (() => void) | undefined;
    const updates: SensorBoardPresentation[] = [];
    const controller = new SensorBoardController(
      configuration,
      (value) => updates.push(value),
      async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return session;
      },
    );
    const opening = controller.open();
    let release: (() => void) | undefined;
    const failure = { code: 'operationFailed' };
    session.release.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (releaseFails) throw failure;
    });
    let closed = false;
    const closing = controller.dispose().then(
      () => {
        closed = true;
        return undefined;
      },
      (error: unknown) => {
        closed = true;
        return error;
      },
    );
    await settle();
    expect(closed).toBe(false);
    finish?.();
    await settle();
    expect(closed).toBe(false);
    release?.();
    await opening;
    expect(await closing).toEqual(releaseFails ? failure : undefined);
    if (releaseFails) await expect(controller.dispose()).rejects.toEqual(failure);
    expect(session.release).toHaveBeenCalledTimes(1);
    expect(session.sensorBoard).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  },
);

test('settings restore collection after native cancellation pauses an active refresh', async () => {
  const { controller, session, board, calls, updates } = setup();
  let paused = true;
  let finish: (() => void) | undefined;
  let units = board.units;
  session.sensorBoard.mockImplementation(async (request) => {
    calls.push(request);
    if (request.action === 'resume') paused = false;
    if (request.action === 'units') units = request.units;
    if (request.action === 'refresh')
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return { ...board, units, collection: { ...board.collection, paused } };
  });
  session.cancel.mockImplementation(async () => {
    paused = true;
    finish?.();
  });
  await controller.open();
  jest.advanceTimersByTime(1000);
  await settle();
  await controller.perform({ action: 'units', units: 'imperial' });
  expect(updates.at(-1)?.board?.collection.paused).toBe(false);
  expect(updates.at(-1)?.board?.units).toBe('imperial');
  expect(calls.at(-1)?.action).toBe('resume');
  await controller.dispose();
});

test('a settings action queued behind erase cannot restart collection', async () => {
  const { controller, session, board, calls, updates } = setup();
  let paused = false;
  let finish: (() => void) | undefined;
  session.sensorBoard.mockImplementation(async (request) => {
    calls.push(request);
    if (request.action === 'erase') {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      paused = true;
    }
    if (request.action === 'resume') paused = false;
    return { ...board, collection: { ...board.collection, paused } };
  });
  await controller.open();
  const erasing = controller.perform({ action: 'erase', consent: true });
  await settle();
  const changing = controller.perform({ action: 'units', units: 'metric' });
  finish?.();
  await Promise.all([erasing, changing]);
  expect(updates.at(-1)?.board?.collection.paused).toBe(true);
  expect(calls.filter((request) => request.action === 'resume')).toHaveLength(1);
  jest.advanceTimersByTime(10000);
  await settle();
  expect(calls.filter((request) => request.action === 'refresh')).toHaveLength(0);
  await controller.dispose();
});

test('background cancels an in-flight Air Check and rejects its late presentation', async () => {
  const { controller, session, board, calls, updates } = setup();
  await controller.open();
  let finish: (() => void) | undefined;
  session.sensorBoard.mockImplementation(async (request) => {
    calls.push(request);
    if (request.action === 'airCheck') {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        ...board,
        fusion: { ...board.fusion, airCheck: { state: 'noFix', ranAt: '2026-10-09T12:00:00Z' } },
      };
    }
    return { ...board, collection: { ...board.collection, paused: request.action === 'pause' } };
  });
  session.cancel.mockImplementation(async () => {
    finish?.();
  });
  const running = controller.perform({ action: 'airCheck', consent: true });
  await settle();
  await controller.setActive(false);
  await running;
  expect(session.cancel).toHaveBeenCalledTimes(1);
  expect(calls.at(-1)?.action).toBe('pause');
  expect(updates.some((value) => value.board?.fusion.airCheck.state === 'noFix')).toBe(false);
  expect(updates.at(-1)?.board?.collection.paused).toBe(true);
  await controller.dispose();
});

test('erase cancels Air Check before clearing the shared state', async () => {
  const { controller, session, board, calls, updates } = setup();
  await controller.open();
  let finish: (() => void) | undefined;
  session.sensorBoard.mockImplementation(async (request) => {
    calls.push(request);
    if (request.action === 'airCheck')
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return { ...board, collection: { ...board.collection, paused: request.action === 'erase' } };
  });
  session.cancel.mockImplementation(async () => {
    finish?.();
  });
  const running = controller.perform({ action: 'airCheck', consent: true });
  await settle();
  await controller.perform({ action: 'erase', consent: true });
  await running;
  expect(session.cancel).toHaveBeenCalledTimes(1);
  expect(calls.at(-1)?.action).toBe('erase');
  expect(updates.at(-1)?.board?.fusion.airCheck.state).toBe('idle');
  expect(updates.at(-1)?.failure).toBeNull();
  await controller.dispose();
});
