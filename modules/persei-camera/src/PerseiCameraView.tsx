import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';

const NativeView = requireNativeView<ViewProps>('PerseiCamera');

export default function PerseiCameraView(props: ViewProps) {
  return <NativeView {...props} />;
}
