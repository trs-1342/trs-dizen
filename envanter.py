#!/usr/bin/python3
"""Kurulu bütün pencereli programları tarar ve her biri için yerleşim önerir.

  envanter.py            özet + tam liste (yer önerisine göre gruplu)
  envanter.py --json     makine okur çıktı (trs-dizen-yeni ve kurulum kullanır)

Kaynak: .desktop dosyaları (sistem, kullanıcı, Flatpak; alt dizinler dahil). Gizli girdiler (NoDisplay,
Hidden), terminalde çalışanlar ve ayar modülleri sayılmaz. Aynı kimlik birden çok dizinde varsa üstteki
dizindeki geçerlidir; üstteki gizliyse program hiç sayılmaz (masaüstü ortamı da böyle davranır). Öneri, programın bildirdiği kategorilerden çıkarılır (tahmin()).
"""
import configparser
import json
import os
import re
import sys
from pathlib import Path

DIZINLER = [
    Path("/usr/share/applications"),
    Path("/usr/local/share/applications"),
    Path("/var/lib/flatpak/exports/share/applications"),
    Path.home() / ".local/share/flatpak/exports/share/applications",
    Path.home() / ".local/share/applications",
]


def oku(yol, kimlik=None):
    c = configparser.RawConfigParser(strict=False, interpolation=None)
    c.optionxform = str
    try:
        c.read(yol, encoding="utf-8")
    except Exception:
        return None
    if not c.has_section("Desktop Entry"):
        return None
    d = c["Desktop Entry"]
    if d.get("Type", "Application") != "Application":
        return None
    if d.get("NoDisplay", "false").lower() == "true" or d.get("Hidden", "false").lower() == "true":
        return None
    if d.get("Terminal", "false").lower() == "true" or not d.get("Exec"):
        return None
    kimlik = kimlik or yol.name[:-len(".desktop")]
    if kimlik.startswith(("kcm_", "kcm-")) or "X-KDE-ServiceTypes" in d and "KCModule" in d.get("X-KDE-ServiceTypes", ""):
        return None
    return {
        "kimlik": kimlik,
        "ad": d.get("Name[tr]") or d.get("Name") or kimlik,
        "kategoriler": [k for k in d.get("Categories", "").split(";") if k],
        "sinif": d.get("StartupWMClass", ""),
        "komut": d.get("Exec", ""),
        "kaynak": "flatpak" if "flatpak" in str(yol) else ("kullanıcı" if str(yol).startswith(str(Path.home())) else "sistem"),
    }


def tara():
    programlar = {}
    for dizin in DIZINLER:
        if not dizin.is_dir():
            continue
        for yol in sorted(dizin.rglob("*.desktop")):
            # alt dizindeki dosyanın kimliği yol parçalarının tireyle birleşimidir (kde4/x.desktop → kde4-x)
            kimlik = "-".join(yol.relative_to(dizin).parts)[:-len(".desktop")]
            p = oku(yol, kimlik)
            if p:
                programlar[kimlik] = p            # sonraki dizin öncekini ezer (kullanıcı > sistem)
            else:
                programlar.pop(kimlik, None)      # üstteki gizli/geçersiz girdi alttakini örter
    return programlar


# Kategorinin yanılttığı programlar için elle düzeltme (kimlik → yer, gerekçe)
OZEL = {
    "chatgpt": ("orta", "sohbet penceresi: dar yeter"),
    "me.iepure.devtoolbox": ("orta", "küçük araç kutusu"),
    "org.kde.kdebugsettings": ("orta", "ayar penceresi"),
    "org.kde.headerthemeeditor": ("orta", "küçük düzenleyici"),
    "org.kde.ktnef": ("orta", "küçük görüntüleyici"),
    "org.kde.sieveeditor": ("orta", "küçük düzenleyici"),
    "org.kde.contactthemeeditor": ("orta", "küçük düzenleyici"),
    "org.kde.contactprintthemeeditor": ("orta", "küçük düzenleyici"),
    "org.kde.pimdataexporter": ("orta", "sihirbaz penceresi"),
    "org.torproject.torbrowser-launcher.settings": ("orta", "ayar penceresi"),
    "org.kde.kinfocenter": ("orta", "bilgi penceresi"),
    "org.kde.plasma-welcome": ("orta", "karşılama penceresi"),
    "com.github.dynobo.normcap": ("haric", "ekran yakalama katmanı: dokunulmaz"),
    "org.gnome.Loupe": ("haric", "görüntüleyici: kendi boyutu anlamlı"),
    "org.kde.okular": ("sag", "belge okuyucu: okunan içerik"),
    "md.obsidian.Obsidian": ("sag", "not defteri: yazılan ana içerik"),
    "org.kde.akregator": ("sag", "haber okuyucu: okunan içerik"),
    "virtualbox": ("genel", "yönetici penceresi; sanal makinenin kendi penceresi ayrıca tam ekran"),
    "com.anydesk.Anydesk": ("genel", "başlatıcı pencere"),
    "io.github._0xzer0x.qurancompanion": ("genel", "okuma + dinleme: genel kural"),
    "org.kde.partitionmanager": ("tam", "disk bölümleme: geniş tablo"),
}


