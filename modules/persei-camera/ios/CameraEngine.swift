import AVFoundation
import Foundation

/// Erreurs du moteur, chacune avec un code unique (Pxx) affiché à
/// l'utilisateur : le code suffit à retrouver le point de défaillance exact.
enum CameraEngineError: Error, LocalizedError {
  case deviceUnavailable        // P10 : aucun device résolu ou input refusé
  case notRunning               // P11 : session arrêtée au moment de l'appel
  case captureFailed(String)    // P2x/P3x : voir le code embarqué dans le message

  var errorDescription: String? {
    switch self {
    case .deviceUnavailable: return "P10: camera device unavailable"
    case .notRunning: return "P11: camera session is not running"
    case .captureFailed(let reason): return reason
    }
  }
}

/// Owns the AVCaptureSession and exposes every publicly controllable camera
/// capability: custom exposure (ISO + shutter), manual focus, white balance
/// (kelvin + tint), lens/position switching, zoom, flash/torch, Live Photos,
/// depth delivery, exposure bracketing and RAW/ProRAW capture.
final class CameraEngine: NSObject {
  static let shared = CameraEngine()

  let session = AVCaptureSession()

  // All session/device mutations happen on this queue.
  let sessionQueue = DispatchQueue(label: "app.persei.camera.session")
  private(set) var device: AVCaptureDevice?
  private(set) var videoInput: AVCaptureDeviceInput?
  private let photoOutput = AVCapturePhotoOutput()

  // MARK: Vidéo (voir VideoEngine.swift)

  /// Sortie fichier, entrée audio et réglages vidéo courants.
  let video = VideoState()
  /// Promesse de `stopRecording` en attente du fichier finalisé.
  var pendingStopCompletion: ((Result<String, Error>) -> Void)?
  /// Promesse de `startRecording`, tenue quand le fichier commence vraiment.
  var pendingStartCompletion: ((Result<Void, Error>) -> Void)?
  /// Cause d'un arrêt subi (surchauffe, interruption, disque plein).
  var stopReason: String?
  var onRecordingProgress: (([String: Any]) -> Void)? {
    get { lues { _onRecordingProgress } }
    set { callbackLock.lock(); _onRecordingProgress = newValue; callbackLock.unlock() }
  }
  var onRecordingStopped: (([String: Any]) -> Void)? {
    get { lues { _onRecordingStopped } }
    set { callbackLock.lock(); _onRecordingStopped = newValue; callbackLock.unlock() }
  }
  /// Une propriété stockée ne peut pas porter d'annotation de disponibilité :
  /// le coordinateur de rotation d'iOS 17 est donc gardé sans type.
  private var rotationCoordinatorStorage: Any?

  @available(iOS 17.0, *)
  var rotationCoordinator: AVCaptureDevice.RotationCoordinator? {
    get { rotationCoordinatorStorage as? AVCaptureDevice.RotationCoordinator }
    set { rotationCoordinatorStorage = newValue }
  }
  // Keeps capture delegates alive until their capture completes.
  private var inFlightCaptures: [Int64: PhotoCaptureDelegate] = [:]

  // Aides de visée (histogramme, peaking, zebras, loupe).
  let processor = FrameProcessor()
  private let videoDataOutput = AVCaptureVideoDataOutput()
  private let processingQueue = DispatchQueue(label: "app.persei.camera.processing")
  /// Lecture des codes (QR, codes-barres) dans la préview, comme l'app Camera.
  let metadataOutput = AVCaptureMetadataOutput()
  private var lastCodeValue: String?
  private var lastCodeDate = Date.distantPast
  /// Code détecté : { value, type }.
  var onCodeDetected: (([String: Any]) -> Void)? {
    get { lues { _onCodeDetected } }
    set { callbackLock.lock(); _onCodeDetected = newValue; callbackLock.unlock() }
  }
  weak var assistView: PerseiCameraView?

  // Les rappels vers JS sont posés depuis la file du module Expo et lus
  // depuis les files KVO, de traitement et de session. Lire une closure
  // pendant qu'une autre file la réécrit fait manipuler à ARC un contexte à
  // moitié publié : le processus meurt sur-le-champ, sans rien afficher.
  // D'où ce verrou, seul endroit du moteur où plusieurs files se croisent.
  private let callbackLock = NSLock()
  private var _onHistogram: (([Double]) -> Void)?
  private var _onCaptureButton: (() -> Void)?
  private var _onExposureUpdate: (([String: Any]) -> Void)?
  private var _onLongExposureProgress: (([String: Any]) -> Void)?
  private var _onRecordingProgress: (([String: Any]) -> Void)?
  private var _onRecordingStopped: (([String: Any]) -> Void)?
  private var _onSystemPressure: (([String: Any]) -> Void)?
  private var _onCodeDetected: (([String: Any]) -> Void)?

  private func lues<T>(_ lecture: () -> T) -> T {
    callbackLock.lock()
    defer { callbackLock.unlock() }
    return lecture()
  }

  /// Histogramme 64 bins vers JS (~5 Hz quand activé).
  var onHistogram: (([Double]) -> Void)? {
    get { lues { _onHistogram } }
    set { callbackLock.lock(); _onHistogram = newValue; callbackLock.unlock() }
  }
  /// Pression du bouton volume / Camera Control.
  var onCaptureButton: (() -> Void)? {
    get { lues { _onCaptureButton } }
    set { callbackLock.lock(); _onCaptureButton = newValue; callbackLock.unlock() }
  }

  override init() {
    super.init()
    processor.onOverlayImage = { [weak self] image in
      DispatchQueue.main.async { self?.assistView?.setAssistOverlay(image) }
    }
    processor.onLoupeImage = { [weak self] image in
      DispatchQueue.main.async { self?.assistView?.setLoupe(image) }
    }
    processor.onHistogram = { [weak self] bins in
      self?.onHistogram?(bins)
    }
    CrashLog.install()
    // Appel entrant, passage en arrière-plan, caméra prise par une autre app :
    // un enregistrement en cours est fermé proprement plutôt que perdu.
    NotificationCenter.default.addObserver(
      forName: AVCaptureSession.wasInterruptedNotification,
      object: session,
      queue: nil
    ) { [weak self] _ in
      self?.stopRecordingBecause("interruption")
    }
    // Une erreur de session (coût matériel dépassé, services média
    // réinitialisés) coupait le flux en silence : on la note et on la dit.
    NotificationCenter.default.addObserver(
      forName: AVCaptureSession.runtimeErrorNotification,
      object: session,
      queue: nil
    ) { [weak self] note in
      guard let self else { return }
      let erreur = note.userInfo?[AVCaptureSessionErrorKey] as? NSError
      let texte = "P12: session runtime error (\(erreur?.localizedDescription ?? "inconnue"))"
      CrashLog.record(texte)
      self.stopRecordingBecause("erreur")
      self.onSystemPressure?(["level": "sessionError", "message": texte])
      // La session s'arrête d'elle-même sur ce type d'erreur : on la relance.
      self.sessionQueue.async {
        if !self.session.isRunning { self.session.startRunning() }
      }
    }
  }

