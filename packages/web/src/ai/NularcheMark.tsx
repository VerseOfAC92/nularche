// Nularche işareti: uygulama ikonunun (çerçeveli madalyon içinde N ve A monogramı) ince çizgili,
// tek renkli küçük sürümü. Rengini metinden alır (currentColor): koyu temada beyaz çizgiler.

export function NularcheMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* madalyon çerçevesi */}
      <circle cx="12" cy="12" r="10.6" strokeWidth="1.3" />
      <circle cx="12" cy="12" r="8.7" strokeWidth="0.7" strokeDasharray="1.1 1.5" opacity="0.8" />
      {/* çerçevedeki perçinler */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <circle key={deg} cx={12 + 9.65 * Math.cos((deg * Math.PI) / 180)} cy={12 + 9.65 * Math.sin((deg * Math.PI) / 180)} r="0.45" fill="currentColor" stroke="none" />
      ))}
      {/* N */}
      <path d="M6.4 16.2V7.8L11 16.2V7.8" strokeWidth="1.5" />
      {/* A */}
      <path d="M11 16.2L14.3 7.8L17.6 16.2" strokeWidth="1.5" />
      <path d="M12.4 13.1H16.2" strokeWidth="1.2" />
    </svg>
  );
}
