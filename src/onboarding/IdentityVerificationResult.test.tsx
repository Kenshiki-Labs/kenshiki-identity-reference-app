import type { EnvironmentCheckSnapshot } from '@kenshiki/identity-capture';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { invoke, property, required } from '../testing/support';
import { IdentityVerificationResult } from './IdentityVerificationResult';

jest.mock('@kenshiki/identity-capture', () => ({ IdentitySymbol: 'Symbol' }));

const result: EnvironmentCheckSnapshot = {
  state: 'completed',
  attemptID: 'environment-attempt',
  checkedAt: '2026-10-11T12:00:00Z',
  location: 'observed',
  air: 'consistent',
  reason: null,
  permissions: { location: 'given', motion: 'given' },
};
let view: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => view?.unmount());
  view = undefined;
});
test('whole review cards expose name, status and explanation and open only the selected report', async () => {
  const details = jest.fn();
  const exit = jest.fn();
  act(() => {
    view = create(<IdentityVerificationResult result={result} onDetails={details} onExit={exit} />);
  });
  expect(details).not.toHaveBeenCalled();
  for (const section of ['license', 'phone', 'ssn', 'environment']) {
    const card = required(view).root.findByProps({ testID: `onboarding-review-${section}` });
    expect(property(card, 'accessibilityRole')).toBe('button');
    expect(String(property(card, 'accessibilityLabel')).split('\n')).toHaveLength(2);
    await act(async () => {
      await invoke(card, 'onPress');
    });
    expect(details).toHaveBeenLastCalledWith(section);
  }
  expect(details).toHaveBeenCalledTimes(4);
  expect(exit).not.toHaveBeenCalled();
});
test('divergent Air Check is a needs-review conclusion, never a consistent success', () => {
  act(() => {
    view = create(
      <IdentityVerificationResult
        result={{ ...result, air: 'divergent' }}
        onDetails={jest.fn()}
        onExit={jest.fn()}
      />,
    );
  });
  const card = required(view).root.findByProps({ testID: 'onboarding-review-environment' });
  const label = String(property(card, 'accessibilityLabel'));
  expect(label).toContain('Needs review');
  expect(label).toContain('readings differed');
  expect(label).not.toContain('Consistent');
  expect(JSON.stringify(required(view).toJSON())).toContain('Your checks need review');
});
