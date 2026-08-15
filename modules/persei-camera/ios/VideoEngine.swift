import AVFoundation
import Foundation

/// Codes d'erreur vidéo (suite des Pxx du moteur photo) :
/// P40 espace disque insuffisant, P41 session pas en mode vidéo,
/// P42 échec d'écriture, P43 enregistrement déjà en cours,
/// P44 micro indisponible, P45 format vidéo introuvable,
/// P46 enregistrement interrompu par le système.
enum VideoError {
  static func failure(_ code: String, _ message: String) -> CameraEngineError {
    .captureFailed("\(code): \(message)")
  }
}

/// Réglage vidéo courant et sortie fichier. Vit à côté de `CameraEngine`, qui
/// reste seul propriétaire de la session et de sa file d'exécution.
final class VideoState {
  let output = AVCaptureMovieFileOutput()
  var audioInput: AVCaptureDeviceInput?
  var request = VideoRequest(height: 1080, frameRate: 30, range: .sdr, wantsProRes: false)
  var codec = "hevc"
  var stabilization = "auto"
  var audioEnabled = true
  /// Réduction du bruit du vent (iOS 18), exige l'audio multicanal.
  var windNoiseRemoval = true
  /// Zoom audio (iOS 26.4) : le champ sonore suit le zoom de l'image.
  var audioZoom = true
  /// Flou d'arrière-plan cinématique (iOS 26).
  var cinematic = false
  /// Ouverture simulée du mode cinématique ; 0 laisse la valeur par défaut.
  var simulatedAperture: Double = 0
  var isActive = false
  var isRecording = false
  /// Sortie du mode vidéo demandée pendant un enregistrement : reprise à la
  /// fin de l'écriture.
  var pendingLeave = false
  /// Réponse à rendre une fois le démontage différé réellement fait.
  var onLeaveFinished: (() -> Void)?
  var delegate: MovieRecordingDelegate?
  var progressTimer: DispatchSourceTimer?
  /// Réglages photo restaurés en quittant la vidéo.
  var savedPhotoPreset: AVCaptureSession.Preset?
}

/// Rend le résultat d'un enregistrement. Détail qui coûte cher si on l'oublie :
/// AVFoundation passe une erreur non nulle même quand tout s'est bien terminé
/// (limite de durée ou de taille atteinte volontairement) ; seul le drapeau
/// `AVErrorRecordingSuccessfullyFinishedKey` dit la vérité.
final class MovieRecordingDelegate: NSObject, AVCaptureFileOutputRecordingDelegate {
  var onStart: ((URL) -> Void)?
  var onFinish: ((Result<URL, Error>) -> Void)?

  func fileOutput(
    _ output: AVCaptureFileOutput,
    didStartRecordingTo fileURL: URL,
    from connections: [AVCaptureConnection]
  ) {
    onStart?(fileURL)
  }

  func fileOutput(
    _ output: AVCaptureFileOutput,
    didFinishRecordingTo outputFileURL: URL,
    from connections: [AVCaptureConnection],
    error: Error?
  ) {
    let finishedCleanly =
      (error as NSError?)?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool ?? (error == nil)
    if finishedCleanly {
      onFinish?(.success(outputFileURL))
    } else {
      let reason = error?.localizedDescription ?? "unknown"
      onFinish?(.failure(VideoError.failure("P42", "recording failed (\(reason))")))
    }
  }
}

extension CameraEngine {
  // MARK: - Bascule photo ↔ vidéo

