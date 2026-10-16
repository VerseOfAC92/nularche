// İlk açılış sihirbazı: Hoş geldiniz → Yapay zekâ seçimi ve bağlantı → Hazır.
// Her adım atlanabilir; daha sonra Ayarlar → Yapay zekâ bölümünden tamamlanabilir.

import { useState } from "react";
import { desktop } from "../desktop.ts";
import { AiSetup } from "./AiSetup.tsx";
import { t } from "../i18n/index.ts";

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
          {[t("onb.stepWelcome"), t("onb.stepAi"), t("onb.stepReady")].map((label, i) => (
            <span key={label} className={i === step ? "on" : i < step ? "done" : ""}>
              {i < step ? "✓" : i + 1} {label}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div className="wizard-body center">
            <img src="/logo.png" alt="" className="wizard-logo" />
            <h2>{t("onb.welcomeTitle")}</h2>
            <p className="muted">{t("onb.welcomeText")}</p>
          </div>
        )}

        {step === 1 && (
          <div className="wizard-body">
            <AiSetup tick={aiTick} onToast={onToast} />
          </div>
        )}

        {step === 2 && (
          <div className="wizard-body center">
            <h2>{t("onb.readyTitle")}</h2>
            <p className="muted">{t("onb.readyText")}</p>
          </div>
        )}

        <div className="wizard-foot">
          <button className="secondary" onClick={finish}>
            {t("onb.skip")}
          </button>
          <div className="row" style={{ display: "flex", gap: 8 }}>
            {step > 0 && (
              <button className="secondary" onClick={() => setStep(step - 1)}>
                {t("onb.back")}
              </button>
            )}
            {step < 2 ? (
              <button className="primary" onClick={() => setStep(step + 1)}>
                {t("onb.next")}
              </button>
            ) : (
              <button className="primary" onClick={finish}>
                {t("onb.start")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
