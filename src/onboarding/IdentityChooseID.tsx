import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import book from '../ui/assets/first-run/choice-book.png';
import id from '../ui/assets/first-run/choice-id.png';
import checked from '../ui/assets/first-run/choice-selected.png';
import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';
import { border, color, radius, size, spacing, text } from '../ui/tokens.generated';

export type OnboardingDocument = 'passport' | 'license';

/** The only state is a document-kind choice, retained by the existing native stack. */
export function IdentityChooseID({
  onContinue,
}: Readonly<{ onContinue: (document: OnboardingDocument) => void }>) {
  const [selected, setSelected] = useState<OnboardingDocument>('passport');
  return (
    <Page
      title={t('onboarding.choose.title')}
      testID="identity-choose-id"
      lead={
        <PageLead title={t('onboarding.choose.title')} description={t('onboarding.choose.description')} />
      }
    >
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('onboarding.choose.title')}
        style={choiceStyles.options}
      >
        {(['passport', 'license'] as const).map((document) => (
          <Pressable
            key={document}
            testID={`choose-${document}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected === document }}
            accessibilityLabel={t('common.labelAndStatus', {
              label: t(`onboarding.choose.${document}`),
              status: t(`onboarding.choose.${document}Detail`),
            })}
            onPress={() => setSelected(document)}
            style={[choiceStyles.option, selected === document && choiceStyles.selected]}
          >
            <View style={choiceStyles.well} accessible={false}>
              <Image
                source={document === 'passport' ? book : id}
                accessible={false}
                style={document === 'passport' ? choiceStyles.book : choiceStyles.id}
              />
            </View>
            <View style={choiceStyles.words}>
              <View style={choiceStyles.heading}>
                <Text style={choiceStyles.title}>{t(`onboarding.choose.${document}`)}</Text>
                {document === 'passport' && (
                  <Text style={choiceStyles.badge}>{t('onboarding.choose.recommended')}</Text>
                )}
              </View>
              <Text style={choiceStyles.detail}>{t(`onboarding.choose.${document}Detail`)}</Text>
            </View>
            {selected === document ? (
              <Image source={checked} style={choiceStyles.radio} accessible={false} />
            ) : (
              <View style={[choiceStyles.radio, choiceStyles.unchecked]} accessible={false} />
            )}
          </Pressable>
        ))}
      </View>
      <Action
        label={t('onboarding.choose.continue')}
        testID="onboarding-continue"
        onPress={() => onContinue(selected)}
      />
    </Page>
  );
}

const choiceStyles = StyleSheet.create({
  options: { gap: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.group,
    borderWidth: border.hairline,
    borderColor: color.separator,
    backgroundColor: color.background,
  },
  selected: {
    borderWidth: border.choiceSelected,
    borderColor: color.tint,
    backgroundColor: color.choiceSelected,
  },
  well: {
    width: size.touchTarget,
    height: size.touchTarget,
    borderRadius: radius.well,
    backgroundColor: color.tintSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  book: { width: size.choiceBookWidth, height: size.choiceBookHeight },
  id: { width: size.choiceIDWidth, height: size.choiceIDHeight },
  words: { flex: 1, gap: spacing.xxs },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  title: { ...text.groupTitle, color: color.text, flexShrink: 1 },
  detail: { ...text.rowStatus, color: color.secondaryText },
  badge: {
    ...text.tag,
    color: color.evidenceMatch,
    backgroundColor: color.evidenceMatchSoft,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.well,
  },
  radio: { width: size.choiceRadio, height: size.choiceRadio },
  unchecked: { borderRadius: radius.full, borderWidth: border.choiceSelected, borderColor: color.tintMid },
});
