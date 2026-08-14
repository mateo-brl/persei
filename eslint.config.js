// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Les valeurs partagées de Reanimated s'écrivent par `.value` depuis un
    // worklet : c'est l'API officielle, mais la règle d'immutabilité du
    // compilateur React y voit une mutation interdite.
    files: ["src/components/ruler-slider.tsx"],
    rules: { "react-hooks/immutability": "off" },
  },
]);
