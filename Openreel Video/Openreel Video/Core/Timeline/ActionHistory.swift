import Foundation

@MainActor
final class ActionHistory<State> {
    private(set) var undoStack: [State] = []
    private(set) var redoStack: [State] = []

    private let limit: Int

    init(limit: Int = 50) {
        self.limit = limit
    }

    var canUndo: Bool {
        !undoStack.isEmpty
    }

    var canRedo: Bool {
        !redoStack.isEmpty
    }

    func clear() {
        undoStack.removeAll()
        redoStack.removeAll()
    }

    func capture(_ state: State) {
        undoStack.append(state)
        if undoStack.count > limit {
            undoStack.removeFirst(undoStack.count - limit)
        }
        redoStack.removeAll()
    }

    func undo(current: State) -> State? {
        guard let previous = undoStack.popLast() else {
            return nil
        }

        redoStack.append(current)
        return previous
    }

    func redo(current: State) -> State? {
        guard let next = redoStack.popLast() else {
            return nil
        }

        undoStack.append(current)
        return next
    }
}