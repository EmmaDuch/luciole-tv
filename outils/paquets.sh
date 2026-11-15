#!/bin/sh
# Fabrique les trois paquets d'une version, dans dist/ :
#   luciole-server-<version>.tar.gz   le serveur, avec son script d'installation
#   Luciole.wgt                       l'appli du téléviseur (à installer avec Apps2Samsung)
#   luciole-tv-<version>-source.zip   tout le dépôt
set -eu
cd "$(dirname "$0")/.."
V=$(sed -n 's/^__version__ = "\(.*\)"/\1/p' server/luciole/__init__.py)
rm -rf dist && mkdir -p dist/luciole-server
cp -r server/install.sh server/config.example.toml server/LISEZMOI.md server/systemd server/avahi dist/luciole-server/
mkdir -p dist/luciole-server/luciole
cp server/luciole/*.py server/luciole/*.html server/luciole/*.js dist/luciole-server/luciole/
(cd dist && tar czf "luciole-server-$V.tar.gz" --owner=0 --group=0 luciole-server && rm -rf luciole-server)
(cd tv && zip -q -r -X ../dist/Luciole.wgt config.xml index.html icon.png css js)
git ls-files -z 2>/dev/null | xargs -0 zip -q "dist/luciole-tv-$V-source.zip" 2>/dev/null \
  || zip -q -r "dist/luciole-tv-$V-source.zip" . -x 'dist/*' '.git/*' '*/__pycache__/*' 'maquette/.cache/*'
ls -la dist
