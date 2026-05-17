import SwiftUI

struct HomeView: View {
    @Environment(AppState.self) private var appState

    private let quickTools = [
        (title: "Trim", symbol: "scissors"),
        (title: "Crop", symbol: "crop"),
        (title: "Speed", symbol: "gauge.with.dots.needle.33percent"),
        (title: "Import", symbol: "square.and.arrow.down"),
        (title: "Timeline", symbol: "timeline.selection")
    ]

    var body: some View {
        ZStack {
            OpenReelTheme.background
                .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 28) {
                    hero
                    recentProjectsSection
                    quickToolsSection
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 52)
            }
        }
        .navigationTitle("OpenReel")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarBackground(OpenReelTheme.background, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    appState.presentNewProjectSheet()
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(OpenReelTheme.textPrimary)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var hero: some View {
        HStack(alignment: .center, spacing: 18) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Create\nwithout limits.")
                    .font(.reelDisplay)
                    .foregroundStyle(OpenReelTheme.textPrimary)

                Text("Import a clip, build a timeline, and keep editing where you left off.")
                    .font(.reelBody)
                    .foregroundStyle(OpenReelTheme.textSecondary)
                    .lineSpacing(2)
            }

            Spacer(minLength: 0)

            HeroAnimation()
        }
    }

    private var newProjectButton: some View {
        Button {
            appState.presentNewProjectSheet()
        } label: {
            VStack(spacing: 8) {
                Image(systemName: "plus")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(OpenReelTheme.accent)
                    .frame(width: 34, height: 34)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                Text("New Project")
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color.white)

                Text("Resolution, frame rate, and ready to import")
                    .font(.reelCaption)
                    .foregroundStyle(Color.white.opacity(0.82))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .background(OpenReelTheme.accent, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var recentProjectsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center) {
                Text("Recent Projects")
                    .font(.reelSection)
                    .foregroundStyle(OpenReelTheme.textPrimary)

                Spacer()

                if !appState.projects.isEmpty {
                    Button {
                        appState.showProjects()
                    } label: {
                        HStack(spacing: 4) {
                            Text("See all")
                            Image(systemName: "chevron.right")
                                .font(.system(size: 10, weight: .bold))
                        }
                        .font(.system(size: 13, weight: .medium, design: .rounded))
                        .foregroundStyle(OpenReelTheme.accent)
                    }
                    .buttonStyle(.plain)
                }
            }

            if appState.projects.isEmpty {
                emptyProjectsState
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 14) {
                        ForEach(appState.projects) { project in
                            Button {
                                appState.openProject(project)
                            } label: {
                                ProjectShowcaseCard(project: project)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    private var emptyProjectsState: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("No projects yet", systemImage: "film.stack")
                .font(.system(size: 16, weight: .semibold, design: .rounded))
                .foregroundStyle(OpenReelTheme.textPrimary)

            Text("Create a project, import a video from Photos, and the timeline will auto-save into Application Support.")
                .font(.reelBody)
                .foregroundStyle(OpenReelTheme.textSecondary)

            Button("Create First Project") {
                appState.presentNewProjectSheet()
            }
            .buttonStyle(.plain)
            .font(.system(size: 13, weight: .semibold, design: .rounded))
            .foregroundStyle(OpenReelTheme.accent)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(OpenReelTheme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var quickToolsSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Phase 1 Tools")
                .font(.reelSection)
                .foregroundStyle(OpenReelTheme.textPrimary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(quickTools, id: \.title) { tool in
                        HStack(spacing: 10) {
                            Image(systemName: tool.symbol)
                                .font(.system(size: 17, weight: .medium))
                                .foregroundStyle(OpenReelTheme.textSecondary)
                            Text(tool.title)
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                                .foregroundStyle(OpenReelTheme.textPrimary)
                        }
                        .padding(.horizontal, 16)
                        .frame(height: 48)
                        .background(OpenReelTheme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.04), lineWidth: 1)
                        }
                    }
                }
            }
        }
    }

}

private struct HeroAnimation: View {
    @State private var phase: Double = 0
    @State private var morphPhase: Int = 0

