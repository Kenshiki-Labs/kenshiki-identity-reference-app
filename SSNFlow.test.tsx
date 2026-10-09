import React from 'react';
import renderer, {act} from 'react-test-renderer';
import type {Configuration, SSNSessionSnapshot, SSNVerificationReceipt} from '@kenshiki/identity-capture';
import App from './App';
import {SSNResultDetails} from './SSNFlow';

const mockReceipt: SSNVerificationReceipt = {operationID: 'operation', checkedAt: '2026-10-07T20:00:00Z', issuance: 'issued'};
const mockReady: SSNSessionSnapshot = {state: 'ready', entryDigits: '', confirmation: null, attempt: null,
  receipt: null, failure: null, recoveryNeeded: false, busy: false};
let mockSnapshot = mockReady;
const mockSession = {
  id: 'ssn', ssnSnapshot: jest.fn(async () => mockSnapshot),
  ssnRequestConfirmation: jest.fn(async (digits: string) => {
    mockSnapshot = {...mockSnapshot, state: 'confirming', entryDigits: digits,
      confirmation: {id: 'token', digits, purpose: 'initialCheck'}}; return mockSnapshot;
  }),
  ssnRequestFreshConfirmation: jest.fn(async (digits: string) => {
    mockSnapshot = {...mockSnapshot, state: 'confirming', entryDigits: digits,
      confirmation: {id: 'fresh-token', digits, purpose: 'replacementAfterUnknownOutcome'}}; return mockSnapshot;
  }),
  ssnConfirm: jest.fn(async (_id: string) => {
    mockSnapshot = {...mockReady, state: 'completed', attempt: {operationID: 'operation', createdAt: '2026-10-07T20:00:00Z'}, receipt: mockReceipt}; return mockSnapshot;
  }),
  ssnRecover: jest.fn(async () => mockSnapshot),
  ssnCancel: jest.fn(async () => { mockSnapshot = {...mockSnapshot, state: 'ready', entryDigits: '', confirmation: null}; return mockSnapshot; }),
  release: jest.fn(async () => {}),
};
jest.mock('@kenshiki/identity-capture', () => ({
  IdentityCaptureSession: {create: jest.fn(async () => mockSession)},
  IdentityCapturePreview: 'MockCapturePreview', IdentityCaptureImage: 'MockCaptureImage',
}));
beforeEach(() => { jest.clearAllMocks(); mockSnapshot = mockReady; });
const configuration = {ssn: {}} as Configuration;
async function renderApp(config = configuration) {
  let view!: renderer.ReactTestRenderer;
  await act(async () => { view = renderer.create(<App configuration={config} />); });
  async function tap(id: string) {
    await act(async () => {
      const button = view.root.findAllByProps({testID: id}).filter(node => typeof node.props.onPress === 'function').at(-1)!;
      await button.props.onPress();
    });
  }
  async function enter() {
    await act(async () => { view.root.findByProps({testID: 'ssn-entry'}).props.onChangeText('000001234'); });
  }
  return {view, tap, enter};
}
test('SSN review displays exact digits in a bottom sheet and a completed result reopens from Identity', async () => {
  const {view, tap, enter} = await renderApp(); await tap('open-ssn');
  expect(view.root.findAllByProps({testID: 'ssn-entry'})).toHaveLength(0);
  await tap('ssn-begin-entry'); await enter();
  expect(view.root.findByProps({testID: 'ssn-entry'}).props.value).toBe('000001234');
  await tap('ssn-review-number');
  expect(view.root.findByProps({testID: 'ssn-bottom-sheet'})).toBeDefined();
  expect(view.root.findByProps({testID: 'ssn-confirmation-number'}).props.children).toBe('000-00-1234');
  expect(mockSession.ssnConfirm).not.toHaveBeenCalled();
  await tap('ssn-confirm'); expect(mockSession.ssnConfirm).toHaveBeenCalledWith('token');
  expect(JSON.stringify(view.toJSON())).toContain('Reported as issued');
  expect(JSON.stringify(view.toJSON())).not.toContain('000-00-1234');
  await tap('finish-ssn'); await tap('open-ssn');
  expect(view.root.findByProps({testID: 'ssn-result'})).toBeDefined();
  expect(mockSession.ssnConfirm).toHaveBeenCalledTimes(1); expect(mockSession.release).not.toHaveBeenCalled();
  await act(async () => { view.unmount(); }); expect(mockSession.release).toHaveBeenCalledTimes(1);
});
test('leaving the exact-number sheet clears the input before the Identity card can reopen it', async () => {
  const {view, tap, enter} = await renderApp(); await tap('open-ssn'); await tap('ssn-begin-entry'); await enter(); await tap('ssn-review-number');
  await tap('ssn-back-to-identity'); expect(JSON.stringify(view.toJSON())).not.toContain('000-00-1234');
  await tap('open-ssn'); await tap('ssn-begin-entry'); expect(view.root.findByProps({testID: 'ssn-entry'}).props.value).toBe('');
  expect(mockSession.ssnConfirm).not.toHaveBeenCalled();
  await act(async () => { view.unmount(); });
});
test('missing provider presents a bottom sheet without an ID or phone CTA', async () => {
  const {view, tap} = await renderApp({}); await tap('open-ssn');
  expect(view.root.findByProps({testID: 'ssn-bottom-sheet'})).toBeDefined();
  expect(JSON.stringify(view.toJSON())).toContain('This check is not ready');
  expect(JSON.stringify(view.toJSON())).not.toMatch(/capture or choose ID|connected document|phone check/i);
  expect(view.root.findAllByProps({testID: 'ssn-retry'})).toHaveLength(0);
  await tap('ssn-back-to-identity'); expect(view.root.findByProps({testID: 'open-ssn'})).toBeDefined();
  expect(mockSession.ssnConfirm).not.toHaveBeenCalled(); await act(async () => { view.unmount(); });
});
test('issuance unavailable is not promoted to identity verification', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => { view = renderer.create(<SSNResultDetails receipt={{...mockReceipt, issuance: 'unavailable'}} />); });
  const shown = JSON.stringify(view.toJSON());
  expect(shown).toContain('Issuance not available');
  expect(shown).not.toContain('Reported as issued'); expect(shown).not.toContain('Verified');
  expect(shown).toContain('does not establish that the number belongs to you');
  await act(async () => { view.unmount(); });
});
test('an uncertain prior dispatch gets a fresh-number warning before another confirmation', async () => {
  mockSnapshot = {...mockReady, state: 'outcomeUnknown', recoveryNeeded: true,
    attempt: {operationID: 'old-operation', createdAt: '2026-10-07T20:00:00Z'}};
  const {view, tap, enter} = await renderApp(); await tap('open-ssn');
  await tap('ssn-new-attempt'); await enter(); await tap('ssn-review-number');
  expect(view.root.findByProps({testID: 'ssn-replacement-warning'})).toBeDefined();
  expect(mockSession.ssnRequestFreshConfirmation).toHaveBeenCalledWith('000001234');
  expect(mockSession.ssnConfirm).not.toHaveBeenCalled();
  await tap('ssn-confirm'); expect(mockSession.ssnConfirm).toHaveBeenCalledWith('fresh-token');
  await act(async () => { view.unmount(); });
});

