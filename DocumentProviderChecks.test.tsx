import type { DocumentCheckResult } from '@kenshiki/identity-capture';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { DocumentProviderChecks } from './DocumentProviderChecks';

let view: ReactTestRenderer;
afterEach(async () => {
  await act(async () => view?.unmount());
});
async function render(checks: DocumentCheckResult['providerChecks']) {
  await act(async () => {
    view = create(<DocumentProviderChecks checks={checks} />);
  });
  return JSON.stringify(view.toJSON());
}
test('shows every returned check, distinguishing partial and missing field comparisons from passed status', async () => {
  const text = await render([
    {
      name: 'aamva_name_comparison',
      status: 'passed',
      reasons: [],
      metadataJSON: '{"name-first-match":"full","name-last-match":"none"}',
    },
    {
      name: 'aamva_birthdate_comparison',
      status: 'passed',
      reasons: [],
      metadataJSON: '{"match-result":"full"}',
    },
    {
      name: 'aamva_identification_number_comparison',
      status: 'failed',
      reasons: ['Record differs'],
      metadataJSON: null,
    },
    {
      name: 'aamva_address_comparison',
      status: 'passed',
      reasons: [],
      metadataJSON: '{"match-result":"partial"}',
    },
    { name: 'aamva_issue_date_comparison', status: 'not_applicable', reasons: [], metadataJSON: null },
    {
      name: 'aamva_expiration_date_comparison',
      status: 'pending',
      reasons: [],
      metadataJSON: '{"match-result":"missing"}',
    },
    {
      name: 'future_check',
      status: 'future_status',
      reasons: ['Explain future result'],
      metadataJSON: '{"future-key":false}',
    },
  ]);
  for (const value of [
    'Date of birth',
    'Document number',
    'Record differs',
    'Partial match',
    'No match',
    'No DOL result returned',
    'Pending',
    'No DOL comparison returned',
    'future_check',
    'future_status',
    'Explain future result',
    'future-key',
    'false',
  ])
    expect(text).toContain(value);
  for (let index = 0; index < 7; index++)
    expect(view.root.findByProps({ testID: `document-provider-check-${index}` })).toBeDefined();
  expect(
    view.root
      .findByProps({ testID: 'document-provider-check-3' })
      .findAllByType(Text)
      .map((node): unknown => node.props.children),
  ).not.toContain('Full match');
});
test.each([null, '', 'not json', '[1,2]', 'null'])(
  'preserves opaque metadata %p without fabricating matches or crashing',
  async (metadataJSON) => {
    const text = await render([
      { name: 'aamva_name_comparison', status: 'passed', reasons: [], metadataJSON },
    ]);
    expect(text).toContain('Passed');
    expect(text).not.toContain('Full match');
    if (metadataJSON) expect(text).toContain(metadataJSON);
  },
);
test('absent checks remain absent rather than being treated as confirmation', async () => {
  const text = await render([]);
  expect(text).toContain('Individual checks were not returned.');
  expect(text).not.toContain('Passed');
});
