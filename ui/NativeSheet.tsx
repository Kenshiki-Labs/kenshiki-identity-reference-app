import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { ActionSheetIOS, Modal } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Page } from './Page';

/** A UIKit page sheet: the system presents it, dims what is behind it and keeps VoiceOver inside it.
 * Without `onDismiss` it can only be left through its own actions, as a recovery prompt must be;
 * with it, a downward swipe calls `onDismiss`. */
export function NativeSheet({
  title,
  testID,
  onDismiss,
  children,
}: Readonly<{
  title: string;
  testID?: string | undefined;
  onDismiss?: (() => void) | undefined;
  children: ReactNode;
}>) {
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      allowSwipeDismissal={!!onDismiss}
      onRequestClose={onDismiss}
    >
      <SafeAreaProvider>
        <Page title={title} mode="sheet" testID={testID} onClose={onDismiss}>
          {children}
        </Page>
      </SafeAreaProvider>
    </Modal>
  );
}

/** A destructive choice, asked with the iOS action sheet. */
export type Confirmation = {
  /** Identifies the question; the sheet is shown once each time the key appears. */
  key: string;
  title: string;
  message: string;
  /** The destructive action's label. */
  confirm: string;
  /** The label that leaves everything as it is. */
  keep: string;
  onConfirm: () => void;
  onKeep: () => void;
};

/** Shows `request` as an action sheet while it is present. The caller's state stays the source of
 * truth: the sheet appears when a request with a new key appears, and each choice calls back. */
export function useConfirmation(request: Confirmation | undefined) {
  const latest = useRef(request);
  useLayoutEffect(() => {
    latest.current = request;
  });
  const key = request?.key;
  useLayoutEffect(() => {
    const asked = latest.current;
    if (key === undefined || asked === undefined) return;
    let active = true;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: asked.title,
        message: asked.message,
        options: [asked.confirm, asked.keep],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (!active || latest.current?.key !== key) return;
        active = false;
        if (index === 0) asked.onConfirm();
        else asked.onKeep();
      },
    );
    return () => {
      if (!active) return;
      active = false;
      ActionSheetIOS.dismissActionSheet();
    };
  }, [key]);
}

/** Asks a destructive question with the iOS action sheet, now, for an action a row starts. The
 * destructive choice is first and red; the other leaves everything as it is. */
export function confirmDestructive(question: Omit<Confirmation, 'key' | 'onKeep'>) {
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: question.title,
      message: question.message,
      options: [question.confirm, question.keep],
      destructiveButtonIndex: 0,
      cancelButtonIndex: 1,
    },
    (index) => {
      if (index === 0) question.onConfirm();
    },
  );
}
