// İlk açılış sihirbazı: Hoş geldiniz → Yapay zekâ seçimi ve bağlantı → Hazır.
// Her adım atlanabilir; daha sonra Ayarlar → Yapay zekâ bölümünden tamamlanabilir.

import { useState } from "react";
import { desktop } from "../desktop.ts";
import { AiSetup } from "./AiSetup.tsx";

export function Onboarding({ aiTick, onToast, onDone }: { aiTick: number; onToast: (msg: string) => void; onDone: () => void }) {
  const [step, setStep] = useState(0);

  async function finish() {
    await desktop?.aiSet({ onboarded: true });
    onDone();
  }

  return (
    <div className="overlay">
      <div className="dialog onboarding">
        <div className="wizard-steps">
          {["Hoş geldiniz", "Yapay zekâ", "Hazır"].map((label, i) => (
            <span key={label} className={i === step ? "on" : i < step ? "done" : ""}>
              {i < step ? "✓" : i + 1} {label}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div className="wizard-body center">
            <img src="/logo.png" alt="" className="wizard-logo" />
            <h2>Nularche'ye hoş geldiniz</h2>
            <p className="muted">
              Notlarınız (Node'lar) bilgisayarınızdaki Origin klasöründe düz Markdown dosyaları olarak durur. Şimdi isterseniz notlarınızı düzenlemesi
              için bir yapay zekâ bağlayalım; Claude, ChatGPT ya da Gemini üyeliğinizi kullanabilirsiniz.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="wizard-body">
            <AiSetup tick={aiTick} onToast={onToast} />
          </div>
        )}

        {step === 2 && (
          <div className="wizard-body center">
            <h2>Hazırsınız 🎉</h2>
            <p className="muted">
              Sağ alttaki <b>Nularche AI</b> penceresinden yapay zekânıza istek gönderebilirsiniz. Yapay zekâ ayarlarını istediğiniz zaman{" "}
              <b>Ayarlar → Yapay zekâ</b> bölümünden değiştirebilirsiniz.
            </p>
          </div>
        )}

        <div className="wizard-foot">
          <button className="secondary" onClick={finish}>
            Atla
          </button>
          <div className="row" style={{ display: "flex", gap: 8 }}>
            {step > 0 && (
              <button className="secondary" onClick={() => setStep(step - 1)}>
                Geri
              </button>
            )}
            {step < 2 ? (
              <button className="primary" onClick={() => setStep(step + 1)}>
                İleri
              </button>
            ) : (
              <button className="primary" onClick={finish}>
                Başla
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