  // Préférences de capture (appliquées à chaque photo).
  private var flashMode: AVCaptureDevice.FlashMode = .off
  /// Définition photo visée, en mégapixels (0 = la plus grande disponible).
  private var photoMegapixels: Double = 0
  private var livePhotoEnabled = false
  private var depthEnabled = false

  /// Live sensor readout pushed to JS (set by the module while observed).
  var onExposureUpdate: (([String: Any]) -> Void)? {
    get { lues { _onExposureUpdate } }
    set { callbackLock.lock(); _onExposureUpdate = newValue; callbackLock.unlock() }
  }
  private var observations: [NSKeyValueObservation] = []
  private var lastEmit = Date.distantPast

  // (plus de table d'objectifs discrets : l'arrière passe par le device virtuel)

  // MARK: - Session lifecycle

  func start(lens: String, completion: @escaping (Result<[String: Any], Error>) -> Void) {
    sessionQueue.async {
      do {
        let capabilities = try self.configureSession(lens: lens)
        if !self.session.isRunning {
          self.session.startRunning()
        }
        completion(.success(capabilities))
      } catch {
        completion(.failure(error))
      }
    }
  }

  func stop() {
    sessionQueue.async {
      if self.session.isRunning {
        self.session.stopRunning()
      }
    }
  }

  private func resolveDevice(lens: String) -> AVCaptureDevice? {
    if lens == "front" {
      return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
    }
    // Arrière : device virtuel comme l'app Camera d'Apple — zoom continu
    // 0,5x→télé avec bascule d'objectif automatique et macro auto.
    return AVCaptureDevice.default(.builtInTripleCamera, for: .video, position: .back)
      ?? AVCaptureDevice.default(.builtInDualWideCamera, for: .video, position: .back)
      ?? AVCaptureDevice.default(.builtInDualCamera, for: .video, position: .back)
      ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
  }

  private func configureSession(lens: String) throws -> [String: Any] {
    guard let newDevice = resolveDevice(lens: lens) else {
      throw CameraEngineError.deviceUnavailable
    }
    // Reconfigurer la session pendant un enregistrement fait lever une
    // exception à la sortie film : on ferme le fichier d'abord.
    if video.isRecording {
      video.output.stopRecording()
      video.isRecording = false
    }

    session.beginConfiguration()
    session.sessionPreset = .photo

    let previousInput = videoInput
    if let previousInput {
      session.removeInput(previousInput)
      videoInput = nil
    }

    let input = try AVCaptureDeviceInput(device: newDevice)
    guard session.canAddInput(input) else {
      // Nouveau device refusé : on remet l'ancien input plutôt que de
      // laisser une session sans entrée (crash à la capture suivante).
      if let previousInput, session.canAddInput(previousInput) {
        session.addInput(previousInput)
        videoInput = previousInput
      }
      session.commitConfiguration()
      throw CameraEngineError.deviceUnavailable
    }
    session.addInput(input)
    videoInput = input
    device = newDevice

    if !session.outputs.contains(photoOutput) {
      guard session.canAddOutput(photoOutput) else {
        session.commitConfiguration()
        throw CameraEngineError.deviceUnavailable
      }
      session.addOutput(photoOutput)
    }

    photoOutput.maxPhotoQualityPrioritization = .quality
    if photoOutput.isAppleProRAWSupported {
      photoOutput.isAppleProRAWEnabled = true
    }
    if photoOutput.isLivePhotoCaptureSupported {
      photoOutput.isLivePhotoCaptureEnabled = livePhotoEnabled
    }
    if photoOutput.isDepthDataDeliverySupported {
      photoOutput.isDepthDataDeliveryEnabled = depthEnabled
    }
    if #available(iOS 17.0, *) {
      if photoOutput.isZeroShutterLagSupported {
        photoOutput.isZeroShutterLagEnabled = true
      }
      if photoOutput.isResponsiveCaptureSupported {
        photoOutput.isResponsiveCaptureEnabled = true
      }
      if photoOutput.isFastCapturePrioritizationSupported {
        photoOutput.isFastCapturePrioritizationEnabled = true
      }
    }

    if !session.outputs.contains(videoDataOutput) {
      // 4:2:0 8 bits plutôt que du BGRA : Core Image le lit nativement et la
      // session convertit quatre fois moins de données par seconde, ce qui
      // compte quand la sortie film tourne en même temps.
      videoDataOutput.videoSettings = [
        kCVPixelBufferPixelFormatTypeKey as String:
          kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
      ]
      videoDataOutput.alwaysDiscardsLateVideoFrames = true
      videoDataOutput.setSampleBufferDelegate(processor, queue: processingQueue)
      if session.canAddOutput(videoDataOutput) {
        session.addOutput(videoDataOutput)
      }
    }
    if !session.outputs.contains(metadataOutput), session.canAddOutput(metadataOutput) {
      session.addOutput(metadataOutput)
      metadataOutput.setMetadataObjectsDelegate(self, queue: processingQueue)
    }
    restoreCodeScanningLocked()

