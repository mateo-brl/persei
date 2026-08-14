import Foundation

/// Garde la trace du dernier plantage pour pouvoir le lire au lancement
/// suivant.
///
/// Une exception Objective-C levée sur une file d'arrière-plan (c'est le mode
/// d'échec habituel d'AVFoundation : réglage hors bornes, sortie retirée de la
/// session, combinaison interdite) tue le processus sans rien afficher.
/// L'utilisateur voit l'app disparaître et il ne reste rien à lire. Ce
/// gestionnaire écrit le nom, la raison et le haut de la pile.
///
/// Limite assumée : seules les exceptions Objective-C passent ici. Un accès
/// mémoire invalide ou une coupure du système pour cause de mémoire ou de
/// chaleur ne laisseront rien. Une trace vide après un plantage est donc une
/// information en soi : elle écarte la piste de l'exception.
enum CrashLog {
  private static let cleCrash = "persei.lastCrash"
  private static let cleIncident = "persei.lastIncident"

  private static var previousHandler: (@convention(c) (NSException) -> Void)?

  /// Fichier de secours : dans un processus en train de mourir, une écriture
  /// atomique aboutit là où les réglages différés se perdent.
  private static var fichier: URL? {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
      .appendingPathComponent("persei-dernier-plantage.txt")
  }

  static func install() {
    // Un autre gestionnaire peut déjà être en place (le moteur JS en pose un) :
    // on le rappelle pour ne rien casser de son côté.
    previousHandler = NSGetUncaughtExceptionHandler()
    NSSetUncaughtExceptionHandler { exception in
      let pile = exception.callStackSymbols.prefix(14).joined(separator: "\n")
      let texte = """
      \(exception.name.rawValue)
      \(exception.reason ?? "sans raison")
      \(pile)
      """
      CrashLog.ecrire(texte)
      CrashLog.previousHandler?(exception)
    }
  }

  private static func ecrire(_ texte: String) {
    UserDefaults.standard.set(texte, forKey: cleCrash)
    // Le processus meurt dans la seconde : l'écriture différée n'aurait jamais
    // lieu sans cette synchronisation, pourtant dépréciée.
    UserDefaults.standard.synchronize()
    if let fichier {
      try? Data(texte.utf8).write(to: fichier, options: .atomic)
    }
  }

  /// Lit puis efface la trace : elle ne doit être montrée qu'une fois. Ne rend
  /// quelque chose que s'il y a eu un vrai plantage ; le dernier incident non
  /// fatal y est joint, c'est souvent lui qui explique la suite.
  static func consume() -> String? {
    let reglages = UserDefaults.standard
    var crash = reglages.string(forKey: cleCrash)
    if crash == nil, let fichier, let secours = try? String(contentsOf: fichier, encoding: .utf8) {
      crash = secours
    }
    let incident = reglages.string(forKey: cleIncident)

    reglages.removeObject(forKey: cleCrash)
    reglages.removeObject(forKey: cleIncident)
    if let fichier { try? FileManager.default.removeItem(at: fichier) }

    guard let crash else { return nil }
    guard let incident else { return crash }
    return crash + "\n\nDernier incident avant : " + incident
  }

  /// Note un incident non fatal (erreur de session). Il n'ouvre pas la carte
  /// de plantage tout seul, il sert de contexte si un plantage suit.
  static func record(_ texte: String) {
    UserDefaults.standard.set(texte, forKey: cleIncident)
  }
}