  /// Passe la session en mode vidéo (ou revient en photo). La vidéo impose le
  /// choix explicite du format : `sessionPreset` et `activeFormat` sont
  /// exclusifs, poser un preset après coup reprend la main sur le format et
  /// donne l'écran noir bien connu en 4K120.
  func setVideoMode(_ enabled: Bool, completion: @escaping (Result<[String: Any], Error>) -> Void) {
    sessionQueue.async {
      guard self.device != nil else {
        completion(.failure(CameraEngineError.notRunning))
        return
      }
      if enabled == self.video.isActive {
        completion(.success(self.videoCapabilities()))
        return
      }
      if enabled {
        self.enterVideoModeLocked()
        completion(.success(self.videoCapabilities()))
        return
      }

      self.leaveVideoModeLocked()
      // Le démontage est différé quand un enregistrement était en cours : la
      // sortie film ne peut pas disparaître sous un fichier qu'on est en train
      // d'écrire. Répondre tout de suite annonçait le mode photo alors que la
      // session était encore en vidéo — l'écran basculait sur un état faux. On
      // attend la fin de l'écriture pour répondre.
      if self.video.pendingLeave {
        self.video.onLeaveFinished = { [weak self] in
          guard let self else { return }
          completion(.success(self.videoCapabilities()))
        }
        return
      }
      completion(.success(self.videoCapabilities()))
    }
  }

  private func enterVideoModeLocked() {
    session.beginConfiguration()
    video.savedPhotoPreset = session.sessionPreset

    if !session.outputs.contains(video.output), session.canAddOutput(video.output) {
      session.addOutput(video.output)
    }
    // La session choisit seule le micro qui correspond à la caméra active,
    // exactement comme l'app Camera : on ne touche pas à la session audio.
    session.automaticallyConfiguresApplicationAudioSession = true
    if video.audioEnabled { addAudioInputLocked() }
    // On fixe nous-mêmes l'espace colorimétrique (HDR, Log) : sans ça la
    // session le réécrit à chaque reconfiguration.
    session.automaticallyConfiguresCaptureDeviceForWideColor = false
    session.commitConfiguration()
    // Ajouter la sortie film change la liste des types de codes lisibles. Ce
    // filtrage doit se faire une fois la configuration validée : pendant, la
    // liste disponible est encore celle d'avant.
    restoreCodeScanningLocked()

    video.isActive = true
    applyVideoFormatLocked()
  }

  private func leaveVideoModeLocked() {
    // Retirer la sortie film avant que le fichier soit finalisé le tronque :
    // on arrête, on rend la main, et le démontage se refait à la fin.
    if video.isRecording {
      video.pendingLeave = true
      video.output.stopRecording()
      return
    }
    video.pendingLeave = false
    stopProgressTimerLocked()

    session.beginConfiguration()
    if session.outputs.contains(video.output) {
      session.removeOutput(video.output)
    }
    removeAudioInputLocked()
    session.automaticallyConfiguresCaptureDeviceForWideColor = true
    // On ne touche PAS à l'espace colorimétrique ici : le format encore actif
    // est celui de la vidéo, et un format 10 bits n'accepte souvent que le
    // HLG. Lui imposer sRGB fait lever AVFoundation depuis sa file interne,
    // ce qui tue l'app instantanément et sans message. Le retour au preset
    // photo rétablit l'espace tout seul, et on le confirme après le commit.
    let zoomAvant = device?.videoZoomFactor
    session.sessionPreset = video.savedPhotoPreset ?? .photo
    if let device {
      if let zoomAvant {
        do {
          try device.lockForConfiguration()
          defer { device.unlockForConfiguration() }
          device.videoZoomFactor = min(
            max(zoomAvant, device.minAvailableVideoZoomFactor),
            device.maxAvailableVideoZoomFactor
          )
        } catch {}
      }
    }
    reapplyPhotoOutputOptions()
    session.commitConfiguration()

    // Après le commit seulement. Le preset ne rebascule le format du device
    // qu'à cet instant : tout ce qui dépend du format actif et qu'on lirait
    // plus tôt appartiendrait encore à la vidéo.
    if let device {
      // C'est le seul moment où demander sRGB a un sens, et seulement s'il
      // l'accepte.
      appliquerEspace(.sRGB, sur: device)
      // Les définitions photo aussi : calculées trop tôt, elles gardaient
      // celles du format vidéo, absentes du format photo, et la première
      // photo prise après un retour de vidéo levait une exception.
      applyResolutionPreference(for: device)
    }

    video.isActive = false
    refreshAssistOutputLocked()
    video.savedPhotoPreset = nil
  }

