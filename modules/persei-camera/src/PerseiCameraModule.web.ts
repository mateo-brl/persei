import { registerWebModule, NativeModule } from 'expo';

class PerseiCameraModule extends NativeModule<{}> {}

export default registerWebModule(PerseiCameraModule, 'PerseiCameraModule');
