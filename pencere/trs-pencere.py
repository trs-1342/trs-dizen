#!/usr/bin/python3
"""trs-pencere — trs-dizen'in yardımcı servisi: pencere olaylarını kaydeder, sayımla alışkanlık çıkarır,
Firefox gizli pencere açılınca ekran parlaklığını kısar.

trs-dizen bir KWin betiğidir; dışarıya yalnız D-Bus ile veri verebilir. Bu servis `net.trs.Pencere`
adını alır; betik her kullanıcı hareketinde `olay(JSON)`, gizli pencere açılıp kapanınca `ffGizli(bool)`
çağırır.

GİZLİLİK: sayfa/pencere BAŞLIĞI hiç gelmez, kaydedilmez. Yalnız program adı (resourceClass), ne yaptığın
(aç/elle/kapat + sol/sag/tam), kaç pencere vardı, hangi masaüstü/ekran, saat. Günlük 0600, yalnız sen.

  trs-pencere --servis   arka planda bekleyen süreç (trs-pencere.service bunu çalıştırır)
  trs-pencere ozet       öğrenilen alışkanlıklar (program başına nereye koyuyorsun, neyi elle yapıyorsun)
  trs-pencere durum      servis çalışıyor mu, kaç olay kaydedildi
"""
import json
import os
import re
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

DURUM_DIZIN = Path(os.environ.get("TRS_PENCERE_DURUM") or Path.home() / ".local/state/trs-dizen")
GUNLUK = DURUM_DIZIN / "olaylar.jsonl"
OGRENME = DURUM_DIZIN / "ogrenme.json"
OGRENILEN = Path(os.environ.get("TRS_PENCERE_OGRENILEN") or Path.home() / ".config/trs/dizen-ogrenilen.json")

GUNLUK_EN_COK = 4 * 1024 * 1024        # bayt: aşınca eski yarısı atılır
PROG_KURALI = re.compile(r"[0-9A-Za-z._:+-]{1,80}")
YERLER = ("sol", "sag", "tam")

# Öğrenme eşiği: bir programı EN AZ bu kadar kez elle bir yana koyduysan ve oranı bu kadarsa, kuralsız
# açılışta o yan "öğrenilen tercih" olur (rastgele yarı yerine). Betik bunu düşük öncelikli kullanır.
OGREN_EN_AZ = 5
OGREN_ORAN = 0.7

# Firefox gizli pencere: ekran parlaklığı bu yüzdeye iner; pencere kapanınca eski değere döner.
GIZLI_PARLAKLIK = 2
PARLAK_SERVIS = "org.kde.ScreenBrightness"
PARLAK_KOK = "/org/kde/ScreenBrightness"


def gdbus(*argv, zaman=3):
    try:
        r = subprocess.run(["gdbus", "call", "--session", *argv], capture_output=True, text=True, timeout=zaman)
        return r.stdout.strip() if r.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


# ── parlaklık (dinamik ekran yolu; yalnız dahili ekran) ───────────────────────────────────────────────────────
def ekran_yollari():
    out = gdbus("-d", PARLAK_SERVIS, "-o", PARLAK_KOK, "-m", "org.freedesktop.DBus.Properties.Get",
                PARLAK_SERVIS, "DisplaysDBusNames")
    return re.findall(r"'([^']+)'", out) if out else []


def ekran_oku(ad):
    out = gdbus("-d", PARLAK_SERVIS, "-o", f"{PARLAK_KOK}/{ad}", "-m", "org.freedesktop.DBus.Properties.GetAll",
                f"{PARLAK_SERVIS}.Display")
    if not out:
        return None
    b = re.search(r"'Brightness': <(\d+)>", out)
    mx = re.search(r"'MaxBrightness': <(\d+)>", out)
    ic = "'IsInternal': <true>" in out
    if not b or not mx or not int(mx.group(1)):
        return None
    return {"ad": ad, "deger": int(b.group(1)), "enfazla": int(mx.group(1)), "dahili": ic}


def ekran_yaz(ad, deger):
    gdbus("-d", PARLAK_SERVIS, "-o", f"{PARLAK_KOK}/{ad}", "-m", PARLAK_SERVIS + ".Display.SetBrightness",
          str(int(deger)), "1")        # "1": ekranda gösterge çıkarma