  /// Change l'espace colorimétrique seulement si le format actif le supporte.
  /// AVFoundation refuse tout le reste par une exception, jamais par un retour
  /// d'erreur : c'est la cause du plantage silencieux du 14 août.
  private func appliquerEspace(_ espace: AVCaptureColorSpace, sur device: AVCaptureDevice) {
    guard device.activeColorSpace != espace,
          device.activeFormat.supportedColorSpaces.contains(espace)
    else { return }
    do {
      try device.lockForConfiguration()
      defer { device.unlockForConfiguration() }
      device.activeColorSpace = espace
    } catch {}
  }

  private func addAudioInputLocked() {
    guard video.audioInput == nil,
          let microphone = AVCaptureDevice.default(for: .audio),
          let input = try? AVCaptureDeviceInput(device: microphone),
          session.canAddInput(input)
    else { return }
    session.addInput(input)
    video.audioInput = input
    applyAudioOptionsLocked()
  }

  private func removeAudioInputLocked() {
    guard let input = video.audioInput else { return }
    session.removeInput(input)
    video.audioInput = nil
  }

  // MARK: - Réglages vidéo

  func configureVideo(
    height: Int,
    frameRate: Double,
    range: String,
    codec: String,
    stabilization: String,
    audioEnabled: Bool,
    windNoiseRemoval: Bool,
    cinematic: Bool,
    simulatedAperture: Double,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    sessionQueue.async {
      guard !self.video.isRecording else {
        completion(.failure(VideoError.failure("P43", "cannot change settings while recording")))
        return
      }
      let wantsProRes = codec == "prores"
      self.video.request = VideoRequest(
        height: height,
        frameRate: frameRate,
        range: VideoRange(rawValue: range) ?? .sdr,
        wantsProRes: wantsProRes,
        wantsCinematic: cinematic
      )
      self.video.codec = codec
      self.video.stabilization = stabilization
      self.video.windNoiseRemoval = windNoiseRemoval
      self.video.cinematic = cinematic
      self.video.simulatedAperture = simulatedAperture

      // Le mode cinématique impose l'autofocus continu et interdit tout
      // réglage manuel : on rend la main au tout-auto avant de l'activer,
      // sinon AVFoundation lève une exception au premier réglage.
      if cinematic {
        self.releaseManualControlsLocked()
      }

      if audioEnabled != self.video.audioEnabled {
        self.video.audioEnabled = audioEnabled
        if self.video.isActive {
          self.session.beginConfiguration()
          if audioEnabled { self.addAudioInputLocked() } else { self.removeAudioInputLocked() }
          self.session.commitConfiguration()
        }
      }

      guard self.video.isActive else {
        completion(.success(self.videoCapabilities()))
        return
      }
      if self.applyVideoFormatLocked() {
        completion(.success(self.videoCapabilities()))
      } else {
        completion(.failure(VideoError.failure("P45", "no format for this resolution and frame rate")))
      }
    }
  }

