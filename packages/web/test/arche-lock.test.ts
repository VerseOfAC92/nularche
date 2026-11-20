import { describe, expect, it } from "vitest";
import { isLockedBody } from "../../core/src/note-text.ts";
import {
  closeAllLocked,
  createArcheLock,
  forgetArche,
  isArcheUnlocked,
  isUnlocked,
  lockedArche,
  lockNote,
  openWithSession,
  resealNote,
  sealForArche,
  unlockArche,
  unlockNote,
} from "../src/lock.ts";

describe("şifreli Arche", () => {
  it("tek parola Arche'nin bütün notlarını açar; anahtar bellekten silinince yeniden parola ister", async () => {
    const lock = await createArcheLock("A1", "gizli-parola", "kedi");
    expect(lock.hint).toBe("kedi");
    expect(JSON.stringify(lock)).not.toContain("gizli-parola");
    const one = (await sealForArche("A1", "birinci not", "🔒"))!;
    const two = (await sealForArche("A1", "ikinci not", "🔒"))!;
    expect(isLockedBody(one)).toBe(true);
    expect(one).not.toContain("birinci");
    expect(lockedArche(one)).toBe("A1");

    // Oturum açıkken parola sorulmadan açılır; ayrı notların kendi anahtarı gerekmez.
    expect(isUnlocked("n1", lockedArche(one))).toBe(true);
    expect(await openWithSession("n1", one)).toBe("birinci not");
    expect(await openWithSession("n2", two)).toBe("ikinci not");
    // Kaydederken Arche'nin anahtarıyla yeniden şifrelenir.
    const resealed = (await resealNote("n1", "değişti", "🔒", "A1"))!;
    expect(lockedArche(resealed)).toBe("A1");
    expect(await openWithSession("n1", resealed)).toBe("değişti");

    forgetArche("A1");
    expect(isArcheUnlocked("A1")).toBe(false);
    expect(await openWithSession("n1", one)).toBeNull();
    expect(await sealForArche("A1", "x", "🔒")).toBeNull();

    // Yanlış parola reddedilir, doğrusu bütün Arche'yi açar.
    expect(await unlockArche("A1", lock, "yanlış")).toBe(false);
    expect(await unlockArche("A1", lock, "gizli-parola")).toBe(true);
    expect(await openWithSession("n2", two)).toBe("ikinci not");

    // Bir notun parolasıyla açmak da Arche'nin anahtarını açar.
    closeAllLocked();
    expect(await unlockNote("n2", "gizli-parola", two)).toBe("ikinci not");
    expect(isArcheUnlocked("A1")).toBe(true);
    expect(await openWithSession("n1", one)).toBe("birinci not");
    closeAllLocked();
    expect(isArcheUnlocked("A1")).toBe(false);
  }, 30_000);

  it("kendi parolasıyla kilitli not Arche'den bağımsızdır", async () => {
    const own = await lockNote("n9", "notun-parolası", "özel", undefined, "🔒");
    expect(lockedArche(own)).toBeNull();
    await createArcheLock("A2", "arche-parolası");
    expect(await openWithSession("n9", own)).toBe("özel"); // kilitlerken açık kaldı
    closeAllLocked();
    await unlockArche("A2", (await createArcheLock("A2", "arche-parolası")), "arche-parolası");
    expect(await openWithSession("n9", own)).toBeNull();
    closeAllLocked();
  }, 30_000);
});
