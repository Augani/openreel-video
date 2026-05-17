//
//  Openreel_VideoApp.swift
//  Openreel Video
//
//  Created by Augustus Otu on 17/05/2026.
//

import AVFoundation
import SwiftUI

@main
struct Openreel_VideoApp: App {
    @State private var appState = AppState()
    @State private var playbackController = PlaybackController()

    init() {
        configureAudioSession()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appState)
                .environment(playbackController)
        }
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .moviePlayback)
            try session.setActive(true)
        } catch {
            print("Audio session configuration failed: \(error)")
        }
    }
}
