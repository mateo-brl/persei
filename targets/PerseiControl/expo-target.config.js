/**
 * Boutons de Centre de contrôle et d'écran verrouillé.
 *
 * Cible séparée (WidgetKit) : iOS n'accepte les contrôles que depuis une
 * extension. Elle exige iOS 18, l'app reste compatible plus bas — le contrôle
 * n'apparaît simplement pas sur les versions antérieures.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'widget',
  name: 'PerseiControl',
  displayName: 'Persei',
  bundleIdentifier: '.control',
  deploymentTarget: '18.0',
  frameworks: ['WidgetKit', 'SwiftUI', 'AppIntents'],
};
