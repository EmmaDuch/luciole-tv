#!/bin/sh
# Installation (ou mise à jour) du serveur Luciole sur Debian 12/13 :
# conteneur LXC Proxmox, Raspberry Pi OS (64 bits) ou PC.
# À lancer en root, depuis le dossier décompressé : sh install.sh
#
# Variables facultatives :
#   LUCIOLE_TZ=Europe/Paris sh install.sh   fuseau horaire (par défaut Europe/Brussels, appliqué
#                                           seulement si la machine est encore en UTC)
#   LUCIOLE_MDNS=non sh install.sh          ne pas publier l'adresse luciole.local
#   LUCIOLE_ECRITURE=oui|non sh install.sh  médiathèque en écriture (conversion du son) ou en lecture seule ;
#                                           sans cette variable, la question est posée à la première installation
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "Lancez ce script en root." >&2
    exit 1
fi
cd "$(dirname "$0")"
TZ_WANTED=${LUCIOLE_TZ:-Europe/Brussels}
MDNS=${LUCIOLE_MDNS:-oui}

echo "== Paquets"
apt-get update -q
PKGS="python3 python3-pil ca-certificates tzdata"
[ "$MDNS" = oui ] && PKGS="$PKGS avahi-daemon avahi-utils"
# shellcheck disable=SC2086
apt-get install -y -q $PKGS

echo "== Fuseau horaire"
# un conteneur neuf est en UTC : les heures du guide seraient décalées
CURRENT=$(cat /etc/timezone 2>/dev/null || readlink /etc/localtime 2>/dev/null | sed 's#.*/zoneinfo/##' || echo UTC)
case "$CURRENT" in
    UTC|Etc/UTC|Etc/Universal|"")
        if command -v timedatectl >/dev/null 2>&1 && timedatectl set-timezone "$TZ_WANTED" 2>/dev/null; then :
        else
            ln -sf "/usr/share/zoneinfo/$TZ_WANTED" /etc/localtime
            echo "$TZ_WANTED" > /etc/timezone
        fi
        echo "   fuseau réglé sur $TZ_WANTED" ;;
    *)  echo "   fuseau conservé : $CURRENT" ;;
esac

echo "== Utilisateur et dossiers"
id luciole >/dev/null 2>&1 || useradd --system --home-dir /var/lib/luciole --shell /usr/sbin/nologin luciole
install -d -o luciole -g luciole -m 750 /var/lib/luciole
install -d -m 755 /opt/luciole /opt/luciole/luciole
rm -f /opt/luciole/luciole/*.py /opt/luciole/luciole/*.pyc
install -m 644 luciole/*.py luciole/*.html luciole/*.js /opt/luciole/luciole/

install -d -m 750 -g luciole /etc/luciole
if [ ! -f /etc/luciole/config.toml ]; then
    install -m 640 -g luciole config.example.toml /etc/luciole/config.toml
    NEW_CONFIG=1
else
    NEW_CONFIG=0
fi

echo "== Médiathèque : lecture ou écriture"
CONF=/etc/luciole/config.toml
CURRENT_W=$(sed -n 's/^[[:space:]]*ecriture[[:space:]]*=[[:space:]]*\(true\|false\).*/\1/p' "$CONF" | head -n 1)
WANT_W=""
case "${LUCIOLE_ECRITURE:-}" in
    oui|o|yes|true) WANT_W=true ;;
    non|n|no|false) WANT_W=false ;;
esac
if [ -z "$WANT_W" ] && [ -z "$CURRENT_W" ]; then
    WANT_W=false
    if [ -t 0 ]; then
        echo "   Par défaut, Luciole ne fait que LIRE vos films et séries."
        echo "   S'il peut aussi ÉCRIRE dans vos dossiers, la page web propose de convertir"
        echo "   le son que le téléviseur ne lit pas (DTS, TrueHD) en AC3. La vidéo n'est jamais"
        echo "   réencodée par Luciole : ça se fait en dehors (HandBrake, par exemple)."
        printf "   Autoriser l'écriture dans les dossiers de la médiathèque ? [o/N] "
        read -r REP || REP=""
        case "$REP" in o|O|oui|Oui|OUI|y|Y|yes) WANT_W=true ;; esac
    fi
fi
if [ -n "$WANT_W" ]; then
    if grep -q '^[[:space:]]*ecriture[[:space:]]*=' "$CONF"; then
        sed -i "s/^[[:space:]]*ecriture[[:space:]]*=.*/ecriture = $WANT_W/" "$CONF"
    elif grep -q '^\[medias\]' "$CONF"; then
        sed -i "/^\[medias\]/a ecriture = $WANT_W" "$CONF"
    else
        printf '\n[medias]\necriture = %s\n' "$WANT_W" >> "$CONF"
    fi
    CURRENT_W=$WANT_W
fi
if [ "$CURRENT_W" = true ]; then
    echo "   écriture autorisée : conversion du son proposée sur la page web"
    command -v ffmpeg >/dev/null 2>&1 || apt-get install -y -q ffmpeg
    echo "   pensez à monter vos dossiers en écriture pour l'utilisateur luciole (voir LISEZMOI.md)"
else
    echo "   lecture seule (LUCIOLE_ECRITURE=oui sh install.sh pour changer)"
fi

echo "== Services"
install -m 644 systemd/luciole.service systemd/luciole-sync.service systemd/luciole-sync.timer /etc/systemd/system/
# le service est enfermé en lecture seule hors de /var/lib/luciole ; pour convertir le son,
# il doit pouvoir écrire dans les dossiers montés (/mnt, /media, /srv…). /usr, /boot et /etc restent protégés.
if [ "$CURRENT_W" = true ]; then
    install -d -m 755 /etc/systemd/system/luciole.service.d
    printf '[Service]\n# écrit par install.sh : médiathèque en écriture (conversion du son)\nProtectSystem=full\n' \
        > /etc/systemd/system/luciole.service.d/ecriture.conf
else
    rm -f /etc/systemd/system/luciole.service.d/ecriture.conf
fi
systemctl daemon-reload
systemctl enable luciole-sync.timer >/dev/null
systemctl enable luciole.service >/dev/null

IP=$(hostname -I | awk '{print $1}')
WEB="http://$IP:8765"
if [ "$MDNS" = oui ]; then
    echo "== Adresse luciole.local"
    install -m 644 avahi/luciole.service /etc/avahi/services/luciole.service
    if [ "$(hostname -s)" = luciole ]; then
        rm -f /etc/systemd/system/luciole-mdns.service
    else
        # la machine garde son nom ; on annonce en plus « luciole.local » sur le réseau
        install -m 644 systemd/luciole-mdns.service /etc/systemd/system/
        systemctl daemon-reload
        systemctl enable luciole-mdns.service >/dev/null
        systemctl restart luciole-mdns.service || true
    fi
    systemctl enable avahi-daemon >/dev/null 2>&1 || true
    systemctl restart avahi-daemon || true
    WEB="http://luciole.local:8765  (ou $WEB)"
fi

if [ "$NEW_CONFIG" = 1 ]; then
    echo
    echo "Installé. Il reste à mettre vos identifiants Xtream :"
    echo "    nano /etc/luciole/config.toml"
    echo "puis à démarrer :"
    echo "    systemctl start luciole luciole-sync.timer"
else
    systemctl restart luciole
    systemctl start luciole-sync.timer
    echo
    echo "Mis à jour et redémarré."
fi
echo "Page d'accueil : $WEB"
echo "Adresse à taper sur le téléviseur : $IP"
