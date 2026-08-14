import AppIntents
import SwiftUI
import WidgetKit

/// Contrôles Persei pour le Centre de contrôle et l'écran verrouillé.
///
/// Le bouton ouvre l'app par son schéma d'URL plutôt que par un intent maison :
/// une extension a ses propres réglages, elle ne partage rien avec l'app sans
/// groupe d'app. L'URL, elle, arrive telle quelle jusqu'à l'écran.
struct PerseiCameraControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.mateobaril.persei.control.camera") {
      ControlWidgetButton(action: OpenURLIntent(URL(string: "persei://?mode=photo")!)) {
        Label("Persei", systemImage: "camera.aperture")
      }
    }
    .displayName("Persei")
    .description("Ouvrir l'appareil photo Persei.")
  }
}

struct PerseiAstroControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.mateobaril.persei.control.astro") {
      ControlWidgetButton(action: OpenURLIntent(URL(string: "persei://?mode=meteors")!)) {
        Label("Persei astro", systemImage: "moon.stars")
      }
    }
    .displayName("Persei astro")
    .description("Ouvrir Persei réglé pour le ciel.")
  }
}

@main
struct PerseiWidgets: WidgetBundle {
  var body: some Widget {
    PerseiCameraControl()
    PerseiAstroControl()
  }
}
