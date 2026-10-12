import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { documentSessionMethods } from '../testing/documentFixture';
import { completedPhone } from '../testing/phoneFixture';
import { ssnCompletedSnapshot } from '../testing/ssnFixture';
import { invoke, mockSession, property, required, settle } from '../testing/support';
import { formatMoment } from '../app/HolderText';
import {
  IdentityVerificationDetail,
  type VerificationReview,
  type VerificationSection,
} from './IdentityVerificationDetail';
import { Action } from '../ui/Action';
import { ButtonRow, ValueRow } from '../ui/List';
import { Page } from '../ui/Page';

jest.mock('@kenshiki/identity-capture', () => ({ IdentitySymbol: 'IdentitySymbol' }));
let view: ReactTestRenderer;
afterEach(async () => {
  await act(async () => view?.unmount());
});
async function fixture(section: VerificationSection) {
  const session = mockSession({
    documentDetails: jest.fn(async () => {}),
    phoneDetails: jest.fn(async () => {}),
    ssnDetails: jest.fn(async () => ssnCompletedSnapshot),
  });
  const methods = documentSessionMethods();
  const document = await methods.documentResult();
  const checked = await methods.documentCheckRestore();
  const review: VerificationReview = {
    document: { session, document },
    checked,
    face: {
      captureID: checked.captureID,
      sourceSHA256: checked.sourceSHA256,
      documentOperationID: required(checked.result).operationID,
      state: 'completed',
      result: { outcome: 'pass', completedAt: '2026-10-10T12:05:00Z' },
    },
    phone: { session, snapshot: completedPhone },
    ssn: { session, snapshot: ssnCompletedSnapshot },
    environment: {
      state: 'completed',
      attemptID: 'environment-one',
      checkedAt: '2026-10-10T12:15:00Z',
      location: 'observed',
      air: 'divergent',
      reason: null,
      permissions: { location: 'given', motion: 'given' },
    },
  };
  await act(async () => {
    view = create(<IdentityVerificationDetail section={section} review={review} />);
  });
  return { session, review };
}
const actions = [
  ['license', 'verification-license-native-details', 'documentDetails'],
  ['phone', 'phone-native-details', 'phoneDetails'],
  ['ssn', 'ssn-native-details', 'ssnDetails'],
] as const;
function nativeAction(id: string) {
  return required(view.root.findAllByType(Action).find((node) => property(node, 'testID') === id));
}

test.each(['license', 'phone', 'ssn', 'environment'] as const)(
  '%s review mounts without native work and leaves ownership with workspace',
  async (section) => {
    const { session } = await fixture(section);
    expect(property(view.root.findByType(Page), 'header')).toBe('native');
    for (const value of Object.values(session))
      if (jest.isMockFunction(value)) expect(value).not.toHaveBeenCalled();
    if (section === 'environment') expect(view.root.findAllByType(Action)).toHaveLength(0);
    await act(async () => view.unmount());
    expect(session.release).not.toHaveBeenCalled();
    expect(session.cancel).not.toHaveBeenCalled();
  },
);

test.each(actions)(
  '%s details use only the native inspector and suppress duplicate opening',
  async (section, id, method) => {
    const { session } = await fixture(section);
    let resolve!: () => void;
    const gate = new Promise<void>((done) => {
      resolve = done;
    });
    if (method === 'ssnDetails')
      session.ssnDetails.mockImplementationOnce(async () => {
        await gate;
        return ssnCompletedSnapshot;
      });
    else session[method].mockImplementationOnce(() => gate);
    let pending: unknown;
    await act(async () => {
      pending = invoke(nativeAction(id), 'onPress');
      invoke(nativeAction(id), 'onPress');
      await settle();
    });
    expect(session[method]).toHaveBeenCalledTimes(1);
    expect(property(nativeAction(id), 'disabled')).toBe(true);
    await act(async () => {
      resolve();
      await pending;
    });
    expect(property(nativeAction(id), 'disabled')).toBe(false);
    for (const [key, value] of Object.entries(session))
      if (key !== method && jest.isMockFunction(value)) expect(value).not.toHaveBeenCalled();
  },
);

test.each(actions)(
  '%s inspector errors show shared redacted recovery and permit retry',
  async (section, id, method) => {
    const { session } = await fixture(section);
    session[method].mockRejectedValueOnce(new Error('PRIVATE PROVIDER BODY 123456789'));
    const button = () =>
      required(view.root.findAllByType(ButtonRow).find((node) => property(node, 'testID') === id));
    await act(async () => {
      invoke(button(), 'onPress');
      await settle();
    });
    expect(JSON.stringify(view.toJSON())).toContain('This action could not finish. Try again.');
    expect(JSON.stringify(view.toJSON())).not.toContain('PRIVATE');
    expect(JSON.stringify(view.toJSON())).not.toContain('123456789');
    await act(async () => {
      invoke(button(), 'onPress');
      await settle();
    });
    expect(session[method]).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(view.toJSON())).not.toContain('This action could not finish. Try again.');
  },
);

test('license and environment display recorded timing and truthful outcomes without private identifiers', async () => {
  const { review } = await fixture('license');
  const license = JSON.stringify(view.toJSON());
  expect(license).toContain('Photos match');
  expect(license).not.toContain(review.face.sourceSHA256);
  expect(license).not.toContain(review.face.documentOperationID);
  expect(view.root.findAllByType(ValueRow)).toHaveLength(4);
  expect(license).toContain(formatMoment(required(review.checked.checkedAt)));
  if (review.face.state === 'completed')
    expect(license).toContain(formatMoment(review.face.result.completedAt));
  await act(async () => {
    view.update(<IdentityVerificationDetail section="environment" review={review} />);
  });
  const environment = JSON.stringify(view.toJSON());
  expect(environment).toContain('Location observation received');
  expect(environment).toContain('Air Check needs review');
  expect(environment).not.toContain('environment-one');
  expect(environment).toContain(formatMoment(required(review.environment.checkedAt)));
  expect(view.root.findAllByType(Action)).toHaveLength(0);
});
