---
name: chess-podcast
description: Rédige un script de podcast audio (lu par un TTS) pour réviser un répertoire d'ouvertures à partir d'un fichier .chessmap.json exporté par Chess Map. Utiliser quand l'utilisateur demande un podcast, un épisode audio ou un script de révision de ses ouvertures.
---

# Podcast de révision d'ouvertures

Produire un script en français, destiné à être lu par le TTS de l'appli Claude à un auditeur débutant qui n'a pas d'échiquier sous les yeux.

## Source

- Lire le fichier `.chessmap.json` fourni (`map.nodes`, arbre depuis `rootId`). Chaque nœud a des coups SAN (`moves`), éventuellement une `note` (idées, évaluations, plans) et des `shapes` (flèches/cercles : menaces, plans, fautes).
- Les notes et les flèches sont la matière pédagogique principale ; vérifier la légalité et l'effet réel de chaque coup avant de le commenter.

## Contenu

- **Un seul thème par épisode**, transversal au répertoire (ex. « la dame sortie trop tôt », « pousser d4 dans les Trois Cavaliers », « clouages et découvertes sur la colonne e »). Pas d'exhaustivité, pas de fidélité à 100 % à l'arbre : choisir 3 ou 4 positions qui illustrent le thème, et des contre-exemples (le même principe vu de l'autre côté).
- Pas d'introduction, de « bienvenue », de transition décorative ni d'outro : uniquement du contenu pédagogique. Pas d'interpellation de l'auditeur (« prenez le temps de visualiser », « à vous de trouver »…).
- Conclure le thème par une règle courte et mémorisable, pas par un résumé des coups.

## Présentation de chaque position

- Repartir **à chaque fois de la position initiale** : « La Scandinave. Position de départ. » puis toute la séquence depuis le premier coup.
- Annoncer chaque coup par son numéro en toutes lettres : « Premier coup. », « Deuxième coup. »…
- **À partir du deuxième coup, chaque demi-coup est suivi d'un court commentaire** sur son effet concret : défense, menace, pièce capturée, clouage, gain de temps, case libérée, roque empêché…
- Quand un camp **ignore une menace**, le dire et expliquer pourquoi (contre-attaque, menace plus forte, échange forcé). Ex. : un fou qui prend un cavalier en attaquant à son tour la dame adverse, alors que sa propre dame est attaquée.
- Quand une menace **persiste** après une reprise (la pièce est toujours attaquée), le rappeler.
- Une phrase de bilan à la fin de la position, liée au thème.

## Syntaxe pour le TTS

- Texte brut uniquement : pas de titres, puces, gras, crochets, `---` ni didascalies (`[pause]` est lu à voix haute).
- Cases : lettre majuscule, underscore, chiffre : `E_4`, `D_5`, `H_1`.
- Pièces en toutes lettres : roi, dame, tour, fou, cavalier. Captures : « Dame prend D_5 ». Prise de pion : lettre de colonne seule, « E prend D_5 ». Roques : « petit roque », « grand roque ». Échec : « échec », mat : « mat ».
- Pauses : des lignes ne contenant que `…`, séparées par des lignes vides.
  - Une ligne `…` entre le coup blanc (et son commentaire) et le coup noir.
  - Trois lignes `…` après chaque coup complet et après l'annonce « Position de départ ».
- Ne rien ajouter avant ni après le script dans la réponse quand l'utilisateur demande juste le texte.

## Exemple de référence

```text
Dernier exemple. La Scandinave. Position de départ.

…

…

…

Premier coup. E_4… D_5.

…

…

…

Deuxième coup. E prend D_5. Le pion blanc capture le pion central noir.

…

Dame prend D_5. La dame reprend le pion. Le matériel est égal, mais la dame est sortie.

…

…

…

Troisième coup. Cavalier C_3. Le cavalier se développe et attaque la dame.

…

Dame A_5. La dame fuit sur le bord.

…

…

…

Quatrième coup. D_4. Le pion prend le centre. Mais la case D_2 se libère : le cavalier C_3 est maintenant cloué sur le roi par la dame A_5.

…

Cavalier F_6. Le cavalier se développe et contrôle les cases E_4 et D_5.

…

…

…

Cinquième coup. Fou D_2. Le fou s'interpose et défait le clouage du cavalier.

…

Fou G_4. Le fou se développe et attaque la dame D_1.

…

…

…

Sixième coup. Cavalier F_3. Le cavalier bloque le fou et protège la dame. Mais il est à son tour cloué sur la dame.

…

Dame F_5. La dame bascule à l'aile roi et attaque le cavalier cloué une deuxième fois.

…

…

…

Septième coup. Fou D_3. Le fou se développe avec gain de temps : il attaque la dame.

…

Fou prend F_3. Les noirs ignorent la menace sur leur dame : en capturant le cavalier, le fou attaque à son tour la dame blanche en D_1. Les blancs doivent d'abord répondre à cette menace.

…

…

…

Huitième coup. G prend F_3. Le pion reprend le fou. L'aile roi blanche est ouverte, et la dame noire est toujours attaquée par le fou D_3.

…

Dame H_3. La dame s'échappe, contrôle la case F_1 et empêche le petit roque.

…

…

…

Neuvième coup. Cavalier E_4. Le cavalier se centralise et attaque le cavalier F_6.

…

Dame G_2. La dame attaque la tour H_1.

…

…

…

Dixième coup. Roi E_2. Le roi libère la première rangée. La dame D_1 protège maintenant la tour H_1.

…

…

…

Bilan. Les blancs ont toutes leurs pièces sorties et un centre solide. La dame noire est seule en territoire adverse, sans soutien. Une dame seule fait du bruit, mais elle ne mate pas.
```
