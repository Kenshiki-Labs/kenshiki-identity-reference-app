import { type CaptureSession, IdentityCaptureImage } from '@kenshiki/identity-capture';
import { Text, View } from 'react-native';
import { styles } from '../ui/styles';

/** A result image remains bound to its retained session and exact evidence hash. */
export function ResultPortrait({
  session,
  image,
  sha256,
  label,
  caption,
}: Readonly<{
  session: CaptureSession;
  image: 'reference' | 'selfie';
  sha256: string;
  label: string;
  caption: string;
}>) {
  return (
    <View style={styles.portrait}>
      <IdentityCaptureImage
        session={session}
        image={image}
        sha256={sha256}
        accessibilityLabel={label}
        style={styles.image}
      />
      <Text style={styles.label}>{caption}</Text>
    </View>
  );
}