    private let size: CGFloat = 120
    private let particleCount = 12

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
            let now = timeline.date.timeIntervalSinceReferenceDate
            Canvas { context, canvasSize in
                let center = CGPoint(x: canvasSize.width / 2, y: canvasSize.height / 2)
                let time = now.truncatingRemainder(dividingBy: 20)

                drawGlowBackground(context: &context, center: center, time: time)
                drawMorphingShape(context: &context, center: center, time: time)
                drawOrbitingParticles(context: &context, center: center, time: time)
                drawPulsingCore(context: &context, center: center, time: time)
            }
            .frame(width: size, height: size)
        }
        .onAppear {
            withAnimation(.linear(duration: 8).repeatForever(autoreverses: false)) {
                phase = .pi * 2
            }
        }
    }

    private func drawGlowBackground(context: inout GraphicsContext, center: CGPoint, time: Double) {
        let radius = 48 + sin(time * 0.8) * 6
        let gradient = Gradient(colors: [
            Color(red: 0.29, green: 0.87, blue: 0.5).opacity(0.25),
            Color(red: 0.29, green: 0.87, blue: 0.5).opacity(0)
        ])
        let shading = GraphicsContext.Shading.radialGradient(
            gradient,
            center: center,
            startRadius: 0,
            endRadius: radius
        )
        context.fill(Circle().path(in: CGRect(
            x: center.x - radius,
            y: center.y - radius,
            width: radius * 2,
            height: radius * 2
        )), with: shading)
    }

    private func drawMorphingShape(context: inout GraphicsContext, center: CGPoint, time: Double) {
        let points = 6
        let baseRadius: CGFloat = 32
        var path = Path()

        for i in 0...points * 4 {
            let t = Double(i) / Double(points * 4)
            let angle = t * .pi * 2
            let wobble1 = sin(angle * 3 + time * 1.2) * 8
            let wobble2 = cos(angle * 2 + time * 0.7) * 5
            let wobble3 = sin(angle * 5 + time * 2.1) * 3
            let r = baseRadius + wobble1 + wobble2 + wobble3
            let x = center.x + cos(angle) * r
            let y = center.y + sin(angle) * r

            if i == 0 {
                path.move(to: CGPoint(x: x, y: y))
            } else {
                path.addLine(to: CGPoint(x: x, y: y))
            }
        }
        path.closeSubpath()

        let hue = (time * 0.05).truncatingRemainder(dividingBy: 1.0)
        let fillColor = Color(
            hue: 0.38 + hue * 0.08,
            saturation: 0.75,
            brightness: 0.85
        )

        context.fill(path, with: .color(fillColor.opacity(0.6)))
        context.stroke(path, with: .color(fillColor.opacity(0.9)), lineWidth: 1.5)
    }

    private func drawOrbitingParticles(context: inout GraphicsContext, center: CGPoint, time: Double) {
        for i in 0..<particleCount {
            let baseAngle = Double(i) / Double(particleCount) * .pi * 2
            let speed = 0.4 + Double(i % 3) * 0.2
            let angle = baseAngle + time * speed
            let orbitRadius: CGFloat = 38 + CGFloat(i % 4) * 5
            let particleSize: CGFloat = 2 + CGFloat(i % 3) * 1.5

            let x = center.x + cos(angle) * orbitRadius
            let y = center.y + sin(angle) * orbitRadius

            let opacity = 0.4 + sin(time * 2 + Double(i)) * 0.4
            let color = Color(
                hue: 0.38 + Double(i) / Double(particleCount) * 0.1,
                saturation: 0.8,
                brightness: 0.95
            ).opacity(opacity)

            let rect = CGRect(
                x: x - particleSize / 2,
                y: y - particleSize / 2,
                width: particleSize,
                height: particleSize
            )
            context.fill(Circle().path(in: rect), with: .color(color))
        }
    }

    private func drawPulsingCore(context: inout GraphicsContext, center: CGPoint, time: Double) {
        let pulse = 6 + sin(time * 2.5) * 2.5
        let coreGradient = Gradient(colors: [
            .white.opacity(0.9),
            Color(red: 0.29, green: 0.87, blue: 0.5).opacity(0.7),
            Color(red: 0.29, green: 0.87, blue: 0.5).opacity(0)
        ])
        let shading = GraphicsContext.Shading.radialGradient(
            coreGradient,
            center: center,
            startRadius: 0,
            endRadius: pulse
        )
        context.fill(Circle().path(in: CGRect(
            x: center.x - pulse,
            y: center.y - pulse,
            width: pulse * 2,
            height: pulse * 2
        )), with: shading)
    }
}

#Preview {
    NavigationStack {
        HomeView()
            .environment(AppState())
    }
}