import { type NavigationAction, useNavigation, usePreventRemove } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';

/** Native Back waits for the owning flow to settle. A failed handoff keeps the route and its
 * recovery UI alive; repeated Back gestures cannot start a second handoff. The original
 * navigation action is replayed only after removal prevention has been lifted. */
export function NativeFlowBack({ close }: Readonly<{ close: () => unknown }>) {
  const navigation = useNavigation();
  const [released, setReleased] = useState(false);
  const pending = useRef<NavigationAction | undefined>(undefined);
  const settling = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  usePreventRemove(!released, ({ data }) => {
    if (settling.current) return;
    pending.current = data.action;
    settling.current = true;
    Promise.resolve()
      .then(close)
      .then((success) => {
        if (!mounted.current) return;
        if (success === false) {
          settling.current = false;
          pending.current = undefined;
        } else setReleased(true);
      })
      .catch(() => {
        // The flow owns error presentation. A rejected close must never discard its session.
        settling.current = false;
        pending.current = undefined;
      });
  });
  useEffect(() => {
    if (!released || !pending.current) return;
    const action = pending.current;
    pending.current = undefined;
    navigation.dispatch(action);
  }, [navigation, released]);
  return null;
}