    // Frames en portrait pour que les calques d'aide collent à la préview.
    if let connection = videoDataOutput.connection(with: .video) {
      if #available(iOS 17.0, *) {
        if connection.isVideoRotationAngleSupported(90) {
          connection.videoRotationAngle = 90
        }
      } else if connection.isVideoOrientationSupported {
        connection.videoOrientation = .portrait
      }
    }

    session.commitConfiguration()
    startObserving(newDevice)

    // Après le commit : avant, le preset .photo n'a pas encore rebasculé le
    // format du device, qui peut être resté sur celui d'une session vidéo
    // précédente. Les définitions posées appartiendraient alors à la vidéo.
    applyResolutionPreference(for: newDevice)

    // Le preset remis à .photo efface le format vidéo : si on était en vidéo
    // (changement d'objectif en cours de session), on le réapplique.
    if video.isActive {
      applyVideoFormatLocked()
    }

    // Démarrage sur le 1× (capteur principal, le meilleur) plutôt que sur le
    // 0,5× de l'ultra grand-angle où le device virtuel démarre par défaut.
    if newDevice.position == .back, !newDevice.constituentDevices.isEmpty {
      let switchOvers = newDevice.virtualDeviceSwitchOverVideoZoomFactors.map { CGFloat(truncating: $0) }
      if let wideZoom = switchOvers.first {
        do {
          try newDevice.lockForConfiguration()
          defer { newDevice.unlockForConfiguration() }
          newDevice.videoZoomFactor = min(
            max(wideZoom, newDevice.minAvailableVideoZoomFactor),
            newDevice.maxAvailableVideoZoomFactor
          )
        } catch {}
      }
    }

    return capabilities(of: newDevice)
  }

  /// Les dimensions photo doivent appartenir à celles du format actif : après
  /// un changement de format (vidéo), en garder d'anciennes fait lever une
  /// exception au premier déclenchement.
  func applyResolutionPreference(for device: AVCaptureDevice) {
    let dimensions = device.activeFormat.supportedMaxPhotoDimensions
    guard !dimensions.isEmpty else { return }
    let sizes = dimensions.map(Self.megapixels(of:))
    guard let index = CameraMath.nearestPhotoSize(sizes, target: photoMegapixels) else { return }
    photoOutput.maxPhotoDimensions = dimensions[index]
  }

  /// Définitions offertes par le format ACTIF, traduites pour CameraMath.
  private var definitionsDuFormatActif: [PhotoSize] {
    (device?.activeFormat.supportedMaxPhotoDimensions ?? [])
      .map { PhotoSize(width: Int($0.width), height: Int($0.height)) }
  }

  /// Plafond posé sur la sortie photo. Une demande de capture ne peut jamais
  /// le dépasser.
  private var plafondDeLaSortie: PhotoSize {
    let dimensions = photoOutput.maxPhotoDimensions
    return PhotoSize(width: Int(dimensions.width), height: Int(dimensions.height))
  }

  /// Plafond de la sortie, remis d'aplomb s'il vient d'un autre format.
  ///
  /// C'est lui la source du plantage du 14 août, pas la demande de capture :
  /// tant qu'il désigne une définition absente du format actif, plus aucune
  /// taille n'est demandable. On le recalcule plutôt que de renoncer à la
  /// pleine définition.
  private func plafondVerifie() -> PhotoSize {
    let definitions = definitionsDuFormatActif
    guard CameraMath.isPhotoCapStale(plafondDeLaSortie, available: definitions),
          let device
    else { return plafondDeLaSortie }
    applyResolutionPreference(for: device)
    return plafondDeLaSortie
  }

  /// Pose les dimensions sur une demande de capture, et seulement si le format
  /// actif ET le plafond de la sortie les acceptent tous les deux.
  ///
  /// C'est la garde qui rend le plantage du 14 août impossible à reproduire :
  /// le plafond de la sortie avait été calculé sur le format vidéo, il ne
  /// figurait plus dans les définitions du format photo redevenu actif, et
  /// `capturePhoto` levait une exception. Recopier ce plafond sans le vérifier
  /// revenait à faire confiance à un état qu'une reconfiguration a pu périmer.
  private func poserDimensions(_ taille: PhotoSize?, sur settings: AVCapturePhotoSettings) {
    guard let taille else { return }
    settings.maxPhotoDimensions = CMVideoDimensions(
      width: Int32(taille.width),
      height: Int32(taille.height)
    )
  }

  /// La sortie photo peut-elle déclencher maintenant ? En mode vidéo Log, ou
  /// pendant une reconfiguration, sa connexion existe mais reste inactive :
  /// déclencher dessus lève une exception au lieu de rendre une erreur.
  private var sortiePhotoPrete: Bool {
    guard let connexion = photoOutput.connection(with: .video) else { return false }
    return connexion.isActive && connexion.isEnabled
  }

  private static func megapixels(of dimensions: CMVideoDimensions) -> Double {
    Double(dimensions.width) * Double(dimensions.height) / 1_000_000.0
  }

  /// Définitions photo réellement offertes par le format actif (12, 24, 48 MP
  /// selon l'appareil), arrondies au dixième.
  private func photoResolutions(of device: AVCaptureDevice) -> [Double] {
    device.activeFormat.supportedMaxPhotoDimensions
      .map { (Self.megapixels(of: $0) * 10).rounded() / 10 }
      .sorted()
  }

  /// Traduction d'une caméra physique en description testable (CameraMath).
  private func lensSpec(of device: AVCaptureDevice) -> LensSpec {
    let kind: LensKind
    switch device.deviceType {
    case .builtInUltraWideCamera: kind = .ultraWide
    case .builtInWideAngleCamera: kind = .wide
    case .builtInTelephotoCamera: kind = .telephoto
    default: kind = .other
    }
    return LensSpec(
      kind: kind,
      secondaryCrops: device.activeFormat.secondaryNativeResolutionZoomFactors.map { Double($0) }
    )
  }

  private func switchOvers(of device: AVCaptureDevice) -> [Double] {
    device.virtualDeviceSwitchOverVideoZoomFactors.map { Double(truncating: $0) }
  }

  /// Pastilles de zoom façon app Apple (0,5× / 1× / 2× / 5× sur 16 Pro) :
  /// `factor` est l'affichage, `zoom` le videoZoomFactor correspondant sur le
  /// device virtuel. Le 2× vient du recadrage natif qualité optique du 48 MP.
  private func zoomPresets(of device: AVCaptureDevice) -> [[String: Double]] {
    guard device.position == .back else { return [] }
    let presets = CameraMath.zoomPresets(
      constituents: device.constituentDevices.map(lensSpec(of:)),
      switchOvers: switchOvers(of: device)
    )
    return presets.map { ["factor": $0.factor, "zoom": $0.zoom] }
  }

  private func capabilities(of device: AVCaptureDevice) -> [String: Any] {
    let format = device.activeFormat
    let hasFrontCamera =
      AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) != nil
    let maxDimensions = format.supportedMaxPhotoDimensions.last
    let maxMegapixels = maxDimensions.map { Double($0.width) * Double($0.height) / 1_000_000.0 } ?? 12.0

    return [
      "minIso": Double(format.minISO),
      "maxIso": Double(format.maxISO),
      "minShutter": format.minExposureDuration.seconds,
      "maxShutter": format.maxExposureDuration.seconds,
      "minExposureBias": Double(device.minExposureTargetBias),
      "maxExposureBias": Double(device.maxExposureTargetBias),
      "supportsRaw": !photoOutput.availableRawPhotoPixelFormatTypes.isEmpty,
      "supportsProRaw": photoOutput.isAppleProRAWSupported,
      "maxMegapixels": maxMegapixels,
      "photoResolutions": photoResolutions(of: device),
      "zoomPresets": zoomPresets(of: device),
      "hasFrontCamera": hasFrontCamera,
      "minZoom": Double(device.minAvailableVideoZoomFactor),
      "maxZoom": Double(device.maxAvailableVideoZoomFactor),
      "hasFlash": device.hasFlash,
      "hasTorch": device.hasTorch,
      "supportsLivePhoto": photoOutput.isLivePhotoCaptureSupported,
      "supportsDepth": photoOutput.isDepthDataDeliverySupported,
      "maxBracketCount": Int(photoOutput.maxBracketedCapturePhotoCount),
    ]
  }

  // MARK: - Live readout

  private func startObserving(_ device: AVCaptureDevice) {
    observations.forEach { $0.invalidate() }
    observations = [
      device.observe(\.iso, options: [.initial, .new]) { [weak self] _, _ in self?.emitUpdate() },
      device.observe(\.exposureDuration, options: [.new]) { [weak self] _, _ in self?.emitUpdate() },
      device.observe(\.lensPosition, options: [.new]) { [weak self] _, _ in self?.emitUpdate() },
      device.observe(\.deviceWhiteBalanceGains, options: [.new]) { [weak self] _, _ in self?.emitUpdate() },
      device.observe(\.exposureTargetBias, options: [.new]) { [weak self] _, _ in self?.emitUpdate() },
      device.observe(\.videoZoomFactor, options: [.new]) { [weak self] _, _ in self?.emitUpdate() },
      // Surchauffe : le système finit par couper la caméra sans prévenir. On
      // ferme le fichier avant, sinon l'enregistrement est perdu.
      device.observe(\.systemPressureState, options: [.new]) { [weak self] device, _ in
        self?.handleSystemPressure(device.systemPressureState)
      },
    ]
    if #available(iOS 17.0, *) {
      rotationCoordinator = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: nil)
    }
  }

  /// Surchauffe. Le système finit par couper la caméra de lui-même : plutôt
  /// que d'attendre ce moment, on allège la session et on prévient. Jusqu'ici
  /// le niveau critique était détecté, transmis, et n'affichait rien.
  private func handleSystemPressure(_ state: AVCaptureDevice.SystemPressureState) {
    switch state.level {
    case .shutdown:
      stopRecordingBecause("thermal")
      onSystemPressure?(["level": "shutdown"])
      sessionQueue.async { self.setAssistOutputEnabled(false) }
    case .critical:
      stopRecordingBecause("thermal")
      onSystemPressure?(["level": "critical"])
      sessionQueue.async {
        self.setAssistOutputEnabled(false)
        // Rendre la cadence au système : il la remontera en refroidissant.
        guard #available(iOS 18.0, *), let device = self.device,
              device.activeFormat.isAutoVideoFrameRateSupported,
              !device.isAutoVideoFrameRateEnabled
        else { return }
        do {
          try device.lockForConfiguration()
          defer { device.unlockForConfiguration() }
          device.isAutoVideoFrameRateEnabled = true
        } catch {}
      }
    case .serious:
      onSystemPressure?(["level": "serious"])
      sessionQueue.async { self.setAssistOutputEnabled(false) }
    default:
      break
    }
  }

  /// Avertissement thermique vers le JS.
  var onSystemPressure: (([String: Any]) -> Void)? {
    get { lues { _onSystemPressure } }
    set { callbackLock.lock(); _onSystemPressure = newValue; callbackLock.unlock() }
  }

  private func emitUpdate() {
    guard let device, let onExposureUpdate else { return }
    let now = Date()
    // ~10 Hz max vers JS.
    guard now.timeIntervalSince(lastEmit) > 0.1 else { return }
    lastEmit = now

    var kelvin = 0.0
    let gains = device.deviceWhiteBalanceGains
    let maxGain = device.maxWhiteBalanceGain
    if gains.redGain >= 1, gains.greenGain >= 1, gains.blueGain >= 1,
       gains.redGain <= maxGain, gains.greenGain <= maxGain, gains.blueGain <= maxGain {
      kelvin = Double(device.temperatureAndTintValues(for: gains).temperature)
    }

    onExposureUpdate([
      "iso": Double(device.iso),
      "shutter": device.exposureDuration.seconds,
      "lensPosition": Double(device.lensPosition),
      "exposureBias": Double(device.exposureTargetBias),
      "whiteBalanceKelvin": kelvin,
      "zoom": Double(device.videoZoomFactor),
    ])
  }

  // MARK: - Manual controls

  // MARK: - Bascule virtuel ↔ physique pour l'exposition manuelle

  /// Le device virtuel (zoom continu, bascule auto) ne supporte pas le mode
  /// d'exposition .custom : toute exposition manuelle ou pose longue doit se
  /// faire sur la caméra physique correspondant au zoom courant, puis on
  /// revient au virtuel en mode auto.
  private var savedVirtualZoom: CGFloat?
  // Le header Apple est explicite : les devices virtuels ne supportent ni
  // l'exposition custom, ni lensPosition, ni les gains de balance des blancs.
  // Chaque réglage manuel bascule donc sur le physique ; on ne rend le
  // virtuel que quand TOUT est repassé en auto.
  var manualExposureActive = false
  var manualFocusActive = false
  var manualWbActive = false
  private var anyManualActive: Bool {
    manualExposureActive || manualFocusActive || manualWbActive
  }

  /// Caméra physique + zoom équivalent pour le facteur courant du virtuel.
  private func physicalConstituent(
    of virtual: AVCaptureDevice,
    at zoom: CGFloat
  ) -> (device: AVCaptureDevice, zoom: CGFloat) {
    let constituents = virtual.constituentDevices
    let pick = CameraMath.physicalPick(
      constituents: constituents.map(lensSpec(of:)),
      switchOvers: switchOvers(of: virtual),
      zoom: Double(zoom)
    )
    guard let pick, constituents.indices.contains(pick.index) else {
      return (virtual, zoom)
    }
    return (constituents[pick.index], CGFloat(pick.zoom))
  }

  /// À appeler sur la sessionQueue. Remplace l'input par la caméra physique
  /// équivalente si l'input courant est le device virtuel.
  private func ensurePhysicalForManualLocked() {
    // Changer d'entrée coupe l'enregistrement en cours : en vidéo, la bascule
    // se fait avant de lancer, jamais pendant.
    guard !video.isRecording else { return }
    guard let current = device, !current.constituentDevices.isEmpty else { return }
    let currentZoom = current.videoZoomFactor
    savedVirtualZoom = currentZoom
    let target = physicalConstituent(of: current, at: currentZoom)
    switchInputLocked(to: target.device, zoom: target.zoom)
  }

  /// À appeler sur la sessionQueue. Restaure le device virtuel et son zoom.
  func restoreVirtualLocked() {
    guard !video.isRecording else { return }
    guard let current = device, current.constituentDevices.isEmpty,
          current.position == .back,
          let virtualDevice = resolveDevice(lens: "back"),
          !virtualDevice.constituentDevices.isEmpty
    else { return }
    switchInputLocked(to: virtualDevice, zoom: savedVirtualZoom ?? 2.0)
    savedVirtualZoom = nil
  }

  private func switchInputLocked(to newDevice: AVCaptureDevice, zoom: CGFloat) {
    session.beginConfiguration()
    let previousInput = videoInput
    if let previousInput {
      session.removeInput(previousInput)
      videoInput = nil
    }
    if let input = try? AVCaptureDeviceInput(device: newDevice), session.canAddInput(input) {
      session.addInput(input)
      videoInput = input
      device = newDevice
    } else if let previousInput, session.canAddInput(previousInput) {
      // Bascule refusée : on remet l'ancien input, jamais de session sans entrée.
      session.addInput(previousInput)
      videoInput = previousInput
    }
    // La connexion vidéo est recréée avec l'input : réappliquer le portrait.
    if let connection = videoDataOutput.connection(with: .video) {
      if #available(iOS 17.0, *) {
        if connection.isVideoRotationAngleSupported(90) {
          connection.videoRotationAngle = 90
        }
      } else if connection.isVideoOrientationSupported {
        connection.videoOrientation = .portrait
      }
    }
    session.commitConfiguration()

    guard let device else { return }
    // Après le commit seulement : avant, le format actif n'est pas encore
    // celui que la session retient, et les dimensions posées peuvent ne plus
    // lui appartenir (exception à la première photo).
    applyResolutionPreference(for: device)
    startObserving(device)
    let clampedZoom = min(
      max(zoom, device.minAvailableVideoZoomFactor),
      device.maxAvailableVideoZoomFactor
    )
    if abs(clampedZoom - device.videoZoomFactor) > 0.01 {
      do {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        device.videoZoomFactor = clampedZoom
      } catch {}
    }
  }

  private func withLockedDevice(_ body: (AVCaptureDevice) throws -> Void) throws {
    var result: Result<Void, Error> = .success(())
    sessionQueue.sync {
      guard let device = self.device else {
        result = .failure(CameraEngineError.notRunning)
        return
      }
      do {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        try body(device)
      } catch {
        result = .failure(error)
      }
    }
    try result.get()
  }

  /// Bornes d'exposition sûres. Sur un device virtuel, les limites du format
  /// virtuel peuvent dépasser celles de la caméra physique active (l'ultra
  /// grand-angle plafonne bien plus bas que la principale) : dépasser ces
  /// bornes fait lever une NSException par AVFoundation. On prend donc
  /// l'intersection des deux formats.
  private func exposureBounds(of device: AVCaptureDevice) -> ExposureLimits {
    let virtual = limits(of: device.activeFormat)
    var active: ExposureLimits?
    if !device.constituentDevices.isEmpty, let primary = device.activePrimaryConstituent {
      active = limits(of: primary.activeFormat)
    }
    return CameraMath.intersect(virtual, active)
  }

  private func limits(of format: AVCaptureDevice.Format) -> ExposureLimits {
    ExposureLimits(
      minIso: format.minISO,
      maxIso: format.maxISO,
      minSeconds: format.minExposureDuration.seconds,
      maxSeconds: format.maxExposureDuration.seconds
    )
  }

  func setManualExposure(iso: Double, shutterSeconds: Double) throws {
    guard iso.isFinite, shutterSeconds.isFinite else { return }
    sessionQueue.sync {
      guard !self.cinematicActive else { return }
      // L'exposition .custom n'existe pas sur le device virtuel : bascule
      // sur la caméra physique équivalente d'abord.
      self.manualExposureActive = true
      self.ensurePhysicalForManualLocked()
      guard let device = self.device, device.isExposureModeSupported(.custom) else { return }
      do {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        let bounds = self.exposureBounds(of: device)
        let duration = CMTime(
          seconds: CameraMath.clampSeconds(shutterSeconds, in: bounds),
          preferredTimescale: 1_000_000_000
        )
        device.setExposureModeCustom(
          duration: duration,
          iso: CameraMath.clampIso(iso, in: bounds),
          completionHandler: nil
        )
      } catch {}
    }
  }

  func setAutoExposure() throws {
    sessionQueue.sync {
      self.manualExposureActive = false
      if let device = self.device {
        do {
          try device.lockForConfiguration()
          defer { device.unlockForConfiguration() }
          if device.isExposureModeSupported(.continuousAutoExposure) {
            device.exposureMode = .continuousAutoExposure
          }
        } catch {}
      }
      // Retour au virtuel seulement quand plus aucun réglage manuel n'est actif.
      if !self.anyManualActive {
        self.restoreVirtualLocked()
      }
    }
  }

  func setExposureBias(_ bias: Double) throws {
    try withLockedDevice { device in
      let clamped = min(max(Float(bias), device.minExposureTargetBias), device.maxExposureTargetBias)
      device.setExposureTargetBias(clamped, completionHandler: nil)
    }
  }

  func setLensPosition(_ position: Double) throws {
    guard position.isFinite else { return }
    sessionQueue.sync {
      guard !self.cinematicActive else { return }
      // lensPosition non supporté sur le device virtuel : physique requis.
      self.manualFocusActive = true
      self.ensurePhysicalForManualLocked()
      guard let device = self.device,
            device.isLockingFocusWithCustomLensPositionSupported else { return }
      do {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        let clamped = min(max(Float(position), 0.0), 1.0)
        device.setFocusModeLocked(lensPosition: clamped, completionHandler: nil)
      } catch {}
    }
  }

  func setAutoFocus() throws {
    sessionQueue.sync {
      self.manualFocusActive = false
      if let device = self.device {
        do {
          try device.lockForConfiguration()
          defer { device.unlockForConfiguration() }
          if device.isFocusModeSupported(.continuousAutoFocus) {
            device.focusMode = .continuousAutoFocus
          }
        } catch {}
      }
      if !self.anyManualActive {
        self.restoreVirtualLocked()
      }
    }
  }

  func setWhiteBalance(kelvin: Double, tint: Double) throws {
    guard kelvin.isFinite, tint.isFinite else { return }
    sessionQueue.sync {
      guard !self.cinematicActive else { return }
      // Les gains de BdB verrouillés ne sont pas supportés sur le device
      // virtuel : physique requis.
      self.manualWbActive = true
      self.ensurePhysicalForManualLocked()
      guard let device = self.device else { return }
      do {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        let temperatureAndTint = AVCaptureDevice.WhiteBalanceTemperatureAndTintValues(
          temperature: Float(kelvin),
          tint: Float(tint)
        )
        var gains = device.deviceWhiteBalanceGains(for: temperatureAndTint)
        guard gains.redGain.isFinite, gains.greenGain.isFinite, gains.blueGain.isFinite else {
          return
        }
        let maxGain = device.maxWhiteBalanceGain
        gains.redGain = min(max(gains.redGain, 1.0), maxGain)
        gains.greenGain = min(max(gains.greenGain, 1.0), maxGain)
        gains.blueGain = min(max(gains.blueGain, 1.0), maxGain)
        device.setWhiteBalanceModeLocked(with: gains, completionHandler: nil)
      } catch {}
    }
  }

  func setAutoWhiteBalance() throws {
    sessionQueue.sync {
      self.manualWbActive = false
      if let device = self.device {
        do {
          try device.lockForConfiguration()
          defer { device.unlockForConfiguration() }
          if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) {
            device.whiteBalanceMode = .continuousAutoWhiteBalance
          }
        } catch {}
      }
      if !self.anyManualActive {
        self.restoreVirtualLocked()
      }
    }
  }

  func setZoom(_ factor: Double) throws {
    try withLockedDevice { device in
      let clamped = min(
        max(CGFloat(factor), device.minAvailableVideoZoomFactor),
        device.maxAvailableVideoZoomFactor
      )
      device.videoZoomFactor = clamped
    }
  }

  /// Point d'intérêt (coordonnées device, 0-1) : focus one-shot toujours,
  /// exposition seulement si l'utilisateur n'est pas en exposition manuelle.
  /// Asynchrone : appelé depuis le main thread au tap, et la sessionQueue
  /// peut être occupée plusieurs secondes pendant une pose (watchdog sinon).
  func setPointOfInterest(_ point: CGPoint) {
    sessionQueue.async {
      guard let device = self.device else { return }
      do {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        self.applyPointOfInterest(point, to: device)
      } catch {}
    }
  }

  private func applyPointOfInterest(_ point: CGPoint, to device: AVCaptureDevice) {
    if device.isFocusPointOfInterestSupported {
      device.focusPointOfInterest = point
      if device.isFocusModeSupported(.autoFocus) {
        device.focusMode = .autoFocus
      }
    }
    if device.isExposurePointOfInterestSupported, device.exposureMode != .custom {
      device.exposurePointOfInterest = point
      if device.isExposureModeSupported(.continuousAutoExposure) {
        device.exposureMode = .continuousAutoExposure
      }
    }
  }

  /// 0 = éteinte, sinon intensité 0-1.
  func setTorchLevel(_ level: Double) throws {
    try withLockedDevice { device in
      guard device.hasTorch else { return }
      if level <= 0 {
        device.torchMode = .off
      } else {
        try device.setTorchModeOn(level: Float(min(max(level, 0.01), 1.0)))
      }
    }
  }

  func setFlashMode(_ mode: String) {
    sessionQueue.async {
      switch mode {
      case "on": self.flashMode = .on
      case "auto": self.flashMode = .auto
      default: self.flashMode = .off
      }
    }
  }

  func setQualityPrioritization(_ mode: String) {
    sessionQueue.async {
      self.session.beginConfiguration()
      switch mode {
      case "speed": self.photoOutput.maxPhotoQualityPrioritization = .speed
      case "balanced": self.photoOutput.maxPhotoQualityPrioritization = .balanced
      default: self.photoOutput.maxPhotoQualityPrioritization = .quality
      }
      self.session.commitConfiguration()
    }
  }

  /// Définition photo en mégapixels ; 0 demande la plus grande disponible.
  func setPhotoResolution(_ megapixels: Double) {
    sessionQueue.async {
      self.photoMegapixels = megapixels.isFinite ? megapixels : 0
      guard let device = self.device else { return }
      self.session.beginConfiguration()
      self.applyResolutionPreference(for: device)
      self.session.commitConfiguration()
    }
  }

  func setLivePhotoEnabled(_ enabled: Bool) {
    sessionQueue.async {
      self.livePhotoEnabled = enabled
      self.session.beginConfiguration()
      if self.photoOutput.isLivePhotoCaptureSupported {
        self.photoOutput.isLivePhotoCaptureEnabled = enabled
      }
      self.session.commitConfiguration()
    }
  }

  func setDepthEnabled(_ enabled: Bool) {
    sessionQueue.async {
      self.depthEnabled = enabled
      self.session.beginConfiguration()
      if self.photoOutput.isDepthDataDeliverySupported {
        self.photoOutput.isDepthDataDeliveryEnabled = enabled
      }
      self.session.commitConfiguration()
    }
  }

  // MARK: - Aides de visée

  /// Aides demandées par l'utilisateur, mémorisées côté session pour décider
  /// si la sortie d'analyse a une raison de tourner.
  private var assistOptionsOn = false
  private var loupeOn = false

  func setAssistOptions(peaking: Bool, zebras: Bool, histogram: Bool) {
    processingQueue.async {
      self.processor.peakingEnabled = peaking
      self.processor.zebrasEnabled = zebras
      self.processor.histogramEnabled = histogram
    }
    sessionQueue.async {
      self.assistOptionsOn = peaking || zebras || histogram
      self.refreshAssistOutputLocked()
    }
  }

  func setLoupeEnabled(_ enabled: Bool) {
    processingQueue.async {
      self.processor.loupeEnabled = enabled
    }
    sessionQueue.async {
      self.loupeOn = enabled
      self.refreshAssistOutputLocked()
    }
  }

  /// La sortie d'analyse ne tourne que si quelqu'un la regarde, et jamais dans
  /// les modes vidéo lourds. Chaque sortie active consomme du budget matériel,
  /// et une session qui dépasse ce budget lâche en pleine prise.
  func refreshAssistOutputLocked() {
    let utilisee = assistOptionsOn || loupeOn
    let lourd = video.isActive
      && (video.request.frameRate >= 60 || video.request.wantsProRes || video.request.height >= 2160)
    setAssistOutputEnabled(utilisee && !lourd)
  }

  /// Types de codes lus dans la préview. Les types disponibles dépendent de la
  /// session : les demander avant de l'avoir configurée lève une exception.
  func restoreCodeScanningLocked() {
    guard session.outputs.contains(metadataOutput) else { return }
    let voulus: [AVMetadataObject.ObjectType] = [
      .qr, .aztec, .dataMatrix, .pdf417, .ean13, .ean8, .code128, .code39, .upce,
    ]
    metadataOutput.metadataObjectTypes = voulus.filter {
      metadataOutput.availableMetadataObjectTypes.contains($0)
    }
  }

  /// Rend tous les réglages à l'automatique et repasse sur le device virtuel.
  /// Le mode cinématique l'exige : il interdit le focus manuel et vit sur la
  /// caméra virtuelle, alors qu'un réglage manuel force la caméra physique.
  func releaseManualControlsLocked() {
    manualExposureActive = false
    manualFocusActive = false
    manualWbActive = false
    if let device {
      do {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        if device.isExposureModeSupported(.continuousAutoExposure) {
          device.exposureMode = .continuousAutoExposure
        }
        if device.isFocusModeSupported(.continuousAutoFocus) {
          device.focusMode = .continuousAutoFocus
        }
        if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) {
          device.whiteBalanceMode = .continuousAutoWhiteBalance
        }
      } catch {}
    }
    restoreVirtualLocked()
  }

  /// Vrai quand le flou cinématique est actif : tout réglage manuel est alors
  /// refusé par AVFoundation, on ne le tente même pas.
  var cinematicActive: Bool {
    guard #available(iOS 26.0, *), let videoInput else { return false }
    return videoInput.isCinematicVideoCaptureEnabled
  }

  /// Ajouter la sortie vidéo désactive Live Photo et peut désactiver la
  /// profondeur : en sortant du mode vidéo, on remet les préférences photo.
  /// À appeler entre `beginConfiguration` et `commitConfiguration`.
  func reapplyPhotoOutputOptions() {
    if photoOutput.isLivePhotoCaptureSupported {
      photoOutput.isLivePhotoCaptureEnabled = livePhotoEnabled
    }
    if photoOutput.isDepthDataDeliverySupported {
      photoOutput.isDepthDataDeliveryEnabled = depthEnabled
    }
  }

  /// Coupe l'analyse d'image (histogramme, peaking, zebras) quand la vidéo
  /// mange déjà tout le budget matériel. Au-delà, la session refuse de
  /// démarrer ou lâche des images en pleine prise.
  func setAssistOutputEnabled(_ enabled: Bool) {
    guard let connection = videoDataOutput.connection(with: .video) else { return }
    connection.isEnabled = enabled
  }

  // MARK: - Pose longue (empilement)

  /// Progression de la pose ({frame, total}), poussée vers JS.
  var onLongExposureProgress: (([String: Any]) -> Void)? {
    get { lues { _onLongExposureProgress } }
    set { callbackLock.lock(); _onLongExposureProgress = newValue; callbackLock.unlock() }
  }
  private var stackCancelled = false
  private var stackFramesDone = 0
  private var stackRunning = false

  func cancelLongExposure() {
    sessionQueue.async { self.stackCancelled = true }
  }

  /// Pose longue sans plafond : capture continue de trames à ~1 s d'exposition
  /// (le maximum matériel), empilées en moyenne (« lueur », nuit propre) et/ou
  /// en fusion max (« étoiles », garde les traînées de météores).
  private var poseStartDate = Date.distantPast
  /// Pose de nuit : trames RAW Bayer (linéaires, sans réduction de bruit qui
  /// mange les étoiles faibles) plutôt que HEIC 8 bits déjà traité.
  private var poseUsesRaw = false

  /// `manualExposure` : de nuit (réglages manuels), chaque trame est une vraie
  /// pose de ~1 s sur la caméra physique. De jour (exposition auto), on empile
  /// des trames auto courtes — c'est le rendu pose longue correct en pleine
  /// lumière (filé d'eau), forcer 1 s cramerait l'image.
  func startLongExposure(
    seconds: Double,
    iso: Double,
    mode: String,
    align: Bool,
    meteorFilter: Bool,
    manualExposure: Bool,
    completion: @escaping (Result<[String], Error>) -> Void
  ) {
    sessionQueue.async {
      guard self.session.isRunning, self.device != nil else {
        completion(.failure(CameraEngineError.notRunning))
        return
      }
      // Double déclenchement (bouton volume + écran) : une seule pose à la fois.
      guard !self.stackRunning else {
        completion(.failure(CameraEngineError.captureFailed("P30: a long exposure is already running")))
        return
      }
      self.stackRunning = true
      self.stackCancelled = false
      self.stackFramesDone = 0

      if manualExposure {
        // L'exposition .custom exige la caméra physique (le virtuel ne la
        // supporte pas — trames auto ultra-courtes et photos noires sinon).
        self.ensurePhysicalForManualLocked()
        guard let poseDevice = self.device else {
          self.stackRunning = false
          completion(.failure(CameraEngineError.notRunning))
          return
        }
        guard poseDevice.isExposureModeSupported(.custom) else {
          self.stackRunning = false
          completion(.failure(CameraEngineError.captureFailed("P33: custom exposure unsupported on this camera")))
          return
        }
        let bounds = self.exposureBounds(of: poseDevice)
        do {
          try poseDevice.lockForConfiguration()
          defer { poseDevice.unlockForConfiguration() }
          poseDevice.setExposureModeCustom(
            duration: CMTime(
              seconds: CameraMath.poseFrameSeconds(in: bounds),
              preferredTimescale: 1_000_000_000
            ),
            iso: CameraMath.clampIso(iso, in: bounds),
            completionHandler: nil
          )
        } catch {
          self.stackRunning = false
          completion(.failure(error))
          return
        }
      }

      self.poseUsesRaw = manualExposure && !self.photoOutput.availableRawPhotoPixelFormatTypes.isEmpty
      self.poseStartDate = Date()
      let stacker = FrameStacker(mode: mode, align: align, meteorFilter: meteorFilter)
      self.captureStackFrame(totalSeconds: seconds, stacker: stacker, completion: completion)
    }
  }

  private func captureStackFrame(
    totalSeconds: Double,
    stacker: FrameStacker,
    completion: @escaping (Result<[String], Error>) -> Void
  ) {
    // Boucle pilotée par le temps réel écoulé : la progression affichée est
    // honnête quelle que soit la cadence des trames (1 s en manuel de nuit,
    // rapide en auto de jour). Session interrompue (appel entrant,
    // arrière-plan) ou arrêtée : on termine proprement avec ce qui est déjà
    // empilé au lieu de déclencher sur une connexion inactive (NSException).
    let elapsed = Date().timeIntervalSince(poseStartDate)
    if elapsed >= totalSeconds || stackCancelled || !session.isRunning || session.isInterrupted
      || !sortiePhotoPrete {
      // Marqueur « assemblage » : frame == total, le JS affiche la bonne phase.
      onLongExposureProgress?(["frame": Int(totalSeconds), "total": Int(totalSeconds)])
      finishStack(stacker: stacker, completion: completion)
      return
    }

    let settings: AVCapturePhotoSettings
    let rawTypes = photoOutput.availableRawPhotoPixelFormatTypes
    if poseUsesRaw, !rawTypes.isEmpty {
      // Bayer RAW de préférence (fichiers moitié moins lourds que ProRAW),
      // en 12 MP (dimensions minimales) pour contenir la mémoire d'empilement.
      let bayerType = rawTypes.first { !AVCapturePhotoOutput.isAppleProRAWPixelFormat($0) } ?? rawTypes[0]
      settings = AVCapturePhotoSettings(rawPixelFormatType: bayerType)
      poserDimensions(
        CameraMath.smallestPhotoSize(available: definitionsDuFormatActif, cap: plafondVerifie()),
        sur: settings
      )
    } else if let format = hevcFormat() {
      settings = AVCapturePhotoSettings(format: format)
    } else {
      settings = AVCapturePhotoSettings()
    }
    settings.photoQualityPrioritization = .speed

    let captureId = settings.uniqueID
    let delegate = PhotoCaptureDelegate { [weak self] result in
      guard let self else { return }
      self.sessionQueue.async {
        self.inFlightCaptures.removeValue(forKey: captureId)
        if case .success(let uris) = result, let uri = uris.first, let url = URL(string: uri) {
          autoreleasepool {
            stacker.add(url: url)
          }
          try? FileManager.default.removeItem(at: url)
          self.stackFramesDone += 1
          let elapsedNow = min(Date().timeIntervalSince(self.poseStartDate), totalSeconds)
          self.onLongExposureProgress?(["frame": Int(elapsedNow), "total": Int(totalSeconds)])
        }
        // Frame ratée : on continue, l'empilement tolère les trous.
        self.captureStackFrame(totalSeconds: totalSeconds, stacker: stacker, completion: completion)
      }
    }
    inFlightCaptures[captureId] = delegate
    photoOutput.capturePhoto(with: settings, delegate: delegate)
  }

  private func finishStack(
    stacker: FrameStacker,
    completion: @escaping (Result<[String], Error>) -> Void
  ) {
    // Rendu final hors de la sessionQueue (peut prendre du temps), puis
    // retour en exposition auto.
    sessionQueue.async {
      self.stackRunning = false
      if let device = self.device {
        do {
          try device.lockForConfiguration()
          defer { device.unlockForConfiguration() }
          if device.isExposureModeSupported(.continuousAutoExposure) {
            device.exposureMode = .continuousAutoExposure
          }
        } catch {
          // Verrou refusé : on laisse l'exposition telle quelle plutôt que de
          // toucher un device non verrouillé.
        }
      }
      // Fin de pose : retour au device virtuel seulement si aucun réglage
      // manuel n'est resté actif (le JS réapplique le manuel sinon).
      if !self.anyManualActive {
        self.restoreVirtualLocked()
      }
    }
    DispatchQueue.global(qos: .userInitiated).async {
      completion(stacker.finalize())
    }
  }

  // MARK: - Capture

  func capturePhoto(
    raw: Bool,
    bracketStops: [Double],
    completion: @escaping (Result<[String], Error>) -> Void
  ) {
    sessionQueue.async {
      guard self.session.isRunning, self.sortiePhotoPrete else {
        completion(.failure(CameraEngineError.notRunning))
        return
      }

      // Le bracketing est interdit par AVFoundation en combinaison avec le
      // RAW différé, Live Photo et la profondeur : photo simple dans ces cas.
      let bracketAllowed = !raw
        && bracketStops.count >= 2
        && self.photoOutput.maxBracketedCapturePhotoCount >= bracketStops.count
        && !self.photoOutput.isLivePhotoCaptureEnabled
        && !self.photoOutput.isDepthDataDeliveryEnabled
      let settings: AVCapturePhotoSettings
      if bracketAllowed {
        settings = self.makeBracketSettings(stops: bracketStops)
      } else {
        settings = self.makePhotoSettings(raw: raw)
      }

      let captureId = settings.uniqueID
      let delegate = PhotoCaptureDelegate { [weak self] result in
        self?.sessionQueue.async {
          self?.inFlightCaptures.removeValue(forKey: captureId)
        }
        completion(result)
      }
      self.inFlightCaptures[captureId] = delegate
      self.photoOutput.capturePhoto(with: settings, delegate: delegate)
    }
  }

  private func hevcFormat() -> [String: Any]? {
    photoOutput.availablePhotoCodecTypes.contains(.hevc)
      ? [AVVideoCodecKey: AVVideoCodecType.hevc]
      : nil
  }

  private func makeBracketSettings(stops: [Double]) -> AVCapturePhotoBracketSettings {
    let bracketed = stops.map {
      AVCaptureAutoExposureBracketedStillImageSettings.autoExposureSettings(
        exposureTargetBias: Float($0)
      )
    }
    let settings: AVCapturePhotoBracketSettings
    if let format = hevcFormat() {
      settings = AVCapturePhotoBracketSettings(
        rawPixelFormatType: 0,
        processedFormat: format,
        bracketedSettings: bracketed
      )
    } else {
      settings = AVCapturePhotoBracketSettings(
        rawPixelFormatType: 0,
        processedFormat: nil,
        bracketedSettings: bracketed
      )
    }
    // Pas de maxPhotoDimensions ici : les brackets ne sont pas garantis en
    // haute résolution (servis en 12 MP en pratique, exception sinon).
    return settings
  }

  private func makePhotoSettings(raw: Bool) -> AVCapturePhotoSettings {
    let processedFormat = hevcFormat()

    let settings: AVCapturePhotoSettings
    let rawTypes = photoOutput.availableRawPhotoPixelFormatTypes
    if raw, !rawTypes.isEmpty {
      // Prefer ProRAW when the device offers it, otherwise Bayer RAW.
      let proRawType = rawTypes.first { AVCapturePhotoOutput.isAppleProRAWPixelFormat($0) }
      let rawType = proRawType ?? rawTypes[0]
      if let processedFormat {
        settings = AVCapturePhotoSettings(rawPixelFormatType: rawType, processedFormat: processedFormat)
      } else {
        settings = AVCapturePhotoSettings(rawPixelFormatType: rawType)
      }
    } else if let processedFormat {
      settings = AVCapturePhotoSettings(format: processedFormat)
    } else {
      settings = AVCapturePhotoSettings()
    }

    poserDimensions(
      CameraMath.usablePhotoSize(available: definitionsDuFormatActif, cap: plafondVerifie()),
      sur: settings
    )
    settings.photoQualityPrioritization = photoOutput.maxPhotoQualityPrioritization

    if let device, device.hasFlash, photoOutput.supportedFlashModes.contains(flashMode) {
      settings.flashMode = flashMode
    }
    // Live Photo et profondeur : incompatibles avec le RAW.
    if !raw, photoOutput.isLivePhotoCaptureEnabled {
      settings.livePhotoMovieFileURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("persei-live-\(UUID().uuidString).mov")
    }
    if !raw, photoOutput.isDepthDataDeliveryEnabled {
      settings.isDepthDataDeliveryEnabled = true
      settings.embedsDepthDataInPhoto = true
    }
    return settings
  }
}