def tahmin(p):
    """Kategorilerden yerleşim önerisi: (yer, gerekçe). yer: tam | sag | sol | orta | haric | genel"""
    if p["kimlik"] in OZEL:
        return OZEL[p["kimlik"]]
    k = set(p["kategoriler"])
    ad = (p["kimlik"] + " " + p["ad"]).lower()

    def var(*adlar):
        return any(a in k for a in adlar)

    if var("Game"):
        return "haric", "oyun: penceresini kendi yönetir"
    if var("TextEditor") and not var("IDE"):
        return "sol", "metin düzenleyici: yardımcı araç"
    if var("Email") and not var("Settings"):
        return "sag", "e-posta: okunan içerik"
    if var("Screensaver"):
        return "haric", "ekran koruyucu"
    if var("AudioVideoEditing", "Recorder") and not var("Player"):
        return "tam", "ses/görüntü düzenleme ya da kayıt: çok panelli"
    if var("Player") or (var("AudioVideo", "Audio", "Video") and not var("Mixer", "Settings")):
        return "haric", "oynatıcı: kendi boyutu anlamlı"
    if var("Mixer"):
        return "orta", "ses ayarı: küçük pencere"
    if var("Graphics"):
        if var("Viewer") and not var("2DGraphics", "RasterGraphics", "VectorGraphics", "3DGraphics"):
            return "haric", "görüntüleyici: kendi boyutu anlamlı"
        if var("Scanning", "OCR"):
            return "orta", "tarama aracı"
        if var("Viewer") and var("Office"):
            return "sag", "belge okuyucu"
        return "tam", "çizim/düzenleme: çok panelli"
    if var("Development"):
        if var("Documentation"):
            return "sag", "belge/başvuru: okunan içerik"
        return "tam", "geliştirme aracı: çok panelli"
    if var("Office"):
        if var("Viewer"):
            return "sag", "belge okuyucu"
        if var("Dictionary", "Calendar", "ContactManagement", "ProjectManagement"):
            return "orta", "küçük ofis aracı"
        return "tam", "ofis: geniş çalışma alanı"
    if var("WebBrowser"):
        return "sag", "tarayıcı: ana içerik"
    if var("InstantMessaging", "Chat", "IRCClient", "Telephony", "VideoConference"):
        return "orta", "sohbet: dar pencere yeter"
    if var("Email"):
        return "sag", "e-posta: okunan içerik"
    if var("RemoteAccess"):
        return "tam", "uzak masaüstü: tam alan ister"
    if var("FileTransfer", "P2P"):
        return "orta", "indirme/aktarım: küçük pencere"
    if var("TerminalEmulator"):
        return "sol", "terminal: yardımcı araç"
    if var("FileManager"):
        return "sol", "dosya yöneticisi: yardımcı araç"
    if var("Emulator"):
        return "tam", "sanal makine/öykünücü"
    if var("TextEditor"):
        return "sol", "metin düzenleyici: yardımcı araç"
    if var("Documentation", "Viewer"):
        return "sag", "okuyucu: ana içerik"
    if var("Education", "Science"):
        return "tam", "eğitim/bilim uygulaması"
    if var("Settings", "PackageManager", "Monitor", "Calculator", "Archiving", "Compression", "Clock",
           "Security", "HardwareSettings", "DesktopSettings", "Printing", "Accessibility", "Filesystem",
           "DiscBurning", "System", "Utility", "Network"):
        return "orta", "ayar/araç: kısa süreli, küçük pencere"
    return "genel", "kategori belirsiz: genel kural (1 tam, 2 sağ/sol, 3+ rastgele)"


def desenler(p):
    """Pencereyi tanımak için aranacak adlar: .desktop kimliği ve varsa pencere sınıfı."""
    d = [p["kimlik"].lower()]
    if p["sinif"] and p["sinif"].lower() not in d:
        d.append(p["sinif"].lower())
    return d


if __name__ == "__main__":
    programlar = tara()
    for p in programlar.values():
        p["yer"], p["gerekce"] = tahmin(p)
        p["ara"] = desenler(p)
    if "--json" in sys.argv:
        json.dump(programlar, sys.stdout, ensure_ascii=False, indent=1)
        sys.exit(0)
    gruplar = {}
    for p in programlar.values():
        gruplar.setdefault(p["yer"], []).append(p)
    print(f"toplam {len(programlar)} program")
    for yer in ("tam", "sag", "sol", "orta", "haric", "genel"):
        liste = sorted(gruplar.get(yer, []), key=lambda x: x["ad"].lower())
        print(f"\n== {yer} ({len(liste)})")
        for p in liste:
            print(f"  {p['ad'][:34]:34} {p['kimlik'][:44]:44} {';'.join(p['kategoriler'])[:60]}")
