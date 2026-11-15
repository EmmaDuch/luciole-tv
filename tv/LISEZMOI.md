# Luciole – l'appli pour téléviseur Samsung

L'appli se présente sous la forme d'un fichier `Luciole.wgt`. Elle s'installe en **mode développeur**,
avec **Apps2Samsung**, comme n'importe quelle appli Tizen qui ne passe pas par la boutique Samsung.

Identifiant de l'appli : **`LucioleApp.Luciole`** (paquet `LucioleApp`). C'est celui que demande
le démarrage automatique.

## 1. Le mode développeur du téléviseur

1. Ouvrez le panneau **Applications** du téléviseur.
2. Sur la télécommande, tapez **1 2 3 4 5** : une fenêtre « Developer mode » s'ouvre.
3. Mettez **Developer mode** sur **On**, et indiquez l'**adresse IP de l'ordinateur** depuis lequel vous installerez.
4. Éteignez complètement le téléviseur (débranchez-le quelques secondes), puis rallumez-le.

## 2. Installer avec Apps2Samsung

1. Lancez Apps2Samsung sur l'ordinateur indiqué au téléviseur.
2. Donnez-lui l'adresse IP du téléviseur.
3. Choisissez le fichier `Luciole.wgt` et lancez l'installation. Apps2Samsung signe l'appli avec son propre
   certificat et l'envoie au téléviseur.
4. Luciole apparaît dans le panneau Applications. Déplacez-la en tête de liste si vous voulez.

## 3. Premier lancement

Tapez l'adresse IP du serveur (par exemple `192.168.1.20`). Le téléviseur ne connaît pas les adresses
`luciole.local` : c'est l'adresse IP qu'il faut. Ensuite, [docs/UTILISATION.md](../docs/UTILISATION.md)
décrit chaque écran et chaque touche.

## Fabriquer le fichier .wgt

Le fichier est un simple zip du dossier `tv/` :

```sh
cd tv && zip -r -X ../Luciole.wgt config.xml index.html icon.png css js
```

L'icône se refait avec `python3 outils/icone.py tv/icon.png`.