# ── öğrenme (sayımla) ─────────────────────────────────────────────────────────────────────────────────────────
class Ogrenme:
    """Program başına sayımlar: nereye koyuyorsun (sol/sag/tam), ne sıklıkla elle yapıyorsun. Kuralsız
    programlar için güçlü bir yan tercihi öğrenilir ve betiğe düşük öncelikli ipucu olarak yazılır."""

    def __init__(self):
        self.prog = defaultdict(lambda: {"ac": 0, "elle": 0, "kapat": 0,
                                         "yer": {"sol": 0, "sag": 0, "tam": 0}})
        self.toplam = 0
        self.yukle()

    def yukle(self):
        try:
            veri = json.loads(OGRENME.read_text(encoding="utf-8"))
            self.toplam = int(veri.get("toplam", 0))
            for ad, s in veri.get("prog", {}).items():
                if PROG_KURALI.fullmatch(ad):
                    d = self.prog[ad]
                    for k in ("ac", "elle", "kapat"):
                        d[k] = int(s.get(k, 0))
                    for y in YERLER:
                        d["yer"][y] = int(s.get("yer", {}).get(y, 0))
        except (OSError, ValueError, TypeError):
            pass

    def ekle(self, tur, prog, yer=None):
        if not prog or not PROG_KURALI.fullmatch(prog):
            return
        d = self.prog[prog]
        if tur in ("ac", "elle", "kapat"):
            d[tur] += 1
        if tur == "elle" and yer in YERLER:
            d["yer"][yer] += 1
        self.toplam += 1

    def tercih(self, prog):
        """Kuralsız program için öğrenilen yan: elle en çok nereye koyduğun (sol/sag), yeterince güçlüyse."""
        d = self.prog.get(prog)
        if not d:
            return None
        sol, sag = d["yer"]["sol"], d["yer"]["sag"]
        n = sol + sag
        if n < OGREN_EN_AZ:
            return None
        en, oran = ("sol", sol / n) if sol >= sag else ("sag", sag / n)
        return en if oran >= OGREN_ORAN else None

    def ozet(self):
        satir = []
        for ad in sorted(self.prog, key=lambda a: -self.prog[a]["ac"] - self.prog[a]["elle"]):
            d = self.prog[ad]
            etkin = d["ac"] + d["elle"] + d["kapat"]
            if etkin < 2:
                continue
            yer = d["yer"]
            ny = yer["sol"] + yer["sag"] + yer["tam"]
            en_yer = max(YERLER, key=lambda y: yer[y]) if ny else "-"
            t = self.tercih(ad)
            satir.append({"prog": ad, "ac": d["ac"], "elle": d["elle"],
                          "en_cok_yer": en_yer, "yer": dict(yer), "tercih": t})
        return satir

    def kaydet(self):
        DURUM_DIZIN.mkdir(mode=0o700, parents=True, exist_ok=True)
        veri = {"toplam": self.toplam, "guncel": time.strftime("%Y-%m-%d %H:%M"),
                "prog": {ad: {"ac": d["ac"], "elle": d["elle"], "kapat": d["kapat"], "yer": dict(d["yer"])}
                         for ad, d in self.prog.items()}}
        gecici = OGRENME.with_suffix(".tmp")
        gecici.write_text(json.dumps(veri, ensure_ascii=False, indent=1), encoding="utf-8")
        os.chmod(gecici, 0o600)
        gecici.replace(OGRENME)

    def ogrenilen_yaz(self):
        """Güçlü yan tercihlerini betiğin okuyacağı dosyaya yaz (yalnız kuralsız programlar için ipucu)."""
        tercihler = {ad: t for ad in self.prog if (t := self.tercih(ad))}
        OGRENILEN.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        gecici = OGRENILEN.with_suffix(".tmp")
        gecici.write_text(json.dumps({"yan": tercihler}, ensure_ascii=False, indent=1), encoding="utf-8")
        os.chmod(gecici, 0o600)
        gecici.replace(OGRENILEN)


