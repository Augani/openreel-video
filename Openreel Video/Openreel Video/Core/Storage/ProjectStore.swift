import Foundation

actor ProjectStore {
    enum StoreError: LocalizedError {
        case applicationSupportUnavailable
        case projectNotFound

        var errorDescription: String? {
            switch self {
            case .applicationSupportUnavailable:
                return "The app support directory is unavailable."
            case .projectNotFound:
                return "The selected project could not be found."
            }
        }
    }

    private let fileManager: FileManager
    nonisolated private let baseURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(fileManager: FileManager = .default, baseURL: URL? = nil) {
        self.fileManager = fileManager
        if let baseURL {
            self.baseURL = baseURL
        } else {
            let appSupportURL = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            self.baseURL = (appSupportURL ?? URL(fileURLWithPath: NSTemporaryDirectory()))
                .appendingPathComponent("OpenReel", isDirectory: true)
                .appendingPathComponent("Projects", isDirectory: true)
        }

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        self.encoder = encoder
        self.decoder = JSONDecoder()
    }

    func loadProjects() throws -> [OpenReelProject] {
        try ensureBaseDirectories()

        let projectDirectories = try fileManager.contentsOfDirectory(
            at: baseURL,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )

        let projects = try projectDirectories.compactMap { directoryURL -> OpenReelProject? in
            let values = try directoryURL.resourceValues(forKeys: [.isDirectoryKey])
            guard values.isDirectory == true else {
                return nil
            }

            let jsonURL = directoryURL.appendingPathComponent("project.json", isDirectory: false)
            guard fileManager.fileExists(atPath: jsonURL.path) else {
                return nil
            }

            let data = try Data(contentsOf: jsonURL)
            let file = try decoder.decode(OpenReelProjectFile.self, from: data)
            return file.project
        }

        return projects.sorted { $0.modifiedAt > $1.modifiedAt }
    }

    func loadProject(id: String) throws -> OpenReelProject? {
        try ensureBaseDirectories()

        let jsonURL = projectDirectoryURL(for: id).appendingPathComponent("project.json", isDirectory: false)
        guard fileManager.fileExists(atPath: jsonURL.path) else {
            return nil
        }

        let data = try Data(contentsOf: jsonURL)
        return try decoder.decode(OpenReelProjectFile.self, from: data).project
    }

    func save(project: OpenReelProject) throws {
        try ensureProjectDirectories(for: project.id)

        let projectFile = OpenReelProjectFile(project: project)
        let data = try encoder.encode(projectFile)
        let jsonURL = projectDirectoryURL(for: project.id).appendingPathComponent("project.json", isDirectory: false)
        try data.write(to: jsonURL, options: [.atomic])
    }

    func deleteProject(id: String) throws {
        let directoryURL = projectDirectoryURL(for: id)
        guard fileManager.fileExists(atPath: directoryURL.path) else {
            throw StoreError.projectNotFound
        }

        try fileManager.removeItem(at: directoryURL)
    }

    nonisolated func projectDirectoryURL(for projectID: String) -> URL {
        baseURL.appendingPathComponent(projectID, isDirectory: true)
    }

    nonisolated func mediaDirectoryURL(for projectID: String) -> URL {
        projectDirectoryURL(for: projectID).appendingPathComponent("media", isDirectory: true)
    }

    nonisolated func thumbnailsDirectoryURL(for projectID: String) -> URL {
        projectDirectoryURL(for: projectID).appendingPathComponent("thumbnails", isDirectory: true)
    }

    nonisolated func relativeResourceURL(projectID: String, relativePath: String) -> URL {
        projectDirectoryURL(for: projectID).appendingPathComponent(relativePath, isDirectory: false)
    }

    func persistMedia(
        projectID: String,
        sourceURL: URL,
        preferredFileName: String,
        thumbnailData: Data? = nil,
        thumbnailFileName: String? = nil
    ) throws -> (mediaFileName: String, thumbnailRelativePath: String?) {
        try ensureProjectDirectories(for: projectID)

        let safeMediaFileName = makeUniqueFileName(
            preferredFileName,
            in: mediaDirectoryURL(for: projectID)
        )
        let mediaDestination = mediaDirectoryURL(for: projectID).appendingPathComponent(safeMediaFileName, isDirectory: false)

        if fileManager.fileExists(atPath: mediaDestination.path) {
            try fileManager.removeItem(at: mediaDestination)
        }
        try fileManager.copyItem(at: sourceURL, to: mediaDestination)

        var thumbnailRelativePath: String?
        if let thumbnailData, let thumbnailFileName {
            let safeThumbnailFileName = makeUniqueFileName(thumbnailFileName, in: thumbnailsDirectoryURL(for: projectID))
            let thumbnailDestination = thumbnailsDirectoryURL(for: projectID).appendingPathComponent(safeThumbnailFileName, isDirectory: false)
            try thumbnailData.write(to: thumbnailDestination, options: [.atomic])
            thumbnailRelativePath = "thumbnails/\(safeThumbnailFileName)"
        }

        return (safeMediaFileName, thumbnailRelativePath)
    }

    func persistThumbnail(projectID: String, fileName: String, data: Data) throws -> String {
        try ensureProjectDirectories(for: projectID)
        let safeFileName = makeUniqueFileName(fileName, in: thumbnailsDirectoryURL(for: projectID))
        let outputURL = thumbnailsDirectoryURL(for: projectID).appendingPathComponent(safeFileName, isDirectory: false)
        try data.write(to: outputURL, options: [.atomic])
        return "thumbnails/\(safeFileName)"
    }

    private func ensureBaseDirectories() throws {
        try fileManager.createDirectory(at: baseURL, withIntermediateDirectories: true)
    }

    private func ensureProjectDirectories(for projectID: String) throws {
        try ensureBaseDirectories()
        try fileManager.createDirectory(at: projectDirectoryURL(for: projectID), withIntermediateDirectories: true)
        try fileManager.createDirectory(at: mediaDirectoryURL(for: projectID), withIntermediateDirectories: true)
        try fileManager.createDirectory(at: thumbnailsDirectoryURL(for: projectID), withIntermediateDirectories: true)
    }

    private func makeUniqueFileName(_ preferredFileName: String, in directoryURL: URL) -> String {
        let sanitizedBaseName = sanitizeFileName(preferredFileName)
        let candidateURL = directoryURL.appendingPathComponent(sanitizedBaseName, isDirectory: false)
        guard fileManager.fileExists(atPath: candidateURL.path) else {
            return sanitizedBaseName
        }

        let base = candidateURL.deletingPathExtension().lastPathComponent
        let ext = candidateURL.pathExtension
        var index = 1

        while true {
            let nextName = ext.isEmpty ? "\(base)-\(index)" : "\(base)-\(index).\(ext)"
            let nextURL = directoryURL.appendingPathComponent(nextName, isDirectory: false)
            if !fileManager.fileExists(atPath: nextURL.path) {
                return nextName
            }
            index += 1
        }
    }

    private func sanitizeFileName(_ fileName: String) -> String {
        let cleaned = fileName
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")

        return cleaned.isEmpty ? UUID().uuidString : cleaned
    }
}