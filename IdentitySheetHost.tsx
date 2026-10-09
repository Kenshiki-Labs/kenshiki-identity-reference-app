import type React from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { styles } from './IdentityCaptureFlow';

const Sheets = createContext<((content: React.ReactNode) => void) | undefined>(undefined);
/** Keep this above the scroll/navigation content so notification sheets rise from the screen bottom. */
export function IdentitySheetHost({ children }: { children: React.ReactNode }) {
  const [sheet, setSheet] = useState<React.ReactNode>();
  const present = useMemo(() => (content: React.ReactNode) => setSheet(content), []);
  return (
    <Sheets.Provider value={present}>
      <View style={styles.root}>
        <View
          style={styles.root}
          accessibilityElementsHidden={!!sheet}
          importantForAccessibility={sheet ? 'no-hide-descendants' : 'auto'}
        >
          {children}
        </View>
        {sheet && (
          <View style={styles.scrim}>
            <View style={styles.sheet} accessibilityViewIsModal>
              {sheet}
            </View>
          </View>
        )}
      </View>
    </Sheets.Provider>
  );
}
export function IdentitySheet({ children }: { children?: React.ReactNode | undefined }) {
  const present = useContext(Sheets);
  useEffect(() => {
    present?.(children);
    return () => present?.(undefined);
  }, [present, children]);
  return !present && children ? (
    <View style={styles.scrim}>
      <View style={styles.sheet} accessibilityViewIsModal>
        {children}
      </View>
    </View>
  ) : null;
}