test('returned findings show source values, while older receipts explain why details are absent', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => { view = renderer.create(<SSNResultDetails receipt={{...mockReceipt, details: {
    source: 'Synthetic provider', responseCode: 0, reportedStatus: 'Item1', region: 'CA',
    issueStart: '1978-01-01', issueEnd: '1979-12-31', code: '2',
    codeDescription: 'Issued in the reported period',
  }}} />); });
  let shown = JSON.stringify(view.toJSON());
  for (const value of ['CA', 'Jan 1, 1978', 'Dec 31, 1979', 'Issued in the reported period', 'Item1']) {
    expect(shown).toContain(value);
  }
  expect(shown).not.toContain('Synthetic provider');
  await act(async () => { view.update(<SSNResultDetails receipt={{...mockReceipt, details: {
    source: 'Synthetic provider', responseCode: 0, reportedStatus: 'Item1',
  }}} />); });
  shown = JSON.stringify(view.toJSON());
  expect(shown).toContain('Not returned'); expect(shown).not.toContain('Jan 1, 1978');
  await act(async () => { view.update(<SSNResultDetails receipt={mockReceipt} />); });
  shown = JSON.stringify(view.toJSON());
  expect(shown).toContain('Its details were not retained');
  expect(mockSession.ssnConfirm).not.toHaveBeenCalled();
  await act(async () => { view.unmount(); });
});
