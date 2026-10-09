import { NavigationContext } from '@react-navigation/native';
import { type ReactNode, useContext } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../locales/i18n';
import { Action } from './Action';
import { color, size, spacing, text } from './tokens.generated';
import { Wordmark } from './Wordmark';

type PageProps = {
  title?: string | undefined;
  children?: ReactNode;
  /** Short content leaves actions at the bottom; long content and actions scroll together. */
  actions?: ReactNode;
  /** Camera content fills the remaining viewport. Sheets use the same chrome and scroll layout. */
  mode?: 'scroll' | 'camera' | 'sheet';
  /** A flow supplies its own release/handoff action; ordinary detail pages use native Back. */
  onClose?: (() => unknown) | undefined;
  testID?: string | undefined;
  /** Recovery overlays hide the whole underlying page, including navigation, from VoiceOver. */
  covered?: boolean;
  overlay?: ReactNode;
};

/** The only page container. Navigation stacks supply transitions; this component owns every
 * screen's brand, navigation controls, heading, surface, insets and scrolling. Feature views
 * supply content and session-aware close actions, never another page shell. */
export function Page({
  title,
  children,
  actions,
  mode = 'scroll',
  onClose,
  testID,
  covered = false,
  overlay,
}: PageProps) {
  const navigation = useContext(NavigationContext);
  const stack = navigation?.getState();
  const back =
    mode !== 'sheet' && stack?.type === 'stack' && stack.index > 0 ? () => navigation?.goBack() : undefined;
  const close = onClose ?? back;
  const hasActions = actions !== undefined && actions !== null;
  const closeLabel = onClose ? t(mode === 'sheet' ? 'common.done' : 'common.cancel') : t('common.back');
  const heading = title ? (
    <Text testID="page-title" accessibilityRole="header" style={pageStyles.title}>
      {title}
    </Text>
  ) : null;
  return (
    <>
      <SafeAreaView
        edges={['top', 'left', 'right']}
        style={pageStyles.root}
        testID={testID}
        accessibilityViewIsModal={mode === 'sheet'}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      >
        <View style={pageStyles.bar}>
          <View style={pageStyles.navigation}>
            {close && (
              <Action
                label={closeLabel}
                onPress={close}
                secondary
                testID={onClose ? 'modal-cancel' : 'page-back'}
              />
            )}
          </View>
          <View style={pageStyles.brand}>
            <Wordmark />
          </View>
          <View style={pageStyles.navigation} />
        </View>
        {mode === 'camera' ? (
          <>
            <View style={pageStyles.cameraHeading}>{heading}</View>
            <SafeAreaView edges={['bottom']} style={pageStyles.camera}>
              {children}
            </SafeAreaView>
          </>
        ) : (
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[pageStyles.content, hasActions && pageStyles.flowContent]}
          >
            {hasActions ? (
              <>
                <View style={pageStyles.flowBody}>
                  {heading}
                  {children}
                </View>
                <View style={pageStyles.flowActions}>{actions}</View>
              </>
            ) : (
              <>
                {heading}
                {children}
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
      {overlay}
    </>
  );
}

const pageStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  bar: {
    minHeight: size.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  navigation: { width: size.navigationActionWidth },
  brand: { flex: 1, alignItems: 'center' },
  title: { ...text.screenTitle, color: color.text },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxxl,
    gap: spacing.lg,
  },
  flowContent: { flexGrow: 1 },
  flowBody: { gap: spacing.lg },
  flowActions: { marginTop: 'auto', paddingTop: spacing.lg, gap: spacing.sm },
  cameraHeading: { paddingHorizontal: spacing.md, paddingVertical: spacing.lg },
  camera: { flex: 1, backgroundColor: color.cameraBackground },
});
