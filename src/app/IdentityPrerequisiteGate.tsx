import type { ReactNode } from 'react';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';

/** A direct route must not mount a service flow whose prerequisites are missing. */
export function IdentityPrerequisiteGate({
  reason,
  onExit,
  children,
}: Readonly<{
  reason: 'document' | 'phone' | 'service' | undefined;
  onExit: () => void;
  children: ReactNode;
}>) {
  if (!reason) return children;
  return (
    <Page
      title={t('prerequisite.title')}
      lead={<PageLead title={t('prerequisite.title')} description={t(`prerequisite.${reason}`)} />}
    >
      <Action label={t('prerequisite.back')} onPress={onExit} />
    </Page>
  );
}
