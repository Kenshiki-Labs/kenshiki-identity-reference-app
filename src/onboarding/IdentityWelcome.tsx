import { useState } from 'react';
import { Linking } from 'react-native';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import clock from '../ui/assets/first-run/clock.png';
import document from '../ui/assets/first-run/id.png';
import phone from '../ui/assets/first-run/phone.png';
import welcome from '../ui/assets/first-run/welcome.png';
import { LinkRow, ListSection, TextRow } from '../ui/List';
import { OnboardingHero, OnboardingInstructions } from '../ui/OnboardingPresentation';
import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';
import { size } from '../ui/tokens.generated';

/** Informational entry only: no evidence, permissions, consent or capture session is acquired. */
export function IdentityWelcome({ onStart }: Readonly<{ onStart: () => void }>) {
  const [linkFailed, setLinkFailed] = useState(false);
  function openPolicy(url: string) {
    setLinkFailed(false);
    Linking.openURL(url).catch(() => setLinkFailed(true));
  }
  return (
    <Page title={t('onboarding.title')} testID="identity-welcome">
      <OnboardingHero
        source={welcome}
        width={size.welcomeArtWidth}
        height={size.welcomeArtHeight}
        panelHeight={size.welcomeHeroHeight}
      />
      <PageLead title={t('onboarding.title')} description={t('onboarding.description')} />
      <OnboardingInstructions
        items={[
          {
            key: 'document',
            source: document,
            width: size.welcomeIDWidth,
            height: size.welcomeIDHeight,
            label: t('onboarding.document'),
          },
          {
            key: 'phone',
            source: phone,
            width: size.welcomePhoneWidth,
            height: size.welcomePhoneHeight,
            label: t('onboarding.phone'),
          },
          {
            key: 'time',
            source: clock,
            width: size.welcomeClockSize,
            height: size.welcomeClockSize,
            label: t('onboarding.time'),
          },
        ]}
      />
      <ListSection>
        <LinkRow
          caption={t('onboarding.terms')}
          onPress={() => openPolicy('https://kenshikilabs.com/terms')}
        />
        <LinkRow
          caption={t('onboarding.privacy')}
          onPress={() => openPolicy('https://kenshikilabs.com/privacy')}
        />
      </ListSection>
      {linkFailed && <TextRow text={t('onboarding.linkFailed')} tone="warning" alert />}
      <Action label={t('onboarding.start')} testID="onboarding-start" onPress={onStart} />
    </Page>
  );
}
