import Foundation

extension TimeInterval {
    func openReelClock(frameRate: Double = 30) -> String {
        let totalSeconds = max(self, 0)
        let hours = Int(totalSeconds) / 3600
        let minutes = (Int(totalSeconds) % 3600) / 60
        let seconds = Int(totalSeconds) % 60
        let fractional = totalSeconds - floor(totalSeconds)
        let frames = Int((fractional * frameRate).rounded(.down))

        return String(format: "%02d:%02d:%02d:%02d", hours, minutes, seconds, frames)
    }

    func shortClock() -> String {
        let totalSeconds = max(Int(self.rounded(.down)), 0)
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}