  /// Applique le format demandé au device. Renvoie false si le matériel ne
  /// sait pas le faire, auquel cas rien n'est modifié.
  @discardableResult
  func applyVideoFormatLocked() -> Bool {
    guard let device else { return false }
    let specs = device.formats.map(videoSpec(of:))
    guard let index = CameraMath.pickVideoFormat(specs, request: video.request),
          device.formats.indices.contains(index)
    else { return false }
    let format = device.formats[index]

    // Poser un format remet le zoom à 1,0, c'est-à-dire l'ultra grand-angle sur
    // un device virtuel : le cadrage sautait au 0,5× en entrant en vidéo.
    let zoomAvant = device.videoZoomFactor

    session.beginConfiguration()
    do {
      try device.lockForConfiguration()
      defer { device.unlockForConfiguration() }

      if #available(iOS 18.0, *) {
        // Le réglage de cadence lève une exception tant que la cadence
        // automatique est active.
        if device.isAutoVideoFrameRateEnabled {
          device.isAutoVideoFrameRateEnabled = false
        }
      }
      device.activeFormat = format

      // Timescale précis : 23,976 ou 29,97 arrondis à 24 ou 30 sortiraient
      // des bornes du format et feraient lever une exception.
      let duration = CMTime(
        value: 1_000_000,
        timescale: CMTimeScale((video.request.frameRate * 1_000_000).rounded())
      )
      if format.videoSupportedFrameRateRanges.contains(where: {
        $0.minFrameRate <= video.request.frameRate && video.request.frameRate <= $0.maxFrameRate
      }) {
        device.activeVideoMinFrameDuration = duration
        device.activeVideoMaxFrameDuration = duration
      }

      // Le format qu'on vient de poser fait foi, mais on interroge le device
      // plutôt que l'objet local : c'est lui qui lève l'exception.
      let wanted = colorSpace(for: video.request.range)
      if device.activeColorSpace != wanted,
         device.activeFormat.supportedColorSpaces.contains(wanted) {
        device.activeColorSpace = wanted
      }

      device.videoZoomFactor = min(
        max(zoomAvant, device.minAvailableVideoZoomFactor),
        device.maxAvailableVideoZoomFactor
      )
    } catch {
      session.commitConfiguration()
      return false
    }
    // Activer le cinématique reconfigure tout le pipeline : Apple demande que
    // ça se fasse dans le même bloc de configuration, sinon la préview gèle.
    applyCinematicLocked()
    applyAudioOptionsLocked()
    session.commitConfiguration()

