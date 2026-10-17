// DMG penceresi arka planı: sürükle-bırak oku ve macOS 15+ ilk açılış adımı (EN + TR).
import AppKit
func render(scale: CGFloat, out: String) {
  let W: CGFloat = 660, H: CGFloat = 460
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(W * scale), pixelsHigh: Int(H * scale), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  rep.size = NSSize(width: W, height: H)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  // Finder simge etiketleri koyu yazıldığı için açık zemin.
  NSColor(srgbRed: 0.965, green: 0.972, blue: 0.98, alpha: 1).setFill()
  NSRect(x: 0, y: 0, width: W, height: H).fill()
  let teal = NSColor(srgbRed: 0.0, green: 0.50, blue: 0.54, alpha: 1)
  let ink = NSColor(srgbRed: 0.12, green: 0.14, blue: 0.16, alpha: 1)
  let muted = NSColor(srgbRed: 0.35, green: 0.39, blue: 0.43, alpha: 1)
  func text(_ s: String, _ x: CGFloat, _ yTop: CGFloat, _ w: CGFloat, _ size: CGFloat, _ color: NSColor, bold: Bool = false, center: Bool = false) {
    let p = NSMutableParagraphStyle(); p.alignment = center ? .center : .left; p.lineSpacing = 2
    let attrs: [NSAttributedString.Key: Any] = [.font: bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size), .foregroundColor: color, .paragraphStyle: p]
    let str = NSAttributedString(string: s, attributes: attrs)
    let r = str.boundingRect(with: NSSize(width: w, height: 400), options: [.usesLineFragmentOrigin])
    str.draw(with: NSRect(x: x, y: H - yTop - r.height, width: w, height: r.height), options: [.usesLineFragmentOrigin])
  }
  text("Drag Nularche into Applications", 0, 26, W, 20, ink, bold: true, center: true)
  text("Nularche'yi Uygulamalar klasörüne sürükleyin", 0, 54, W, 13, muted, center: true)
  // Ok (simgeler y≈175'te, x=170 ve x=490)
  let arrow = NSBezierPath()
  arrow.move(to: NSPoint(x: 262, y: H - 175)); arrow.line(to: NSPoint(x: 392, y: H - 175))
  arrow.lineWidth = 5; arrow.lineCapStyle = .round; teal.setStroke(); arrow.stroke()
  let head = NSBezierPath()
  head.move(to: NSPoint(x: 400, y: H - 175)); head.line(to: NSPoint(x: 382, y: H - 162)); head.line(to: NSPoint(x: 382, y: H - 188)); head.close()
  teal.setFill(); head.fill()
  // İlk açılış kutusu
  let box = NSRect(x: 30, y: 22, width: W - 60, height: 156)
  NSColor.white.setFill(); let bp = NSBezierPath(roundedRect: box, xRadius: 12, yRadius: 12); bp.fill()
  teal.withAlphaComponent(0.5).setStroke(); bp.lineWidth = 1.5; bp.stroke()
  text("First launch (macOS 15 or newer) · İlk açılış", 50, H - box.maxY + 14, W - 100, 13.5, teal, bold: true)
  text("If you see \u{201C}Nularche.app\u{201D} Not Opened, click Done (not Move to Bin). Right away, open System Settings \u{2192} Privacy & Security, scroll to Security and click Open Anyway. Only needed once. Or run in Terminal:  xattr -dr com.apple.quarantine /Applications/Nularche.app", 50, H - box.maxY + 38, W - 100, 12, ink)
  text("Uyarıda Done / Bitti'ye basın (Move to Bin'e değil). Hemen ardından Sistem Ayarları \u{2192} Gizlilik ve Güvenlik \u{2192} Güvenlik bölümünde Open Anyway / Yine de Aç'a basın. Bir kez gerekir.", 50, H - box.maxY + 106, W - 100, 12, muted)
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
}
render(scale: 1, out: CommandLine.arguments[1] + "/background.png")
render(scale: 2, out: CommandLine.arguments[1] + "/background@2x.png")