extension CameraEngine: AVCaptureMetadataOutputObjectsDelegate {
  /// Un code reste dans le champ pendant des dizaines d'images : on ne le
  /// remonte qu'une fois, et de nouveau seulement après deux secondes.
  func metadataOutput(
    _ output: AVCaptureMetadataOutput,
    didOutput metadataObjects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    guard let onCodeDetected else { return }
    guard let readable = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject })
      .first(where: { ($0.stringValue?.isEmpty == false) }),
      let value = readable.stringValue
    else { return }

    let now = Date()
    if value == lastCodeValue, now.timeIntervalSince(lastCodeDate) < 2 { return }
    lastCodeValue = value
    lastCodeDate = now
    onCodeDetected(["value": value, "type": readable.type.rawValue])
  }
}

/// Collects every representation (RAW + processed + Live Photo movie) of a
/// single capture and resolves once the whole capture finishes.
private final class PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate {
  private let completion: (Result<[String], Error>) -> Void
  private var fileUris: [String] = []
  private var firstError: Error?

  init(completion: @escaping (Result<[String], Error>) -> Void) {
    self.completion = completion
  }

  func photoOutput(
    _ output: AVCapturePhotoOutput,
    didFinishProcessingPhoto photo: AVCapturePhoto,
    error: Error?
  ) {
    if let error {
      if firstError == nil { firstError = error }
      return
    }
    guard let data = photo.fileDataRepresentation() else {
      if firstError == nil {
        firstError = CameraEngineError.captureFailed("P20: empty photo data")
      }
      return
    }
    let fileExtension = photo.isRawPhoto ? "dng" : "heic"
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("persei-\(UUID().uuidString).\(fileExtension)")
    do {
      try data.write(to: url)
      fileUris.append(url.absoluteString)
    } catch {
      if firstError == nil { firstError = error }
    }
  }

  func photoOutput(
    _ output: AVCapturePhotoOutput,
    didFinishProcessingLivePhotoToMovieFileAt outputFileURL: URL,
    duration: CMTime,
    photoDisplayTime: CMTime,
    resolvedSettings: AVCaptureResolvedPhotoSettings,
    error: Error?
  ) {
    if let error {
      if firstError == nil { firstError = error }
      return
    }
    fileUris.append(outputFileURL.absoluteString)
  }

  func photoOutput(
    _ output: AVCapturePhotoOutput,
    didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings,
    error: Error?
  ) {
    if let error = firstError ?? error {
      completion(.failure(error))
    } else {
      completion(.success(fileUris))
    }
  }
}
