import type { DocumentFieldReadout } from '@kenshiki/identity-capture';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { DocumentEvidenceField } from './DocumentEvidenceField';

test('incomplete OCR identifies the missing state without replacing the independent DOL match', async () => {
  const row: DocumentFieldReadout = {
    key: 'address',
    frontValue: '100 EXAMPLE ST\n12345-6789',
    licenseValue: '100 EXAMPLE ST\nWA\n123456789',
    submittedValue: '100 EXAMPLE ST\nWA\n123456789',
    front: 'partial',
    frontMissing: ['region'],
    comparison: 'matched',
  };
  let view: ReactTestRenderer | undefined;
  await act(async () => {
    view = create(<DocumentEvidenceField row={row} />);
  });
  try {
    const text = JSON.stringify(view?.toJSON());
    expect(text).toContain('Front ↔ PDF417 incomplete');
    expect(text).toContain('Not read on front: State');
    expect(text).toContain('DOL match (submitted)');
    expect(text).not.toContain('Front ↔ PDF417 mismatch');
  } finally {
    await act(async () => view?.unmount());
  }
});