    // Le format vidéo change les définitions photo disponibles : sans cette
    // remise à jour, prendre une photo pendant la vidéo lève une exception.
    // Après le commit, comme partout ailleurs : une seule règle à retenir.
    applyResolutionPreference(for: device)
    applyStabilizationLocked()
    applyCodecLocked()
    applyRotationLocked()
    refreshAssistOutputLocked()
    return true
  }

  private func colorSpace(for range: VideoRange) -> AVCaptureColorSpace {
    switch range {
    case .sdr: return .sRGB
    case .hdr: return .HLG_BT2020
    case .log:
      if #available(iOS 17.0, *) { return .appleLog }
      return .HLG_BT2020
    }
  }

  private func videoSpec(of format: AVCaptureDevice.Format) -> VideoFormatSpec {
    let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
    let subType = CMFormatDescriptionGetMediaSubType(format.formatDescription)
    let tenBit = subType == kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange
      || subType == kCVPixelFormatType_420YpCbCr10BiPlanarFullRange
    let proResSource = subType == kCVPixelFormatType_422YpCbCr10BiPlanarVideoRange
      || subType == kCVPixelFormatType_422YpCbCr10BiPlanarFullRange
    var supportsLog = false
    if #available(iOS 17.0, *) {
      supportsLog = format.supportedColorSpaces.contains(.appleLog)
    }
    var supportsCinematic = false
    if #available(iOS 26.0, *) {
      supportsCinematic = format.isCinematicVideoCaptureSupported
    }
    return VideoFormatSpec(
      width: Int(dimensions.width),
      height: Int(dimensions.height),
      frameRateRanges: format.videoSupportedFrameRateRanges.map {
        FrameRateRange(min: $0.minFrameRate, max: $0.maxFrameRate)
      },
      isTenBit: tenBit,
      isProResSource: proResSource,
      supportsAppleLog: supportsLog,
      supportsHlg: format.supportedColorSpaces.contains(.HLG_BT2020),
      isBinned: format.isVideoBinned,
      maxPhotoWidth: Int(format.supportedMaxPhotoDimensions.last?.width ?? 0),
      supportsCinematic: supportsCinematic
    )
  }

  /// Flou d'arrière-plan cinématique (iOS 26). Le mode vit sur l'entrée, pas
  /// sur la sortie, et impose ses conditions : autofocus continu obligatoire,
  /// types de métadonnées imposés, ouverture fixée dans les bornes du format.
  /// Sortir de ces clous lève une exception, donc chaque étape est gardée.
  private func applyCinematicLocked() {
    guard #available(iOS 26.0, *), let input = videoInput else { return }
    let format = input.device.activeFormat
    let voulu = video.cinematic && input.isCinematicVideoCaptureSupported
      && format.isCinematicVideoCaptureSupported

    if input.isCinematicVideoCaptureEnabled != voulu {
      input.isCinematicVideoCaptureEnabled = voulu
    }
    guard voulu else {
      // Retour aux codes QR après le commit, pas pendant.
      sessionQueue.async { self.restoreCodeScanningLocked() }
      return
    }

    // Le mode exige exactement ces types de métadonnées : la lecture des
    // codes QR laisse la place le temps du cinématique.
    metadataOutput.metadataObjectTypes =
      metadataOutput.requiredMetadataObjectTypesForCinematicVideoCapture

    let minimum = format.minSimulatedAperture
    let maximum = format.maxSimulatedAperture
    if minimum > 0, maximum >= minimum {
      let demande = video.simulatedAperture > 0
        ? Float(video.simulatedAperture)
        : format.defaultSimulatedAperture
      input.simulatedAperture = min(max(demande, minimum), maximum)
    }
  }

  /// Micro : stéréo quand le matériel sait le faire (c'est ce que fait l'app
  /// Camera), réduction du bruit du vent — qui exige justement le multicanal —
  /// et zoom audio suivant le zoom de l'image.
  private func applyAudioOptionsLocked() {
    guard let audio = video.audioInput else { return }
    if #available(iOS 18.0, *) {
      if audio.isMultichannelAudioModeSupported(.stereo) {
        audio.multichannelAudioMode = .stereo
      }
      if audio.isWindNoiseRemovalSupported {
        audio.isWindNoiseRemovalEnabled = video.windNoiseRemoval
      }
    }
    if #available(iOS 26.4, *) {
      if audio.isAudioZoomSupported {
        audio.isAudioZoomEnabled = video.audioZoom
      }
    }
  }

  private func applyStabilizationLocked() {
    guard let connection = video.output.connection(with: .video), let device else { return }
    let format = device.activeFormat
    let wanted: AVCaptureVideoStabilizationMode
    switch video.stabilization {
    case "off": wanted = .off
    case "standard": wanted = .standard
    case "cinematic": wanted = .cinematic
    case "cinematicExtended":
      if #available(iOS 18.0, *), format.isVideoStabilizationModeSupported(.cinematicExtendedEnhanced) {
        wanted = .cinematicExtendedEnhanced
      } else {
        wanted = .cinematicExtended
      }
    case "lowLatency":
      if #available(iOS 26.0, *), format.isVideoStabilizationModeSupported(.lowLatency) {
        wanted = .lowLatency
      } else {
        wanted = .standard
      }
    default: wanted = .auto
    }
    if wanted == .auto || format.isVideoStabilizationModeSupported(wanted) {
      connection.preferredVideoStabilizationMode = wanted
    } else {
      connection.preferredVideoStabilizationMode = .auto
    }
  }

  /// Le codec ne peut être choisi qu'après avoir posé le format : la liste des
  /// codecs disponibles en dépend (ProRes n'apparaît qu'avec une source 4:2:2).
  private func applyCodecLocked() {
    guard let connection = video.output.connection(with: .video) else { return }
    let available = video.output.availableVideoCodecTypes
    let wanted: AVVideoCodecType
    switch video.codec {
    case "h264": wanted = .h264
    case "prores": wanted = .proRes422HQ
    default: wanted = .hevc
    }
    let chosen: AVVideoCodecType
    if available.contains(wanted) {
      chosen = wanted
    } else if video.codec == "prores", available.contains(.proRes422) {
      chosen = .proRes422
    } else if available.contains(.hevc) {
      chosen = .hevc
    } else {
      return
    }
    video.output.setOutputSettings([AVVideoCodecKey: chosen], for: connection)
  }

  /// L'angle est lu sur le coordinateur de rotation d'iOS 17 : filmer en
  /// tenant le téléphone couché doit donner une vidéo à l'endroit, même si
  /// l'interface reste verrouillée en portrait.
  private func applyRotationLocked() {
    guard let connection = video.output.connection(with: .video) else { return }
    if #available(iOS 17.0, *) {
      let angle = rotationCoordinator?.videoRotationAngleForHorizonLevelCapture ?? 90
      if connection.isVideoRotationAngleSupported(angle) {
        connection.videoRotationAngle = angle
      }
    } else if connection.isVideoOrientationSupported {
      connection.videoOrientation = .portrait
    }
    if let device, device.position == .front {
      connection.automaticallyAdjustsVideoMirroring = false
      connection.isVideoMirrored = true
    }
  }

  // MARK: - Enregistrement

  func startRecording(completion: @escaping (Result<Void, Error>) -> Void) {
    sessionQueue.async {
      guard self.session.isRunning, !self.session.isInterrupted else {
        completion(.failure(CameraEngineError.notRunning))
        return
      }
      guard self.video.isActive else {
        completion(.failure(VideoError.failure("P41", "camera is not in video mode")))
        return
      }
      guard !self.video.isRecording else {
        completion(.failure(VideoError.failure("P43", "a recording is already running")))
        return
      }
      let needed = CameraMath.requiredFreeBytes(forProRes: self.video.request.wantsProRes)
      if let free = self.freeDiskBytes(), free < needed {
        completion(.failure(VideoError.failure(
          "P40",
          "not enough free space (\(free / 1_000_000) MB available, \(needed / 1_000_000) MB needed)"
        )))
        return
      }

      // Coupe l'enregistrement avant que le disque soit plein : un fichier
      // tronqué par manque de place est souvent illisible.
      self.video.output.minFreeDiskSpaceLimit = 200_000_000
      self.applyRotationLocked()

      let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("persei-video-\(UUID().uuidString).mov")
      let delegate = MovieRecordingDelegate()
      self.pendingStartCompletion = completion
      delegate.onStart = { [weak self] _ in
        self?.sessionQueue.async {
          guard let self else { return }
          self.video.isRecording = true
          self.startProgressTimerLocked()
          self.pendingStartCompletion?(.success(()))
          self.pendingStartCompletion = nil
        }
      }
      delegate.onFinish = { [weak self] result in
        self?.finishRecording(result)
      }
      self.video.delegate = delegate
      self.video.output.startRecording(to: url, recordingDelegate: delegate)

      // Si le fichier ne démarre jamais (connexion inactive, format refusé),
      // la promesse resterait pendante et le bouton bloqué : on tranche.
      self.sessionQueue.asyncAfter(deadline: .now() + 3) {
        guard let pending = self.pendingStartCompletion else { return }
        self.pendingStartCompletion = nil
        self.video.output.stopRecording()
        pending(.failure(VideoError.failure("P42", "recording did not start")))
      }
    }
  }

  /// Rend l'URI du fichier. La promesse est tenue par `stopRecording`, mais un
  /// arrêt subi (disque plein, surchauffe, appel entrant) passe par le même
  /// chemin et prévient le JS par un événement.
  func stopRecording(completion: @escaping (Result<String, Error>) -> Void) {
    sessionQueue.async {
      guard self.video.isRecording else {
        completion(.failure(VideoError.failure("P41", "no recording in progress")))
        return
      }
      self.pendingStopCompletion = completion
      self.video.output.stopRecording()
    }
  }

  private func finishRecording(_ result: Result<URL, Error>) {
    sessionQueue.async {
      self.video.isRecording = false
      self.stopProgressTimerLocked()
      self.video.delegate = nil
      // Enregistrement terminé avant même d'avoir commencé : on libère la
      // promesse de départ, sinon le bouton reste bloqué.
      if let start = self.pendingStartCompletion {
        self.pendingStartCompletion = nil
        start(.failure(VideoError.failure("P42", "recording ended before it started")))
      }

      let completion = self.pendingStopCompletion
      self.pendingStopCompletion = nil
      switch result {
      case .success(let url):
        if let completion {
          completion(.success(url.absoluteString))
        } else {
          // Arrêt non demandé : le JS n'attend aucune promesse, on le prévient.
          self.onRecordingStopped?(["uri": url.absoluteString, "reason": self.stopReason ?? "system"])
        }
      case .failure(let error):
        if let completion {
          completion(.failure(error))
        } else {
          self.onRecordingStopped?([
            "uri": "",
            "reason": self.stopReason ?? "error",
            "error": error.localizedDescription,
          ])
        }
      }
      self.stopReason = nil
      if self.video.pendingLeave {
        self.video.pendingLeave = false
        self.leaveVideoModeAfterRecording()
      }
    }
  }

  /// Démontage différé : la sortie film n'est retirée qu'une fois le fichier
  /// écrit.
  private func leaveVideoModeAfterRecording() {
    defer {
      // La demande de sortie attend cette réponse depuis l'arrêt de
      // l'enregistrement : c'est maintenant, et seulement maintenant, que la
      // session est réellement revenue en photo.
      let repondre = video.onLeaveFinished
      video.onLeaveFinished = nil
      repondre?()
    }
    guard video.isActive else { return }
    leaveVideoModeLocked()
  }

  /// Arrêt provoqué par le système : on sauve ce qui est déjà écrit.
  func stopRecordingBecause(_ reason: String) {
    sessionQueue.async {
      guard self.video.isRecording else { return }
      self.stopReason = reason
      self.video.output.stopRecording()
    }
  }

  @available(iOS 18.0, *)
  func pauseRecording() {
    sessionQueue.async {
      guard self.video.isRecording, !self.video.output.isRecordingPaused else { return }
      self.video.output.pauseRecording()
    }
  }

  @available(iOS 18.0, *)
  func resumeRecording() {
    sessionQueue.async {
      guard self.video.isRecording, self.video.output.isRecordingPaused else { return }
      self.video.output.resumeRecording()
    }
  }

  // MARK: - Progression et garde-fous

  private func startProgressTimerLocked() {
    stopProgressTimerLocked()
    let timer = DispatchSource.makeTimerSource(queue: sessionQueue)
    timer.schedule(deadline: .now() + 0.5, repeating: 0.5)
    timer.setEventHandler { [weak self] in
      guard let self, self.video.isRecording else { return }
      let paused: Bool
      if #available(iOS 18.0, *) {
        paused = self.video.output.isRecordingPaused
      } else {
        paused = false
      }
      self.onRecordingProgress?([
        "seconds": self.video.output.recordedDuration.seconds,
        "bytes": Double(self.video.output.recordedFileSize),
        "paused": paused,
      ])
    }
    timer.resume()
    video.progressTimer = timer
  }

  private func stopProgressTimerLocked() {
    video.progressTimer?.cancel()
    video.progressTimer = nil
  }

  func freeDiskBytes() -> Int64? {
    let url = FileManager.default.temporaryDirectory
    let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
    return values?.volumeAvailableCapacityForImportantUsage
  }

  // MARK: - Capacités

  /// Bornes d'ouverture simulée du format actif, vides hors cinématique.
  private func apertureRange(of device: AVCaptureDevice) -> [Double] {
    guard #available(iOS 26.0, *) else { return [] }
    let format = device.activeFormat
    guard format.isCinematicVideoCaptureSupported, format.minSimulatedAperture > 0 else { return [] }
    return [
      Double(format.minSimulatedAperture),
      Double(format.maxSimulatedAperture),
      Double(format.defaultSimulatedAperture),
    ]
  }

  func videoCapabilities() -> [String: Any] {
    guard let device else { return [:] }
    let specs = device.formats.map(videoSpec(of:))
    let heights = CameraMath.availableHeights(specs)
    var frameRates: [String: [Double]] = [:]
    for height in heights {
      frameRates["\(height)"] = CameraMath.availableFrameRates(specs, height: height)
    }

    var stabilizations = ["off", "auto"]
    let format = device.activeFormat
    if format.isVideoStabilizationModeSupported(.standard) { stabilizations.append("standard") }
    if format.isVideoStabilizationModeSupported(.cinematic) { stabilizations.append("cinematic") }
    if format.isVideoStabilizationModeSupported(.cinematicExtended) {
      stabilizations.append("cinematicExtended")
    }
    if #available(iOS 26.0, *), format.isVideoStabilizationModeSupported(.lowLatency) {
      stabilizations.append("lowLatency")
    }

    var supportsPause = false
    if #available(iOS 18.0, *) { supportsPause = true }

    return [
      "heights": heights,
      "frameRates": frameRates,
      "supportsHdr": specs.contains { $0.isTenBit && $0.supportsHlg },
      "supportsLog": specs.contains(where: \.supportsAppleLog),
      "supportsProRes": specs.contains(where: \.isProResSource),
      "stabilizations": stabilizations,
      "supportsPause": supportsPause,
      "hasMicrophone": AVCaptureDevice.default(for: .audio) != nil,
      "isRecording": video.isRecording,
      "freeBytes": Double(freeDiskBytes() ?? 0),
      "supportsCinematic": specs.contains(where: \.supportsCinematic),
      "cinematicFrameRates": Dictionary(
        uniqueKeysWithValues: heights.map { hauteur in
          ("\(hauteur)", CameraMath.cinematicFrameRates(specs, height: hauteur))
        }
      ),
      "apertureRange": apertureRange(of: device),
      "isCinematic": cinematicActive,
      // Ce qui est réellement servi, à comparer avec ce qui a été demandé.
      // Les replis se faisaient en silence : on pouvait filmer en HLG avec
      // « Log » affiché, en HEVC avec « ProRes » affiché, en 10 bits avec
      // « Standard » affiché. L'interface a maintenant de quoi le dire.
      "applied": appliedVideoState(of: device),
    ]
  }

  /// État vidéo réel, lu sur le matériel et sur la sortie film.
  private func appliedVideoState(of device: AVCaptureDevice) -> [String: Any] {
    let format = device.activeFormat
    let description = format.formatDescription
    let dimensions = CMVideoFormatDescriptionGetDimensions(description)
    let codec: String
    if let connection = video.output.connection(with: .video),
       let reglages = video.output.outputSettings(for: connection),
       let type = reglages[AVVideoCodecKey] as? String {
      switch AVVideoCodecType(rawValue: type) {
      case .h264: codec = "h264"
      case .hevc: codec = "hevc"
      case .proRes422, .proRes422HQ, .proRes422LT, .proRes422Proxy, .proRes4444: codec = "prores"
      default: codec = type
      }
    } else {
      codec = "hevc"
    }
    let range: String
    switch device.activeColorSpace {
    case .appleLog: range = "log"
    case .HLG_BT2020: range = "hdr"
    default: range = "sdr"
    }
    return [
      "height": Int(dimensions.height),
      "frameRate": 1.0 / max(device.activeVideoMinFrameDuration.seconds, 1e-9),
      "range": range,
      "codec": codec,
      "isTenBit": videoSpec(of: format).isTenBit,
    ]
  }
}