def gunluk_yaz(kayit):
    DURUM_DIZIN.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        if GUNLUK.exists() and GUNLUK.stat().st_size > GUNLUK_EN_COK:
            satir = GUNLUK.read_text(encoding="utf-8", errors="replace").splitlines()
            GUNLUK.write_text("\n".join(satir[len(satir) // 2:]) + "\n", encoding="utf-8")
            os.chmod(GUNLUK, 0o600)
    except OSError:
        pass
    fd = os.open(GUNLUK, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as f:
        f.write(json.dumps(kayit, ensure_ascii=False) + "\n")


# ── servis ───────────────────────────────────────────────────────────────────────────────────────────────────
def servis():
    import dbus
    import dbus.service
    from dbus.mainloop.glib import DBusGMainLoop
    from gi.repository import GLib

    ogrenme = Ogrenme()
    durum = {"ff_gizli": 0, "ekranlar": {}, "son_kaydet": 0.0, "olay": 0}

    def parlaklik_kis():
        if durum["ekranlar"]:
            return
        for ad in ekran_yollari():
            e = ekran_oku(ad)
            if e and e["dahili"]:
                durum["ekranlar"][ad] = e["deger"]
                ekran_yaz(ad, max(1, round(e["enfazla"] * GIZLI_PARLAKLIK / 100)))

    def parlaklik_geri():
        for ad, eski in durum["ekranlar"].items():
            ekran_yaz(ad, eski)
        durum["ekranlar"] = {}

    class Pencere(dbus.service.Object):
        @dbus.service.method("net.trs.Pencere", in_signature="s", out_signature="")
        def olay(self, s):
            try:
                k = json.loads(s)
            except (ValueError, TypeError):
                return
            tur = str(k.get("tur", ""))[:16]
            prog = str(k.get("prog", ""))[:80]
            yer = k.get("yer") if k.get("yer") in YERLER else None
            kayit = {"t": round(time.time(), 1), "tur": tur, "prog": prog}
            for alan in ("yer", "n", "masaustu", "ekran"):
                if alan in k and isinstance(k[alan], (int, str)):
                    kayit[alan] = k[alan]
            kayit["saat"] = time.localtime().tm_hour
            gunluk_yaz(kayit)
            ogrenme.ekle(tur, prog, yer)
            durum["olay"] += 1
            if time.time() - durum["son_kaydet"] > 20:       # sık diske yazma
                ogrenme.kaydet()
                ogrenme.ogrenilen_yaz()
                durum["son_kaydet"] = time.time()

        @dbus.service.method("net.trs.Pencere", in_signature="b", out_signature="")
        def ffGizli(self, acik):
            if acik:
                durum["ff_gizli"] += 1
                if durum["ff_gizli"] == 1:
                    parlaklik_kis()
            else:
                durum["ff_gizli"] = max(0, durum["ff_gizli"] - 1)
                if durum["ff_gizli"] == 0:
                    parlaklik_geri()

        @dbus.service.method("net.trs.Pencere", in_signature="", out_signature="s")
        def durumMetni(self):
            return json.dumps({"olay": durum["olay"], "toplam": ogrenme.toplam, "ff_gizli": durum["ff_gizli"]})

    DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    ad = dbus.service.BusName("net.trs.Pencere", bus)
    Pencere(bus, "/net/trs/Pencere")

    def kapanista():
        parlaklik_geri()
        ogrenme.kaydet()
        ogrenme.ogrenilen_yaz()
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 15, lambda: (kapanista(), loop.quit()))
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 2, lambda: (kapanista(), loop.quit()))
    loop = GLib.MainLoop()
    print("trs-pencere çalışıyor", flush=True)
    try:
        loop.run()
    finally:
        kapanista()
    return 0


def ozet_yaz():
    o = Ogrenme()
    s = o.ozet()
    if not s:
        print("Henüz yeterli veri yok. Pencerelerle çalıştıkça buraya alışkanlıkların çıkar.")
        return 0
    print(f"Toplam {o.toplam} olay. Program başına alışkanlık (sayfa/başlık tutulmaz):\n")
    print(f"{'program':<34}{'aç':>5}{'elle':>6}  en çok   öğrenilen yan")
    for d in s:
        t = d["tercih"] or "-"
        print(f"{d['prog']:<34}{d['ac']:>5}{d['elle']:>6}  {d['en_cok_yer']:<8} {t}")
    return 0


def durum_yaz():
    out = gdbus("-d", "net.trs.Pencere", "-o", "/net/trs/Pencere", "-m", "net.trs.Pencere.durumMetni")
    if out is None:
        print("trs-pencere çalışmıyor (systemctl --user start trs-pencere)")
        return 1
    m = re.search(r'"([^"]*\{.*\})"', out) or re.search(r"'(\{.*\})'", out)
    try:
        d = json.loads(m.group(1).replace('\\"', '"')) if m else {}
    except (ValueError, AttributeError):
        d = {}
    print(f"çalışıyor · bu oturumda {d.get('olay', '?')} olay · toplam {d.get('toplam', '?')} · "
          f"gizli pencere: {d.get('ff_gizli', 0)}")
    return 0


def main(argv):
    arg = argv[1] if len(argv) > 1 else ""
    if arg == "--servis":
        return servis()
    if arg == "ozet":
        return ozet_yaz()
    if arg == "durum":
        return durum_yaz()
    print(__doc__.strip())
    return 0 if arg in ("", "-h", "--help", "yardim") else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
