import AVFoundation
import SwiftUI
import UIKit

struct MetalVideoView: UIViewRepresentable {
    var player: AVPlayer?

    func makeUIView(context: Context) -> VideoPlayerUIView {
        let view = VideoPlayerUIView()
        view.setPlayer(player)
        return view
    }

    func updateUIView(_ uiView: VideoPlayerUIView, context: Context) {
        uiView.setPlayer(player)
    }
}

final class VideoPlayerUIView: UIView {
    private let playerLayer = AVPlayerLayer()
    private weak var currentPlayer: AVPlayer?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        playerLayer.videoGravity = .resizeAspect
        playerLayer.backgroundColor = UIColor.black.cgColor
        layer.addSublayer(playerLayer)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        playerLayer.frame = bounds
    }

    func setPlayer(_ player: AVPlayer?) {
        guard currentPlayer !== player else { return }
        currentPlayer = player
        playerLayer.player = player
        playerLayer.frame = bounds
    }
}
