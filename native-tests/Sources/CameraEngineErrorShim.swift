import Foundation

// Doublure de l'enum défini dans CameraEngine.swift (non copié dans le
// package de test) : FrameStacker n'utilise que ce symbole.
enum CameraEngineError: Error {
  case deviceUnavailable
  case notRunning
  case captureFailed(String)
}
