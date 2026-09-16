import EventKit
import Foundation
import FoundationModels

// JSON-lines protocol over stdio. Requests:
//   {"id":"1","cmd":"probe"}
//   {"id":"2","cmd":"generate","prompt":"...","system":"..."}
// Responses:
//   {"id":"1","type":"probe","available":true,"reason":null}
//   {"id":"2","type":"delta","text":"..."}   (repeated)
//   {"id":"2","type":"done","error":null}

struct Request: Decodable {
    let id: String
    let cmd: String
    let prompt: String?
    let system: String?
    let daysBack: Int?
    let daysForward: Int?
}

func emit(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let line = String(data: data, encoding: .utf8)
    else { return }
    print(line)
    fflush(stdout)
}

func unavailabilityText(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
    switch reason {
    case .deviceNotEligible:
        return "This Mac's hardware does not support Apple Intelligence"
    case .appleIntelligenceNotEnabled:
        return "Apple Intelligence is turned off in System Settings"
    case .modelNotReady:
        return "The Apple Intelligence model is still downloading — try again shortly"
    @unknown default:
        return "Apple Intelligence is unavailable"
    }
}

func handleProbe(id: String) {
    switch SystemLanguageModel.default.availability {
    case .available:
        emit(["id": id, "type": "probe", "available": true, "reason": NSNull()])
    case .unavailable(let reason):
        emit([
            "id": id, "type": "probe", "available": false,
            "reason": unavailabilityText(reason),
        ])
    }
}

func handleGenerate(id: String, prompt: String, system: String?) async {
    do {
        let session: LanguageModelSession
        if let system, !system.isEmpty {
            session = LanguageModelSession(instructions: system)
        } else {
            session = LanguageModelSession()
        }

        var previous = ""
        let stream = session.streamResponse(to: prompt)
        for try await partial in stream {
            let full = partial.content
            if full.count > previous.count {
                let delta = String(full.dropFirst(previous.count))
                emit(["id": id, "type": "delta", "text": delta])
                previous = full
            }
        }
        emit(["id": id, "type": "done", "error": NSNull()])
    } catch {
        emit(["id": id, "type": "done", "error": "\(error)"])
    }
}

// ---------------------------------------------------------------------------
// EventKit (Apple Calendar)
// ---------------------------------------------------------------------------

func handleCalendarProbe(id: String) async {
    let eventStore = EKEventStore()
    do {
        let granted = try await eventStore.requestFullAccessToEvents()
        emit(["id": id, "type": "done", "granted": granted, "error": NSNull()])
    } catch {
        emit(["id": id, "type": "done", "granted": false, "error": "\(error)"])
    }
}

func handleCalendarEvents(id: String, daysBack: Int, daysForward: Int) async {
    let eventStore = EKEventStore()
    do {
        let granted = try await eventStore.requestFullAccessToEvents()
        guard granted else {
            emit(["id": id, "type": "done", "error": "Calendar access was not granted"])
            return
        }
        let start = Calendar.current.date(byAdding: .day, value: -daysBack, to: Date())!
        let end = Calendar.current.date(byAdding: .day, value: daysForward, to: Date())!
        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: nil)
        let events = eventStore.events(matching: predicate)

        let formatter = ISO8601DateFormatter()
        let payload: [[String: Any]] = events.map { event in
            [
                "id": event.eventIdentifier ?? UUID().uuidString,
                "title": event.title ?? "(untitled)",
                "start": event.startDate.map { formatter.string(from: $0) } ?? "",
                "end": event.endDate.map { formatter.string(from: $0) } ?? "",
                "allDay": event.isAllDay,
                "location": event.location ?? "",
                "notes": event.notes ?? "",
                "calendar": event.calendar?.title ?? "",
                "attendees": (event.attendees ?? []).compactMap { $0.name },
            ]
        }
        // Chunk the JSON payload through delta messages to keep lines bounded.
        if let data = try? JSONSerialization.data(withJSONObject: payload),
           let json = String(data: data, encoding: .utf8) {
            var remaining = Substring(json)
            while !remaining.isEmpty {
                let chunk = remaining.prefix(60_000)
                emit(["id": id, "type": "delta", "text": String(chunk)])
                remaining = remaining.dropFirst(chunk.count)
            }
        }
        emit(["id": id, "type": "done", "error": NSNull()])
    } catch {
        emit(["id": id, "type": "done", "error": "\(error)"])
    }
}

@main
struct AppleKit {
    static func main() async {
        do {
            for try await line in FileHandle.standardInput.bytes.lines {
                guard let data = line.data(using: .utf8),
                      let request = try? JSONDecoder().decode(Request.self, from: data)
                else { continue }

                switch request.cmd {
                case "probe":
                    handleProbe(id: request.id)
                case "generate":
                    await handleGenerate(
                        id: request.id,
                        prompt: request.prompt ?? "",
                        system: request.system
                    )
                case "calendar_probe":
                    await handleCalendarProbe(id: request.id)
                case "calendar_events":
                    await handleCalendarEvents(
                        id: request.id,
                        daysBack: request.daysBack ?? 7,
                        daysForward: request.daysForward ?? 14
                    )
                default:
                    emit([
                        "id": request.id, "type": "done",
                        "error": "Unknown command: \(request.cmd)",
                    ])
                }
            }
        } catch {
            // stdin closed — exit quietly
        }
    }
}
