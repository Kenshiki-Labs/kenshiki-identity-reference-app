import type { CaptureSession, Configuration } from '@kenshiki/identity-capture';
import { IdentityCapturePreview } from '@kenshiki/identity-capture';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { invoke, mockSession, property, required, settle } from '../testing/support';
import { IntegrationChecks } from './IntegrationChecks';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import { ControllerCustodyContext, type IdentityCustody } from '../ui/ControllerCustody';
import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';

const mockCreate = jest.fn<Promise<CaptureSession>, [Configuration?]>();
jest.mock('@kenshiki/identity-capture', () => ({
  IdentityCaptureSession: { create: (configuration?: Configuration) => mockCreate(configuration) },
  IdentityCapturePreview: 'MockPreview',
  IdentitySymbol: 'MockSymbol',
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
  ).isCaptureErrorCode,
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const configuration: Configuration = {};
let view: ReactTestRenderer;
let custody: IdentityCustody;
let preview: ReturnType<typeof mockSession>;
beforeEach(() => {
  mockCreate.mockReset();
  custody = { releasing: Promise.resolve(), reportFailure: jest.fn() };
  preview = mockSession({ id: 'preview', release: jest.fn(async () => {}), cancel: jest.fn(async () => {}) });
  mockCreate.mockResolvedValueOnce(preview);
  mockCreate.mockRejectedValue(new Error('Unexpected new native owner'));
});
afterEach(async () => {
  await act(async () => view?.unmount());
});
async function mount(key = 'first') {
  await act(async () => {
    view = create(
      <ControllerCustodyContext.Provider value={custody}>
        <IntegrationChecks key={key} configuration={configuration} />
      </ControllerCustodyContext.Provider>,
    );
  });
}
function runAction() {
  return required(
    view.root.findAllByType(Action).find((node) => property(node, 'testID') === 'run-sdk-checks'),
  );
}
function page() {
  return required(view.root.findAllByType(Page).find((node) => property(node, 'mode') !== 'sheet'));
}
const words = () => JSON.stringify(view.toJSON());

test('Opening creates only a stopped preview and Run cannot overlap before React rerenders', async () => {
  await mount();
  expect(view.root.findAllByType(PageLead)).toHaveLength(1);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(preview.startMRZ).not.toHaveBeenCalled();
  expect(preview.startSelfie).not.toHaveBeenCalled();
  expect(view.root.findAllByType(IdentityCapturePreview)).toHaveLength(1);
  expect(property(runAction(), 'grouped')).toBe(true);
  expect(words()).toContain(t('developer.section.status'));
  expect(words()).toContain(t('developer.section.preview'));
  expect(words()).not.toContain(t('developer.section.results'));
  const invalid = deferred<CaptureSession>();
  mockCreate.mockImplementationOnce(() => invalid.promise);
  const action = runAction();
  let running: unknown;
  await act(async () => {
    running = invoke(action, 'onPress');
    invoke(action, 'onPress');
    await settle();
  });
  expect(mockCreate).toHaveBeenCalledTimes(2);
  expect(property(runAction(), 'disabled')).toBe(true);
  expect(words()).toContain(t('developer.status.running'));
  await act(async () => {
    invalid.reject({ code: 'invalidConfiguration' });
    await running;
  });
  expect(mockCreate).toHaveBeenCalledTimes(3);
  expect(words()).toContain(t('developer.section.results'));
  expect(words()).toContain('invalidConfiguration');
});

test('Back waits for preview release and rejects a duplicate close while cleanup is pending', async () => {
  await mount();
  const released = deferred<void>();
  preview.release.mockImplementationOnce(() => released.promise);
  let closing: Promise<unknown> | undefined;
  let settled = false;
  await act(async () => {
    closing = Promise.resolve(invoke(page(), 'onClose')).then((value) => {
      settled = true;
      return value;
    });
    await settle();
  });
  expect(preview.release).toHaveBeenCalledTimes(1);
  expect(settled).toBe(false);
  expect(property(runAction(), 'disabled')).toBe(true);
  await act(async () => {
    expect(await invoke(page(), 'onClose')).toBe(false);
  });
  expect(preview.release).toHaveBeenCalledTimes(1);
  await act(async () => {
    released.resolve();
    expect(await closing).toBe(true);
  });
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

test('Release failure covers the screen, rejects Back and blocks a replacement owner', async () => {
  await mount();
  const failure = new Error('PRIVATE_NATIVE_RELEASE_PAYLOAD');
  preview.release.mockRejectedValueOnce(failure);
  await act(async () => {
    expect(await invoke(page(), 'onClose')).toBe(false);
  });
  expect(view.root.findAllByProps({ testID: 'developer-release-failure' }).length).toBeGreaterThan(0);
  expect(property(page(), 'covered')).toBe(true);
  expect(words()).not.toContain('PRIVATE_NATIVE_RELEASE_PAYLOAD');
  expect(property(runAction(), 'disabled')).toBe(true);
  await act(async () => {
    expect(await invoke(page(), 'onClose')).toBe(false);
  });
  expect(preview.release).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.update(
      <ControllerCustodyContext.Provider value={custody}>
        <IntegrationChecks key="replacement" configuration={configuration} />
      </ControllerCustodyContext.Provider>,
    );
  });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  await expect(custody.releasing).rejects.toBe(failure);
});

test('Back during Run drains a late acquired owner without starting further probes', async () => {
  await mount();
  const acquired = deferred<CaptureSession>();
  const released = deferred<void>();
  const late = mockSession({ id: 'late-primary', release: jest.fn(() => released.promise) });
  mockCreate
    .mockRejectedValueOnce({ code: 'invalidConfiguration' })
    .mockImplementationOnce(() => acquired.promise);
  let running: unknown;
  await act(async () => {
    running = invoke(runAction(), 'onPress');
    await settle();
  });
  expect(mockCreate).toHaveBeenCalledTimes(3);
  let closing: Promise<unknown> | undefined;
  let closed = false;
  await act(async () => {
    closing = Promise.resolve(invoke(page(), 'onClose')).then((value) => {
      closed = true;
      return value;
    });
    await settle();
  });
  expect(closed).toBe(false);
  await act(async () => {
    acquired.resolve(late);
    await settle();
  });
  expect(late.release).toHaveBeenCalledTimes(1);
  expect(closed).toBe(false);
  expect(mockCreate).toHaveBeenCalledTimes(3);
  expect(late.listResults).not.toHaveBeenCalled();
  expect(late.eraseResults).not.toHaveBeenCalled();
  await act(async () => {
    released.resolve();
    await running;
    expect(await closing).toBe(true);
  });
  expect(late.release).toHaveBeenCalledTimes(1);
});
