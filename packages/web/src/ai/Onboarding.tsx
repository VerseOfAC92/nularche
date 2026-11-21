// İlk açılış sihirbazı: Hoş geldiniz → Depolama (bu bilgisayar ya da Google Drive) → Nularche dili → Yapay zekâ
// seçimi ve bağlantı → Hazır. Her adım atlanabilir; daha sonra Ayarlar'dan tamamlanabilir.

import { useEffect, useState } from "react";
import { desktop } from "../desktop.ts";
import { AiSetup } from "./AiSetup.tsx";
import { t } from "../i18n/index.ts";
import { Glossary } from "../studio/Glossary.tsx";
import { Icon } from "../ui/Icon.tsx";
import { StorageSetup } from "../StorageSetup.tsx";

export function Onboarding({ aiTick, onToast, onDone }: { aiTick: number; onToast: (msg: string) => void; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const last = 4;
  // Sihirbazda klasör değiştirilince pencere yeniden yüklenir: sihirbaz depolama adımından sonra sürer.
  useEffect(() => {
    void desktop?.storageStatus().then((s) => s.resume && setStep((v) => (v === 0 ? 2 : v)));
  }, []);
  const chooseStorage = () => desktop?.storageChosen();

  async function finish() {
    await chooseStorage();
    await desktop?.aiSet({ onboarded: true });
    onDone();
  }
  const next = () => {
    if (step === 1) void chooseStorage();
    setStep(step + 1);
  };

  return (
    <div className="overlay">
      <div className="dialog onboarding">
        <div className="wizard-steps">
          {[t("onb.stepWelcome"), t("storage.step"), t("gloss.step"), t("onb.stepAi"), t("onb.stepReady")].map((label, i) => (
            <span key={label} className={i === step ? "on" : i < step ? "done" : ""}>
              {i < step ? <Icon name="check" size={13} /> : i + 1} {label}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div className="wizard-body center">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="wizard-logo" />
            <h2>{t("onb.welcomeTitle")}</h2>
            <p className="muted">{t("onb.welcomeText")}</p>
          </div>
        )}

        {step === 1 && (
          <div className="wizard-body">
            <h2>{t("storage.title")}</h2>
            <p className="muted">{t("storage.intro")}</p>
            <StorageSetup onToast={onToast} onBeforeFolderChange={async () => void (await desktop?.storageChosen(true))} />
          </div>
        )}

        {step === 2 && (
          <div className="wizard-body">
            <h2>{t("gloss.title")}</h2>
            <p className="muted">{t("gloss.intro")}</p>
            <Glossary compact />
          </div>
        )}

        {step === 3 && (
          <div className="wizard-body">
            <AiSetup tick={aiTick} onToast={onToast} />
          </div>
        )}

        {step === last && (
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
            {step < last ? (
              <button className="primary" onClick={next}>
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
