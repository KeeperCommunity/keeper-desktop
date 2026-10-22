import AppKit
import Vision
import CoreGraphics

if CommandLine.arguments.count == 4 && CommandLine.arguments[1] == "click" {
    guard let x = Double(CommandLine.arguments[2]), let y = Double(CommandLine.arguments[3]) else { fatalError("Invalid click") }
    let point = CGPoint(x: x, y: y)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
} else {
    guard CommandLine.arguments.count == 2, let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fatalError("Expected screenshot") }
    let text = VNRecognizeTextRequest()
    text.recognitionLevel = .accurate
    let barcodes = VNDetectBarcodesRequest()
    barcodes.symbologies = [.qr]
    try VNImageRequestHandler(cgImage: cg).perform([text, barcodes])
    let words: [[String: Any]] = (text.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let b = observation.boundingBox
        return ["text": candidate.string, "x": b.midX * Double(cg.width), "y": (1 - b.midY) * Double(cg.height)]
    }
    let values = (barcodes.results ?? []).compactMap { $0.payloadStringValue }
    let value: [String: Any] = ["text": words, "qr": values, "width": cg.width, "height": cg.height]
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: value))
}
