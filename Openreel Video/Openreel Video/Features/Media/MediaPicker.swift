import AVFoundation
import Foundation
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct MediaPicker: UIViewControllerRepresentable {
    var selectionLimit: Int = 0
    var onCancel: () -> Void
    var onPick: ([ImportedMediaAsset]) -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.filter = .any(of: [.videos, .images, .livePhotos])
        configuration.selectionLimit = selectionLimit
        configuration.preferredAssetRepresentationMode = .current
        configuration.selection = .ordered

        let controller = PHPickerViewController(configuration: configuration)
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onCancel: onCancel, onPick: onPick)
    }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        private let onCancel: () -> Void
        private let onPick: ([ImportedMediaAsset]) -> Void

        init(onCancel: @escaping () -> Void, onPick: @escaping ([ImportedMediaAsset]) -> Void) {
            self.onCancel = onCancel
            self.onPick = onPick
        }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            picker.dismiss(animated: true)

            guard !results.isEmpty else {
                onCancel()
                return
            }

            Task {
                var importedAssets: [ImportedMediaAsset] = []

                for result in results {
                    guard let asset = try? await loadAsset(from: result) else {
                        continue
                    }
                    importedAssets.append(asset)
                }

                await MainActor.run {
                    if importedAssets.isEmpty {
                        onCancel()
                    } else {
                        onPick(importedAssets)
                    }
                }
            }
        }

        private func loadAsset(from result: PHPickerResult) async throws -> ImportedMediaAsset {
            let provider = result.itemProvider

            if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
                return try await loadFileAsset(from: provider, typeIdentifier: UTType.movie.identifier, mediaType: .video)
            } else if provider.hasItemConformingToTypeIdentifier(UTType.video.identifier) {
                return try await loadFileAsset(from: provider, typeIdentifier: UTType.video.identifier, mediaType: .video)
            } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                return try await loadFileAsset(from: provider, typeIdentifier: UTType.image.identifier, mediaType: .image)
            } else if provider.hasItemConformingToTypeIdentifier(UTType.audio.identifier) {
                return try await loadFileAsset(from: provider, typeIdentifier: UTType.audio.identifier, mediaType: .audio)
            }

            throw MediaPickerError.unsupportedType
        }

        private func loadFileAsset(
            from provider: NSItemProvider,
            typeIdentifier: String,
            mediaType: ImportedMediaType
        ) async throws -> ImportedMediaAsset {
            let tempURL = try await provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier)
            let suggestedName = provider.suggestedName ?? tempURL.lastPathComponent
            let fileName = Self.fileNameWithExtension(suggestedName, fallbackURL: tempURL, typeIdentifier: typeIdentifier)

            return ImportedMediaAsset(
                sourceURL: tempURL,
                fileName: fileName,
                assetIdentifier: provider.suggestedName,
                mediaType: mediaType
            )
        }

        private static func fileNameWithExtension(
            _ suggestedName: String,
            fallbackURL: URL,
            typeIdentifier: String
        ) -> String {
            let nameURL = URL(fileURLWithPath: suggestedName)
            if !nameURL.pathExtension.isEmpty {
                return suggestedName
            }

            let fallbackExtension = fallbackURL.pathExtension
            if !fallbackExtension.isEmpty {
                return suggestedName + "." + fallbackExtension
            }

            if let type = UTType(typeIdentifier),
               let preferredExtension = type.preferredFilenameExtension {
                return suggestedName + "." + preferredExtension
            }

            return suggestedName
        }
    }
}

enum MediaPickerError: LocalizedError {
    case unsupportedType

    var errorDescription: String? {
        switch self {
        case .unsupportedType:
            return "The selected file type is not supported."
        }
    }
}

private extension NSItemProvider {
    func loadFileRepresentation(forTypeIdentifier typeIdentifier: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            _ = loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let url else {
                    continuation.resume(throwing: CocoaError(.fileNoSuchFile))
                    return
                }

                let tempDirectory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
                let copiedURL = tempDirectory
                    .appendingPathComponent(UUID().uuidString, isDirectory: false)
                    .appendingPathExtension(url.pathExtension)

                do {
                    try FileManager.default.copyItem(at: url, to: copiedURL)
                    continuation.resume(returning: copiedURL)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
}
