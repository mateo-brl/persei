// swift-tools-version:5.9
import PackageDescription

// Harnais de test du moteur d'empilement. La CI copie
// modules/persei-camera/ios/FrameStacker.swift dans Sources/ avant
// `swift test` : une seule source de vérité, testée sur macOS.
let package = Package(
  name: "PerseiStack",
  platforms: [.macOS(.v13)],
  targets: [
    .target(name: "PerseiStack", path: "Sources"),
    .testTarget(name: "PerseiStackTests", dependencies: ["PerseiStack"], path: "Tests"),
  ]
)
