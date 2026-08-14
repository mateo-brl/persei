import AppIntents
import Foundation

/// Raccourcis Siri, Spotlight et bouton Action.
///
/// Ces types doivent être compilés dans la cible de l'app, pas dans le module
/// Expo : les App Intents sont découverts par une extraction de métadonnées à
/// la compilation, et cette extraction ne regarde pas les sources des pods.
/// Un plugin de configuration les recopie donc dans le projet généré.
enum PerseiLaunchMode {
  /// Le module natif lit puis efface cette clé au démarrage de l'app.
  static let key = "persei.launchMode"

  static func request(_ mode: String) {
    UserDefaults.standard.set(mode, forKey: key)
  }
}

@available(iOS 16.4, *)
struct OpenPerseiIntent: AppIntent {
  static var title: LocalizedStringResource = "Ouvrir Persei"
  static var description = IntentDescription("Ouvre l'appareil photo Persei.")
  static var openAppWhenRun = true

  @MainActor
  func perform() async throws -> some IntentResult {
    PerseiLaunchMode.request("photo")
    return .result()
  }
}

@available(iOS 16.4, *)
struct PerseiAstroIntent: AppIntent {
  static var title: LocalizedStringResource = "Persei en mode astro"
  static var description = IntentDescription(
    "Ouvre Persei prêt pour le ciel : pose longue, ISO élevé, mise au point sur l'infini."
  )
  static var openAppWhenRun = true

  @MainActor
  func perform() async throws -> some IntentResult {
    PerseiLaunchMode.request("meteors")
    return .result()
  }
}

@available(iOS 16.4, *)
struct PerseiVideoIntent: AppIntent {
  static var title: LocalizedStringResource = "Filmer avec Persei"
  static var description = IntentDescription("Ouvre Persei en mode vidéo.")
  static var openAppWhenRun = true

  @MainActor
  func perform() async throws -> some IntentResult {
    PerseiLaunchMode.request("video")
    return .result()
  }
}

/// Chaque phrase doit contenir le nom de l'app, Siri ne route pas sans lui.
@available(iOS 16.4, *)
struct PerseiShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: OpenPerseiIntent(),
      phrases: [
        "Ouvrir \(.applicationName)",
        "Prendre une photo avec \(.applicationName)",
      ],
      shortTitle: "Ouvrir",
      systemImageName: "camera.aperture"
    )
    AppShortcut(
      intent: PerseiAstroIntent(),
      phrases: [
        "Mode astro dans \(.applicationName)",
        "Photographier les étoiles avec \(.applicationName)",
      ],
      shortTitle: "Mode astro",
      systemImageName: "moon.stars"
    )
    AppShortcut(
      intent: PerseiVideoIntent(),
      phrases: [
        "Filmer avec \(.applicationName)",
      ],
      shortTitle: "Vidéo",
      systemImageName: "video"
    )
  }
}
