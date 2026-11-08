#!/bin/bash
# trs-pencere — trs-dizen yardımcı servisi: kurulum / kaldırma. SUDO GEREKMEZ, klavye dinlenmez.
#   bash ~/projects/trs-dizen/pencere/kur.sh        kur / güncelle (önce sınama koşar)
#   bash ~/projects/trs-dizen/pencere/kur.sh geri   kaldır (kayıtlar ~/.local/state/trs-dizen'de kalır)
#
# Kurulanlar: ~/.local/share/trs-pencere (program) · ~/.local/bin/trs-pencere · trs-pencere.service
set -euo pipefail
KAYNAK=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
HEDEF=$HOME/.local/share/trs-pencere
BIRIM=$HOME/.config/systemd/user

if [ "${1:-}" = "geri" ]; then
  systemctl --user disable --now trs-pencere.service 2>/dev/null || true
  rm -rf "$HEDEF" "$HOME/.local/bin/trs-pencere" "$BIRIM/trs-pencere.service"
  systemctl --user daemon-reload
  echo "Kaldırıldı. Kayıtlar/öğrenme ~/.local/state/trs-dizen'de duruyor (silmek için: rm -rf ~/.local/state/trs-dizen)."
  exit 0
fi

python3 -B "$KAYNAK/sina_pencere.py" >/dev/null 2>&1 || { echo "sınama KALDI, kurulmadı (python3 $KAYNAK/sina_pencere.py)"; exit 1; }

mkdir -p "$HEDEF" "$BIRIM" "$HOME/.local/bin" "$HOME/.local/state/trs-dizen" "$HOME/.config/trs"
chmod 700 "$HOME/.local/state/trs-dizen"
install -m 755 "$KAYNAK/trs-pencere.py" "$HEDEF/"
printf '#!/bin/sh\nexec /usr/bin/python3 -B "$HOME/.local/share/trs-pencere/trs-pencere.py" "$@"\n' > "$HOME/.local/bin/trs-pencere"
chmod 755 "$HOME/.local/bin/trs-pencere"
install -m 644 "$KAYNAK/trs-pencere.service" "$BIRIM/"
systemctl --user daemon-reload
systemctl --user enable trs-pencere.service >/dev/null 2>&1
systemctl --user restart trs-pencere.service
sleep 1
systemctl --user is-active --quiet trs-pencere.service \
  && echo "trs-pencere çalışıyor (öğrenilen: trs-pencere ozet)" \
  || { echo "BAŞLAMADI:"; journalctl --user -u trs-pencere -n 15 --no-pager; exit 1; }
