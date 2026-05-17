//
//  ContentView.swift
//  Openreel Video
//
//  Created by Augustus Otu on 17/05/2026.
//

import SwiftUI

struct ContentView: View {
    var body: some View {
        RootView()
    }
}

#Preview {
    ContentView()
        .environment(AppState())
    .environment(PlaybackController())
}
