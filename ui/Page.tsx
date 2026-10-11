import { NavigationContext, NavigationRouteContext } from '@react-navigation/native';
import { createContext, type ReactNode, useContext } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../locales/i18n';
import { Action } from './Action';
import { NativeFlowBack } from './NativeFlowBack';
import { color, size, spacing, text } from './tokens.generated';
import { Wordmark } from './Wordmark';

/** A navigator declares header ownership once for its screens. Modal sheets own their chrome. */
export const PageHeaderContext = createContext<'custom' | 'native'>('custom');

type PageProps = {
  /** Native-stack routes own their header. Legacy routes keep the shared custom header. */
  header?: 'custom' | 'native';
  title?: string | undefined;
  children?: ReactNode;
  /** Camera content fills the remaining viewport. Sheets use the same chrome and scroll layout. */
  mode?: 'scroll' | 'camera' | 'sheet';
  /** A flow supplies its own release/handoff action; ordinary detail pages use native Back. */
  onClose?: (() => unknown) | undefined;
  testID?: string | undefined;
  /** Recovery overlays hide the whole underlying page, including navigation, from VoiceOver. */
  covered?: boolean;
  overlay?: ReactNode;
};

/** Shared screen layout. Native-header routes leave the title and navigation controls to their
 * stack; other routes retain the common branded header. Features supply content and actions.
 * AppContainer (or NativeSheet at a modal boundary) owns safe-area context; Page consumes it. */
export function Page({
  title,
  children,
  mode = 'scroll',
  header,
  onClose,
  testID,
  covered = false,
  overlay,
}: Readonly<PageProps>) {
  const navigation = useContext(NavigationContext);
  const route = useContext(NavigationRouteContext);
  const stack = navigation?.getState();
  const back = pageBack(navigation, stack, route?.key, mode);
  const close = onClose ?? back;
  const closeLabel = t(
    mode === 'sheet' ? 'common.done' : mode === 'camera' ? 'common.cancel' : 'common.back',
  );
  const inheritedHeader = useContext(PageHeaderContext);
  const nativeHeader = (header ?? inheritedHeader) === 'native';
  const heading =
    title && !nativeHeader ? (
      <Text testID="page-title" accessibilityRole="header" style={pageStyles.title}>
        {title}
      </Text>
    ) : null;
  return (
    <>
      {nativeHeader && navigation && onClose && <NativeFlowBack close={onClose} />}
      <SafeAreaView
        edges={nativeHeader ? ['left', 'right', 'bottom'] : ['top', 'left', 'right']}
        style={pageStyles.root}
        testID={testID}
        accessibilityViewIsModal={mode === 'sheet'}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      >
        {!nativeHeader && (
          <View style={pageStyles.bar}>
            <View style={pageStyles.navigation}>
              {close && (
                <Action
                  label={closeLabel}
                  back={mode === 'scroll'}
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
        )}
        {mode === 'camera' ? (
          <>
            <View style={pageStyles.cameraHeading}>{heading}</View>
            <SafeAreaView edges={['bottom']} style={pageStyles.camera}>
              {children}
            </SafeAreaView>
          </>
        ) : (
          <ScrollView
            contentInsetAdjustmentBehavior={nativeHeader ? 'never' : 'automatic'}
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[pageStyles.content, nativeHeader && pageStyles.nativeContent]}
          >
            {heading}
            {children}
          </ScrollView>
        )}
      </SafeAreaView>
      {overlay}
    </>
  );
}

function pageBack(
  navigation: React.ContextType<typeof NavigationContext>,
  stack: ReturnType<NonNullable<React.ContextType<typeof NavigationContext>>['getState']> | undefined,
  routeKey: string | undefined,
  mode: PageProps['mode'],
) {
  return mode !== 'sheet' &&
    stack?.type === 'stack' &&
    stack.index > 0 &&
    stack.routes[stack.index]?.key === routeKey
    ? () => navigation?.goBack()
    : undefined;
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
  nativeContent: { paddingBottom: spacing.lg },
  cameraHeading: { paddingHorizontal: spacing.md, paddingVertical: spacing.lg },
  camera: { flex: 1, backgroundColor: color.cameraBackground },
});
