import { StyleSheet, Text, View } from 'react-native';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import book from '../ui/assets/first-run/book.png';
import id from '../ui/assets/first-run/id.png';
import layers from '../ui/assets/first-run/layers.png';
import nfc from '../ui/assets/first-run/nfc.png';
import license from '../ui/assets/first-run/prep-license.png';
import passport from '../ui/assets/first-run/prep-passport.png';
import sun from '../ui/assets/first-run/sun.png';
import { RowNote } from '../ui/List';
import { OnboardingHero, OnboardingInstructions } from '../ui/OnboardingPresentation';
import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';
import { color, size, spacing, text } from '../ui/tokens.generated';

/** Preparation describes the next capture without acquiring consent, permissions or evidence. */
export function IdentityPreparation({
  document,
  onCapture,
  captureDisabled = false,
}: Readonly<{
  document: 'passport' | 'license';
  onCapture?: () => void;
  captureDisabled?: boolean;
}>) {
  const isPassport = document === 'passport';
  const light = {
    key: 'light',
    source: sun,
    width: size.preparationSunSize,
    height: size.preparationSunSize,
    label: t('onboarding.preparation.light'),
  };
  const instructions = isPassport
    ? [
        {
          key: 'photoPage',
          source: book,
          width: size.preparationBookWidth,
          height: size.preparationBookHeight,
          label: t('onboarding.preparation.photoPage'),
        },
        light,
        {
          key: 'phoneCase',
          source: nfc,
          width: size.preparationNFCWidth,
          height: size.preparationNFCHeight,
          label: t('onboarding.preparation.phoneCase'),
        },
      ]
    : [
        light,
        {
          key: 'flat',
          source: layers,
          width: size.preparationLayersWidth,
          height: size.preparationLayersHeight,
          label: t('onboarding.preparation.flat'),
        },
        {
          key: 'corners',
          source: id,
          width: size.welcomeIDWidth,
          height: size.welcomeIDHeight,
          label: t('onboarding.preparation.corners'),
        },
      ];
  return (
    <Page title={t(`onboarding.preparation.${document}.title`)} testID="identity-preparation">
      <OnboardingHero
        source={isPassport ? passport : license}
        width={isPassport ? size.preparationPassportWidth : size.preparationLicenseWidth}
        height={isPassport ? size.preparationPassportHeight : size.preparationLicenseHeight}
        panelHeight={size.preparationHeroHeight}
      />
      <View style={styles.lead}>
        <Text style={styles.step}>{t(`onboarding.preparation.${document}.step`)}</Text>
        <PageLead
          title={t(`onboarding.preparation.${document}.title`)}
          description={t(`onboarding.preparation.${document}.description`)}
        />
      </View>
      <OnboardingInstructions items={instructions} />
      <RowNote text={t('onboarding.preparation.camera')} />
      {/* Only an explicit action transfers ownership to the existing capture flow. */}
      <Action
        label={t(`onboarding.preparation.${document}.action`)}
        testID="onboarding-capture"
        disabled={!onCapture || captureDisabled}
        onPress={() => onCapture?.()}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  lead: { gap: spacing.xxs },
  step: { ...text.eyebrow, color: color.tint },
});
