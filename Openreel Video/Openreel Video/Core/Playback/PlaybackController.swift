import AVFoundation
import Foundation
import Observation

@MainActor
@Observable
final class PlaybackController {
    var player: AVPlayer?
    var currentTime: TimeInterval = 0
    var duration: TimeInterval = 0
    var isPlaying = false
    var volume: Float = 1
    var frameRate: Double = 30
    var loadedMediaURL: URL?

    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var endObserver: NSObjectProtocol?
    @ObservationIgnored private var rateObserver: NSKeyValueObservation?
    @ObservationIgnored private var itemStatusObserver: NSKeyValueObservation?
    @ObservationIgnored private var playWhenReadyObserver: NSKeyValueObservation?

    deinit {
        Task { @MainActor [weak self] in
            self?.tearDownObservers()
        }
    }

    func loadVideo(url: URL?, duration: TimeInterval, frameRate: Double) {
        if url == loadedMediaURL, player != nil {
            self.duration = max(duration, 0)
            self.frameRate = frameRate > 0 ? frameRate : 30
            return
        }

        tearDownObservers()
        loadedMediaURL = url
        self.duration = max(duration, 0)
        self.frameRate = frameRate > 0 ? frameRate : 30
        currentTime = 0
        isPlaying = false

        guard let url else {
            player = nil
            return
        }

        let asset = AVURLAsset(url: url)
        let item = AVPlayerItem(asset: asset)
        let newPlayer = AVPlayer(playerItem: item)
        newPlayer.actionAtItemEnd = .pause
        newPlayer.volume = volume
        self.player = newPlayer

        itemStatusObserver = item.observe(\.status, options: [.new]) { [weak self] observedItem, _ in
            Task { @MainActor in
                guard let self else { return }
                if observedItem.status == .readyToPlay {
                    self.itemStatusObserver = nil
                }
            }
        }

        timeObserver = newPlayer.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 1.0 / 30.0, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            guard let self else { return }
            Task { @MainActor in
                let seconds = max(time.seconds, 0)
                if self.player?.rate ?? 0 > 0 {
                    self.currentTime = seconds
                }
            }
        }

        rateObserver = newPlayer.observe(\.rate, options: [.new]) { [weak self] observedPlayer, _ in
            Task { @MainActor in
                guard let self else { return }
                self.isPlaying = observedPlayer.rate > 0
            }
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                self.isPlaying = false
                self.currentTime = self.duration
            }
        }
    }

    func play() {
        guard let player else { return }
        playWhenReadyObserver = nil

        if player.currentItem?.status != .readyToPlay {
            isPlaying = true
            playWhenReadyObserver = player.currentItem?.observe(\.status, options: [.new]) { [weak self] item, _ in
                Task { @MainActor in
                    guard let self, item.status == .readyToPlay else { return }
                    self.playWhenReadyObserver = nil
                    self.startPlayback()
                }
            }
            return
        }

        startPlayback()
    }

    private func startPlayback() {
        guard let player else { return }

        if currentTime >= duration - 0.05 {
            let cmTime = CMTime.zero
            currentTime = 0
            player.seek(to: cmTime, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
                guard finished else { return }
                Task { @MainActor in
                    self?.player?.rate = 1.0
                }
            }
            return
        }

        player.rate = 1.0
    }

    func pause() {
        playWhenReadyObserver = nil
        player?.rate = 0.0
        isPlaying = false
    }

    func togglePlayback() {
        guard let player else { return }
        if player.rate > 0 {
            pause()
        } else {
            play()
        }
    }

    func seek(to time: TimeInterval) {
        let clampedTime = max(0, min(time, duration))
        currentTime = clampedTime

        guard let player else { return }
        let cmTime = CMTime(seconds: clampedTime, preferredTimescale: 600)
        player.seek(to: cmTime, toleranceBefore: .zero, toleranceAfter: .zero)
    }

    func step(frames: Int) {
        let delta = Double(frames) / max(frameRate, 1)
        seek(to: currentTime + delta)
    }

    func setVolume(_ value: Float) {
        volume = min(max(value, 0), 1)
        player?.volume = volume
    }

    private func tearDownObservers() {
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil

        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
        endObserver = nil
        rateObserver = nil
        itemStatusObserver = nil
        playWhenReadyObserver = nil
    }
}
